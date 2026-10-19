import fs from 'node:fs/promises';
import path from 'node:path';
import { redactText } from '../ingest/redact.js';
import type { Entry, EntryMeta, Identity, MemoryKind, Scope } from '../types.js';
import type { MemoryStore } from '../store/types.js';
import { decaySweep, defaultStability } from '../model/scoring.js';
import { resolveConflict, inheritProvenance, promotionVerdict } from '../model/lifecycle.js';
import { parseIdentityId } from '../identity/identity.js';
import { extractPrompt, mergePrompt, distillPrompt, parseJsonOut } from './prompts.js';
import type { ExtractOut, MergeOut, DistillOut } from './prompts.js';
import { gitCommitIfRepo } from '../util/git.js';
import { ensureDir, nowISO } from '../util/fsutil.js';

const KIND_SET = new Set(['fact', 'preference', 'event', 'procedure', 'decision']);


/** spool 的 kind('digest' 等)→ MemoryKind:摘要条目记 event(发生了什么) */
function asKind(k: unknown, fallback: MemoryKind): MemoryKind {
  return typeof k === 'string' && KIND_SET.has(k) ? (k as MemoryKind) : fallback;
}

function clamp01(x: unknown, fallback: number): number {
  const n = typeof x === 'number' ? x : Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function safeParseIdentity(s: string | null | undefined): Identity | null {
  if (!s) return null;
  try { return parseIdentityId(s); } catch { return null; }
}

export interface ConsolidatorOptions {
  dataDir: string;                              // data/ 根(状态文件 + git 仓库)
  callLLM: (msgs: unknown, opts?: unknown) => Promise<string>;
  logger?: (msg: string) => void;
  maxSessionsPerRun?: number;                   // M05 §3:默认 20
  minMergeGroup?: number;                       // 归并触发:同 agent 未归并 L1 ≥ N,默认 5
  floor?: number;                               // 衰减地板,默认 0.15(M03 DEFAULTS)
}

export interface SkippedSession { hash: string; error: string; }

export interface RunReport {
  run_id: string;
  summarized: number;
  merged: number;
  conflicts_superseded: number;
  conflicts_needs_review: number;
  distilled: number;
  archived: number;
  skipped: SkippedSession[];
  gitCommitted: boolean;
  singletonSkipped?: boolean;
}

interface StateFile {
  schema_version: 1;
  last_run: { run_id: string; finished_at: string; summarized: number; merged: number; distilled: number; archived: number } | null;
  processed_spool: Record<string, string>;      // spool hash16 → L1 entry id(幂等游标)
}

const SPOOL_HASH_RE = /^[0-9a-f]{16}$/;

/**
 * M05 巩固器:摘要 L0→L1 / 归并 L1→L2 / 蒸馏 L2→L3 / 衰减。
 * 单飞锁 + 幂等游标(state 文件,每 session 落一次)+ 启动对账(以条目为准修复游标)+ run 结束 git commit。
 * LLM 失败语义(M05 §3):该 session 跳过、run 正常结束、下轮重试;不阻塞、不重复消费。
 */
export class Consolidator {
  private running = false;

  constructor(private store: MemoryStore, private opts: ConsolidatorOptions) {}

  private get stateFile(): string {
    return path.join(this.opts.dataDir, 'consolidation-state.json');
  }

  private async loadState(): Promise<StateFile> {
    try {
      const raw = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
      if (raw && raw.schema_version === 1 && raw.processed_spool && typeof raw.processed_spool === 'object') {
        return raw as StateFile;
      }
    } catch { /* 首次/损坏 → 重置(游标可由对账重建) */ }
    return { schema_version: 1, last_run: null, processed_spool: {} };
  }

  private async saveState(state: StateFile): Promise<void> {
    await ensureDir(this.opts.dataDir);
    await fs.writeFile(this.stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
  }

  /** 启动对账(M05 §2):L1 已写但游标未标的孤儿 → 以条目 source_ids(spool hash)为准重建 */
  async reconcile(): Promise<number> {
    const state = await this.loadState();
    let repaired = 0;
    for await (const e of this.store.iterateByScope({ includeArchived: true })) {
      if (e.layer !== 1) continue;
      for (const s of e.source_ids) {
        if (SPOOL_HASH_RE.test(s) && !state.processed_spool[s]) {
          state.processed_spool[s] = e.id;
          repaired++;
        }
      }
    }
    if (repaired > 0) await this.saveState(state);
    return repaired;
  }

  private async llm<T>(prompt: string, task: string): Promise<T> {
    const raw = await this.opts.callLLM([{ role: 'user', content: prompt }]);
    return parseJsonOut<T>(raw, task);
  }

  /** 单飞锁:并发第二次调用直接返回 singletonSkipped(M05 §2) */
  async run(trigger: 'schedule' | 'manual' = 'manual'): Promise<RunReport> {
    const startedAt = Date.now();
    if (this.running) {
      await this.appendRunLog({ run_id: 'skipped', trigger, ts: nowISO(), skipped_reason: 'another run holds the lock' }).catch(() => {});
  return { run_id: 'skipped', summarized: 0, merged: 0, conflicts_superseded: 0, conflicts_needs_review: 0, distilled: 0, archived: 0, skipped: [], gitCommitted: false, singletonSkipped: true };
    }
    this.running = true;
    try {
      const runId = 'run_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const report: RunReport = { run_id: runId, summarized: 0, merged: 0, conflicts_superseded: 0, conflicts_needs_review: 0, distilled: 0, archived: 0, skipped: [], gitCommitted: false };
      await this.reconcile();
      const state = await this.loadState();
      report.summarized = await this.stageSummarize(state, report);
      const mo = await this.stageMerge(report);
      report.merged = mo.merged;
      report.conflicts_superseded = mo.superseded;
      report.conflicts_needs_review = mo.needsReview;
      report.distilled = await this.stageDistill();
      report.archived = await this.stageDecay();
      await this.appendRunLog({ run_id: runId, trigger, ts: nowISO(), duration_ms: Date.now() - startedAt, summarized: report.summarized, merged: report.merged, conflicts_superseded: report.conflicts_superseded, conflicts_needs_review: report.conflicts_needs_review, distilled: report.distilled, archived: report.archived, skipped: report.skipped, gitCommitted: report.gitCommitted }).catch(() => {});
    state.last_run = { run_id: runId, finished_at: nowISO(), summarized: report.summarized, merged: report.merged, distilled: report.distilled, archived: report.archived };
      await this.saveState(state);
      report.gitCommitted = await gitCommitIfRepo(
        this.opts.dataDir,
        'consolidation ' + runId + ': +' + report.summarized + ' L1, +' + report.merged + ' L2, +' + report.distilled + ' L3, ~' + report.archived + ' archived',
      );
      // M10 §2:review 每日汇总(needs_review 队列 + _quarantine 事件 → hub 可见日志)
      let quarantined = 0;
      try { quarantined = (this.store as unknown as { getQuarantined?: () => string[] }).getQuarantined?.().length ?? 0; } catch { quarantined = 0; }
      this.opts.logger?.('[ai-brain] consolidation ' + runId + ': L1+' + report.summarized + ' L2+' + report.merged + ' L3+' + report.distilled + ' archived~' + report.archived + ' skipped=' + report.skipped.length);
      this.opts.logger?.('[ai-brain] review summary ' + runId + ': needs_review=' + report.conflicts_needs_review + ' quarantined=' + quarantined + ' (人工复核队列,review_list 查看)');
      return report;
    } finally {
      this.running = false;
    }
  }

  /** 摘要 L0→L1:消费 _spool 提交的 digest(游标幂等;LLM 失败跳过不阻塞) */
  /** 每日一文件 JSONL 运行日志:复核定时巩固是否真实触发(0.0.13.13) */
  private async appendRunLog(rec: Record<string, unknown>): Promise<void> {
    const dir = path.join(this.opts.dataDir, '_logs');
    await ensureDir(dir);
    const day = new Date().toLocaleDateString('sv');
    await fs.appendFile(path.join(dir, 'consolidate-' + day + '.jsonl'), JSON.stringify(rec) + '\n', 'utf8');
  }

  private async stageSummarize(state: StateFile, report: RunReport): Promise<number> {
    const root = (this.store as unknown as { root: string }).root;
    const spoolDir = path.join(root, '_spool');
    let files: string[] = [];
    try { files = (await fs.readdir(spoolDir)).filter((f) => f.endsWith('.json')).sort(); } catch { return 0; }
    const cap = this.opts.maxSessionsPerRun ?? 20;
    let n = 0;
    for (const f of files) {
      if (n >= cap) break;
      const hash16 = f.replace(/\.json$/, '');
      if (state.processed_spool[hash16]) continue;
      let rec: { session_id?: string; kind?: string; identity?: string | null; content?: string; auto?: boolean };
      try {
        rec = JSON.parse(await fs.readFile(path.join(spoolDir, f), 'utf8'));
      } catch (e) {
        report.skipped.push({ hash: hash16, error: 'spool unreadable: ' + msg(e) });
        continue;
      }
      if (!rec.content || !String(rec.content).trim()) {
        report.skipped.push({ hash: hash16, error: 'no content' });   // 两者皆无 → 跳过(M05 §3)
        continue;
      }
      try {
        const identity = safeParseIdentity(rec.identity);
        // M11 强制点:会话正文先脱敏再出网(LLM);截断沿用入库同款上限
        const safeContent = redactText(String(rec.content), 2048);
        const out = await this.llm<ExtractOut>(extractPrompt({ sessionId: String(rec.session_id || hash16), kind: String(rec.kind || 'digest'), content: safeContent }), 'extract');
        if (!out || typeof out.summary !== 'string' || !out.summary.trim()) throw new Error('extract: empty summary');
        const facts = Array.isArray(out.facts) ? out.facts : [];
        const rawImp = facts.length ? clamp01(Math.max(...facts.map((x) => x.importance)), 0.5) : 0.5;
        const importance = rec.auto === true ? Math.min(rawImp, 0.6) : rawImp;   // 自动摘要权重硬上限(0.014 设计稿 §3)
        const body = out.summary.trim() + (facts.length ? '\n\n要点:\n' + facts.map((x, i) => (i + 1) + '. ' + String(x.text)).join('\n') : '');
        const scope: Scope = identity ? (identity.agent_label ? 'agent' : 'member') : 'member';
        const owner = { member: identity ? identity.member : 'unknown', agent: identity ? identity.agent_label : '' };
        const id = await this.store.upsertEntry({
          schema_version: 1, id: '', layer: 1, scope, owner,
          title: (typeof out.title === 'string' && out.title.trim()) ? out.title.trim().slice(0, 60) : 'session ' + String(rec.session_id || hash16),
          kind: asKind(rec.kind, 'event'),
          importance, stability: defaultStability(1), access_count: 0,
          last_access: nowISO(), status: 'active', pinned: false,
          superseded_by: null, source_ids: [hash16], tags: [],
          created_by: rec.auto === true ? 'watcher:auto' : 'consolidator', created_at: nowISO(), updated_at: nowISO(),
          body,
        });
        state.processed_spool[hash16] = id;
        await this.saveState(state);            // 每 session 落游标(崩溃续跑)
        n++;
      } catch (e) {
        // LLM 失败语义(M05 §3):标记跳过、游标不动(下轮重试)、run 继续
        report.skipped.push({ hash: hash16, error: msg(e) });
      }
    }
    return n;
  }

  /** 归并 L1→L2 + 矛盾消解:同 agent 未归并 L1 ≥ 阈值;LLM 只提名,裁定/落库按 M03 规则执行 */
  private async stageMerge(report: RunReport): Promise<{ merged: number; superseded: number; needsReview: number }> {
    const minGroup = this.opts.minMergeGroup ?? 5;
    const all: Entry[] = [];
    for await (const e of this.store.iterateByScope({ includeArchived: false })) all.push(e);
    const referenced = new Set<string>();       // 未归并 = 没有任何更高层条目引用它
    for (const e of all) {
      if (e.layer >= 2) for (const s of e.source_ids) referenced.add(s);
    }
    const groups = new Map<string, Entry[]>();
    for (const e of all) {
      if (e.layer !== 1 || e.status !== 'active' || referenced.has(e.id)) continue;
      const key = e.owner.member + '/' + (e.owner.agent || '');
      const list = groups.get(key) || [];
      list.push(e);
      groups.set(key, list);
    }
    let merged = 0, superseded = 0, needsReview = 0;
    for (const [agentKey, group] of groups) {
      if (group.length < minGroup) continue;
      const member = group[0].owner.member;
      const existing = all
        .filter((e) => e.layer >= 2 && e.status === 'active' && e.owner.member === member)
        .map((e) => ({ id: e.id, title: e.title, layer: e.layer, body: e.body }));
      let out: MergeOut;
      try {
        out = await this.llm<MergeOut>(mergePrompt({
          agentId: agentKey,
          candidates: group.map((g, idx) => ({ idx, id: g.id, title: g.title, body: g.body })),
          existing,
        }), 'merge');
      } catch (e) {
        report.skipped.push({ hash: 'merge:' + agentKey, error: msg(e) });
        continue;
      }
      for (const m of (out.merges || [])) {
        const sources: string[] = [];
        for (const idx of (Array.isArray(m.from) ? m.from : [])) {
          const g = group[idx];
          if (g && !sources.includes(g.id)) sources.push(g.id);
        }
        if (sources.length === 0) continue;     // 无出处不写(宁缺毋滥)
        // 设计(M05):member L1 归并后保持 active 作为证据;重复归并由 referenced 集合防(L2 的 source_ids 引用)
        await this.store.upsertEntry({
          schema_version: 1, id: '', layer: 2, scope: 'member',
          owner: { member, agent: '' },
          title: String(m.title || 'merged knowledge').slice(0, 80),
          kind: asKind(m.kind, 'fact'),
          importance: clamp01(m.importance, 0.5),
          stability: defaultStability(2), access_count: 0, last_access: nowISO(),
          status: 'active', pinned: false, superseded_by: null,
          source_ids: sources, tags: [],
          created_by: 'consolidator', created_at: nowISO(), updated_at: nowISO(),
          body: String(m.body || ''),
        });
        merged++;
      }
      for (const c of (out.conflicts || [])) {
        const old = all.find((e) => e.id === c.old_id && e.status === 'active');
        if (!old) continue;                     // LLM 幻觉 id → 忽略
        const decision = resolveConflict(old);  // 引擎裁定,不信 LLM
        if (decision === 'supersede') {
          const fresh: Entry = {
            schema_version: 1, id: '', layer: old.layer, scope: old.scope, owner: { ...old.owner },
            title: old.title, kind: old.kind, importance: old.importance, stability: old.stability,
            access_count: old.access_count, last_access: nowISO(), status: 'active', pinned: old.pinned,
            superseded_by: null, source_ids: [...old.source_ids], tags: [...(old.tags || [])],
            created_by: 'consolidator', created_at: nowISO(), updated_at: nowISO(),
            body: old.body + '\n\n[巩固更新] ' + String(c.reason || ''),
          };
          inheritProvenance(old, fresh);
          const newId = await this.store.upsertEntry(fresh);
          await this.store.patchMeta(old.id, { status: 'superseded', superseded_by: newId });
          superseded++;
        } else {
          await this.store.patchMeta(old.id, { status: 'needs_review' });
          needsReview++;
        }
      }
    }
    return { merged, superseded, needsReview };
  }

  /** 蒸馏 L2→L3:证据达标(promotionVerdict)→ LLM 压缩成原子句;L3 引用 L2(L2 不动,证据保留) */
  private async stageDistill(): Promise<number> {
    const all: Entry[] = [];
    for await (const e of this.store.iterateByScope({ includeArchived: false })) all.push(e);
    const distilled = new Set<string>();        // 已被 L3 引用的 L2 → 跳过(幂等)
    for (const e of all) {
      if (e.layer === 3) for (const s of e.source_ids) distilled.add(s);
    }
    let n = 0;
    for (const e of all) {
      if (e.layer !== 2 || e.status !== 'active' || distilled.has(e.id)) continue;
      const verdict = promotionVerdict(e, { distinct_sessions: e.source_ids.length, referring_sessions: 0 });
      if (!verdict.eligible) continue;
      let out: DistillOut;
      try {
        out = await this.llm<DistillOut>(distillPrompt({ id: e.id, title: e.title, body: e.body }), 'distill');
      } catch {
        continue;                               // 失败下轮重试(候选仍在)
      }
      for (const fact of (out.facts || []).slice(0, 5)) {   // 原子句上限:防 L3 碎片化爆炸(0.0.13.13)
        if (!fact || typeof fact.text !== 'string' || !fact.text.trim()) continue;
        const fresh: Entry = {
          schema_version: 1, id: '', layer: 3, scope: 'member',
          owner: { member: e.owner.member, agent: '' },
          title: fact.text.trim().slice(0, 50),
          kind: asKind(fact.kind, 'fact'),
          importance: clamp01(fact.importance, e.importance),
          stability: defaultStability(3), access_count: 0, last_access: nowISO(),
          status: 'active', pinned: false, superseded_by: null,
          source_ids: [...e.source_ids], tags: e.tags ? [...e.tags] : [],
          created_by: 'consolidator', created_at: nowISO(), updated_at: nowISO(),
          body: fact.text.trim(),
        };
        inheritProvenance(e, fresh);            // 继承 L2 及其溯源链(M03 §5)
        await this.store.upsertEntry(fresh);
        n++;
      }
    }
    return n;
  }

  /** 衰减:decaySweep 纯函数(M03)→ 低于地板的 active 归档(可逆) */
  private async stageDecay(): Promise<number> {
    const metas: EntryMeta[] = [];
    for await (const e of this.store.iterateByScope({ includeArchived: false })) metas.push(e);
    const rep = decaySweep(metas, new Date(), { floor: this.opts.floor });
    for (const c of rep.toArchive) {
      try { await this.store.patchMeta(c.id, { status: 'archived' }); } catch { /* 并发改动 → 跳过 */ }
    }
    return rep.toArchive.length;
  }
}
