import crypto from 'node:crypto';
import { defaultStability } from '../model/scoring.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Entry, EntryMeta, Identity, MemoryKind, Scope } from '../types.js';
import type { MemoryStore } from '../store/types.js';
import { roleOf, assertCanInvoke, canInvoke, allowedTools } from '../identity/permissions.js';
import { identityToString } from '../identity/identity.js';
import { rankCandidates, retrieve } from '../retrieval/engine.js';
import { visibleTo } from '../retrieval/visible.js';
import { assertTransition } from '../model/lifecycle.js';
import { atomicWriteFile, ensureDir, exists, nowISO } from '../util/fsutil.js';

export interface ToolCtx {
  identity: Identity | null;     // null = 只读访客(M07 §3)
  store: MemoryStore;
  dataDir?: string;              // 0.0.17.0:memory.export 写 bundle 用
}

export interface ToolResult { content: unknown; isError: boolean; }

const KINDS = ['fact', 'preference', 'event', 'procedure', 'decision'];
const SAVE_SCOPES = ['agent', 'member', 'studio'];

function fail(msg: string): never { throw new Error(msg); }

function needStr(args: Record<string, unknown>, key: string, tool: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) fail(tool + ': missing required param "' + key + '"');
  return v as string;
}

function createdByOf(identity: Identity): string {
  return identity.agent_label ? 'agent:' + identityToString(identity) : identityToString(identity);
}

function pickById(store: MemoryStore, id: string): Promise<Entry | undefined> {
  return pickFirst(store, (e) => e.id === id);
}

async function pickFirst(store: MemoryStore, pred: (e: Entry) => boolean): Promise<Entry | undefined> {
  for await (const e of store.iterateByScope({ includeArchived: true })) {
    if (pred(e)) return e;
  }
  return undefined;
}

const handlers: Record<string, (ctx: ToolCtx, args: Record<string, unknown>) => Promise<unknown>> = {
  'memory.save': async (ctx, args) => {
    const identity = ctx.identity;
    if (!identity) fail('未识别连接(需要身份凭证)');
    const content = needStr(args, 'content', 'memory.save');
    const kind = needStr(args, 'kind', 'memory.save') as MemoryKind;
    if (!KINDS.includes(kind)) fail('memory.save: kind must be one of ' + KINDS.join('|'));
    const scope = (typeof args.scope === 'string' && args.scope ? args.scope : identity.agent_label ? 'agent' : 'member') as Scope;
    if (!SAVE_SCOPES.includes(scope)) fail('memory.save: scope must be agent|member|studio');
    const isMemberCred = roleOf(identity) === 'member';
    if (scope === 'agent' && isMemberCred) fail('memory.save: member 凭证请用 scope=member');
    let status: 'active' | 'needs_review' = 'active';
    let note = '已存为候选(L1);能否长期保留由巩固决定,不承诺进入 L3';
    if (scope === 'studio' && !isMemberCred) {
      status = 'needs_review';   // 0.0.15 共识上层:agent 提案,member 凭证 resolve 拍板后生效
      note = '已登记为共识提案(needs_review):待 member 级凭证确认后生效';
    }
    const importance = args.importance === undefined ? 0.5 : Number(args.importance);
    if (!Number.isFinite(importance) || importance < 0 || importance > 1) fail('memory.save: importance must be 0..1');
    const tags = args.tags === undefined ? [] : args.tags;
    if (!Array.isArray(tags) || tags.some((x) => typeof x !== 'string')) fail('memory.save: tags must be string[]');
    const now = nowISO();
    const entry: Entry = {
      schema_version: 1,
      id: '',
      layer: 1,                                   // 候选一律 L1(M08 §2)
      scope,
      owner: { member: identity.member, agent: scope === 'agent' ? identity.agent_label : undefined },
      title: '',                                  // 缺省取正文首行(file-store 归一化)
      kind,
      importance,
      stability: defaultStability(1),
      access_count: 0,
      last_access: now,
      status,
      pinned: false,
      superseded_by: null,
      source_ids: [],
      tags: tags as string[],
      // 0.0.16.22:save 自动盖 project=agent_label(审计发现标签落地率 0%;显式传参优先,检索仍按显式 project 过滤)
      project: (typeof args.project === 'string' && args.project.trim()) ? args.project : (identity.agent_label || undefined),
      created_by: createdByOf(identity),
      created_at: now,
      updated_at: now,
      body: content,
    };
    const id = await ctx.store.upsertEntry(entry);
    return { id, layer: 1, status, note };
  },

  'memory.search': async (ctx, args) => {
    const query = needStr(args, 'query', 'memory.search');
    const includeArchived = args.includeArchived === true;
    const limitRaw = args.limit === undefined ? 10 : Number(args.limit);
    if (!Number.isFinite(limitRaw) || limitRaw < 1) fail('memory.search: limit must be >=1');
    const limit = Math.min(Math.floor(limitRaw), 50);
    const scope = args.scope === undefined ? undefined : String(args.scope) as EntryMeta['scope'];
    const { ranked } = await rankCandidates(ctx.store, ctx.identity, {
      query,
      project: typeof args.project === 'string' ? args.project : undefined,
      includeArchived,
      scope,
      now: new Date(),
    });
    return {
      query,
      total: ranked.length,
      results: ranked.slice(0, limit).map((r) => ({
        id: r.entry.id, layer: r.entry.layer, scope: r.entry.scope, status: r.entry.status, title: r.entry.title, project: r.entry.project, created_by: r.entry.created_by,   // 0.0.17.0:M09 发布流追溯(created_by=import:*) || undefined,
        score: Number(r.score.toFixed(4)),
        snippet: r.entry.body.replace(/\s+/g, ' ').trim().slice(0, 160),
        source_ids: r.entry.source_ids,
      })),
    };
  },

  'memory.context': async (ctx, args) => {
    const query = needStr(args, 'query', 'memory.context');
    const budget = args.budget === undefined ? undefined : Number(args.budget);
    if (budget !== undefined && (!Number.isFinite(budget) || budget < 200)) fail('memory.context: budget must be >=200 tokens');
    // 0.0.16.0:tocOnly —— 纯标题目录(领航灯用),让 agent 随时可见库中有什么;不加新工具(工具数红线 8 不破)
    if (args.tocOnly === true) {
      const titles: string[] = [];
      for await (const m of ctx.store.scanMeta()) {
        if (m.status !== 'active') continue;
        if (!visibleTo(ctx.identity, m as never)) continue;
        titles.push((m.layer === 3 ? 'L3' : m.layer === 2 ? 'L2' : 'L1') + ' ' + m.title);
      }
      titles.sort((x, y) => (y.startsWith('L3') ? 1 : 0) - (x.startsWith('L3') ? 1 : 0));
      const shown = titles.slice(0, 14);
      const text = '[记忆目录 · ' + titles.length + ' 条在线' + (titles.length > shown.length ? ',示 ' + shown.length : '') + '] ' + shown.join(' / ') + ' —— 细节: memory.search';
      return { toc: true, count: titles.length, chars: text.length, text };
    }
    const res = await retrieve(ctx.store, ctx.identity, {
      query,
      project: typeof args.project === 'string' ? args.project : undefined,
      budgetTokens: budget,
      now: new Date(),
    });
    const out: Record<string, unknown> = { budget: res.budgetTokens, chars: res.text.length, matched: res.selected.length, text: res.text };
// 访客 0 命中提示:最常见故障是"没带 _brainToken"——给出去路,不泄内容
if (!ctx.identity && res.selected.length === 0) {
  let total = 0;
  for await (const m of ctx.store.scanMeta()) { if (m.status !== 'archived') total++; }
  if (total > 0) out.note = '访客仅可见 studio 作用域(命中 0)。库中存在 ' + total + ' 条 agent/member 记忆:从工作区 .brain.json 取 token,作为工具参数 _brainToken 传入即可查看(不是 HTTP Bearer 头)。可先调 memory.whoami 验证身份。';
}
return out;
  },

  'memory.submit_session': async (ctx, args) => {
    const sessionId = needStr(args, 'session_id', 'memory.submit_session');
    const kind = needStr(args, 'kind', 'memory.submit_session');
    if (kind !== 'digest' && kind !== 'full') fail('memory.submit_session: kind must be digest|full');
    let content = typeof args.content === 'string' ? args.content : '';
    const p = typeof args.path === 'string' ? args.path : '';
    if (!content && !p) fail('memory.submit_session: provide content or path');
    if (!content) content = await fs.readFile(p, 'utf8');
    const hash = typeof args.hash === 'string' && args.hash ? args.hash : crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    const spoolDir = path.join((ctx.store as unknown as { root: string }).root, '_spool');
    await ensureDir(spoolDir);
    const file = path.join(spoolDir, hash.slice(0, 16) + '.json');
    if (await exists(file)) return { duplicate: true, hash, note: 'duplicate, 已忽略(幂等)' };
    await atomicWriteFile(file, JSON.stringify({
      ts: nowISO(), session_id: sessionId, kind, hash,
      identity: ctx.identity ? identityToString(ctx.identity) : null,
      content,
    }, null, 2));
    return { accepted: true, hash };
  },

  'memory.stats': async (ctx) => {
    let l1 = 0, l2 = 0, l3 = 0, archived = 0, review = 0, superseded = 0;
    const scopes: Record<string, number> = { studio: 0, member: 0, agent: 0 };
    for await (const m of ctx.store.scanMeta()) {
      if (m.layer === 1) l1++; else if (m.layer === 2) l2++; else l3++;
      if (m.status === 'archived') archived++;
      else if (m.status === 'needs_review') review++;
      else if (m.status === 'superseded') superseded++;
      if (m.scope === 'studio') scopes.studio++; else if (m.scope === 'member') scopes.member++; else if (m.scope === 'agent') scopes.agent++;
    }
    const store = ctx.store as { getQuarantined?: () => string[] };
    const root = (ctx.store as unknown as { root: string }).root;
    // M10 §2:近 7 天检索命中(recall-log 聚合;坏行跳过)
    let queries7d = 0, hits7d = 0;
    try {
      const dir = path.join(root, 'recall-log');
      const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
      for (const f of (await fs.readdir(dir)).filter((x) => x.endsWith('.jsonl'))) {
        const text = await fs.readFile(path.join(dir, f), 'utf8');
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try {
            const rec = JSON.parse(line) as { ts?: string; ids?: string[] };
            if (rec.ts && Date.parse(rec.ts) >= cutoff) { queries7d++; hits7d += Array.isArray(rec.ids) ? rec.ids.length : 0; }
          } catch { /* 坏行跳过 */ }
        }
      }
    } catch { /* 无 recall-log → 0 */ }
    // M10 §2:巩固 run 历史摘要(consolidation-state.last_run;无则 null)
    let consolidation: unknown = null;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(root, '..', 'consolidation-state.json'), 'utf8')) as { last_run?: unknown };
      consolidation = raw.last_run ?? null;
    } catch { consolidation = null; }
    return {
      layers: { L1: l1, L2: l2, L3: l3 },
      scopes,
      status: { active: l1 + l2 + l3 - archived - review - superseded, superseded, archived, needs_review: review },
      quarantined: typeof store.getQuarantined === 'function' ? store.getQuarantined()!.length : 0,
      recall_7d: { queries: queries7d, hits: hits7d },
      consolidation,
      generated_at: nowISO(),
    };
  },

  'memory.whoami': async (ctx) => {
    const role = roleOf(ctx.identity);
    return {
      identity: ctx.identity ? identityToString(ctx.identity) : null,
      role,
      allowed: allowedTools(role),
      note: ctx.identity ? undefined : '未识别连接:只读访客(search/context/whoami)',
    };
  },

  'memory.review_list': async (ctx, args) => {
    const action = needStr(args, 'action', 'memory.review_list');
    if (action === 'list') {
      const items: unknown[] = [];
      for await (const e of ctx.store.iterateByScope({})) {
        if (e.status === 'needs_review' && visibleTo(ctx.identity, e)) {
          items.push({ id: e.id, layer: e.layer, kind: e.kind, title: e.title, snippet: e.body.slice(0, 120) });
        }
      }
      return { action, count: items.length, items };
    }
    if (action === 'resolve') {
      const id = needStr(args, 'id', 'memory.review_list(resolve)');
      const verdict = needStr(args, 'verdict', 'memory.review_list(resolve)');
      if (verdict !== 'active' && verdict !== 'superseded' && verdict !== 'archived') {
        fail('memory.review_list: verdict must be active|superseded|archived');
      }
      const cur = await pickById(ctx.store, id);
      if (!cur) fail('memory.review_list: unknown id ' + id);
      if (cur.status !== 'needs_review') fail('memory.review_list: entry not in needs_review (status: ' + cur.status + ')');
      assertTransition(cur.status, verdict as EntryMeta['status']);
      await ctx.store.patchMeta(id, { status: verdict as EntryMeta['status'] });
      if (verdict !== 'active') return { id, status: verdict };
      // 0.0.15 共识激活:返回可能冲突的旧条目(仅建议;取代由 member 用 edit supersede 显式执行)
      const dtags = new Set((cur.tags || []).map((x) => String(x).toLowerCase()));
      const dtitle = String(cur.title || '').toLowerCase();
      const cands: { id: string; title: string; scope: string; kind: string }[] = [];
      for await (const e of ctx.store.iterateByScope({})) {
        if (e.id === id || e.status !== 'active') continue;
        const eTitle = String(e.title || '').toLowerCase();
        const tOver = dtitle.length > 3 && (eTitle.includes(dtitle) || dtitle.includes(eTitle));
        if (tOver || (e.tags || []).some((x) => dtags.has(String(x).toLowerCase()))) {
          cands.push({ id: e.id, title: e.title, scope: e.scope, kind: e.kind });
        }
      }
      return { id, status: verdict, conflict_candidates: cands };
    }
    fail('memory.review_list: action must be list|resolve');
  },

  'memory.edit': async (ctx, args) => {
    const id = needStr(args, 'id', 'memory.edit');
    const action = needStr(args, 'action', 'memory.edit');
    const cur = await pickById(ctx.store, id);
    if (!cur) fail('memory.edit: unknown id ' + id);
    if (action === 'edit') {
      const content = needStr(args, 'content', 'memory.edit(edit)');
      const body = typeof args.reason === 'string' && args.reason ? content + '\n\n> [edit reason] ' + args.reason : content;
      await ctx.store.upsertEntry({ ...cur, body, updated_at: nowISO() });
      return { id, action, note: 'body updated' };
    }
    if (action === 'pin') { await ctx.store.patchMeta(id, { pinned: true }); return { id, pinned: true }; }
    if (action === 'unpin') { await ctx.store.patchMeta(id, { pinned: false }); return { id, pinned: false }; }
    if (action === 'forget') {
      assertTransition(cur.status, 'archived');
      await ctx.store.patchMeta(id, { status: 'archived' });
      return { id, status: 'archived', note: 'archived 可逆,显式搜索(includeArchived)可命中' };
    }
    if (action === 'restore') {
      assertTransition(cur.status, 'active');
      await ctx.store.patchMeta(id, { status: 'active' });
      return { id, status: 'active' };
    }
    if (action === 'supersede') {
      const ref = needStr(args, 'ref', 'memory.edit(supersede)');
      const refEntry = await pickById(ctx.store, ref);
      if (!refEntry) fail('memory.edit(supersede): unknown ref id ' + ref);
      if (cur.status !== 'active') fail('memory.edit(supersede): only active entries can be superseded (status: ' + cur.status + ')');
      assertTransition(cur.status, 'superseded');
      await ctx.store.patchMeta(id, { status: 'superseded', superseded_by: ref });
      return { id, status: 'superseded', superseded_by: ref };
    }
    fail('memory.edit: action must be edit|pin|unpin|forget|restore|supersede');
  },

  // 0.0.17.0 M09 发布流第一步:打包(member 独占)。缺省全量 active;可按 scope/project 过滤。
  'memory.export': async (ctx, args) => {
    const scope = typeof args.scope === 'string' && ['all', 'studio', 'agent', 'member'].includes(args.scope) ? args.scope : 'all';
    const project = typeof args.project === 'string' ? args.project : undefined;
    const entries: Entry[] = [];
    for await (const e of ctx.store.iterateByScope({ includeArchived: false })) {
      if (scope !== 'all' && e.scope !== scope) continue;
      if (project && e.project !== project) continue;
      entries.push(e);
    }
    if (!ctx.dataDir) fail('memory.export: dataDir unavailable');
    const dir = path.join(ctx.dataDir, 'exports');
    await ensureDir(dir);
    const ts = nowISO().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(dir, 'export-' + ts + '-' + crypto.randomBytes(3).toString('hex') + '.json');
    const bundle = { schema_version: 1, kind: 'memory-bundle', from: ctx.identity ? identityToString(ctx.identity) : 'manual', exported_at: nowISO(), entries };
    await atomicWriteFile(file, JSON.stringify(bundle, null, 1));
    const byScope: Record<string, number> = {};
    for (const e of entries) byScope[e.scope] = (byScope[e.scope] || 0) + 1;
    return { file, count: entries.length, byScope, note: 'bundle 交对方 member 执行 memory.import;导入一律 needs_review,由对方逐条确认(M09 §3 显式发布流)' };
  },

  // 0.0.17.0 M09 发布流第二步:导入(member 独占)。一律 needs_review + created_by=import:*,人工闸在 review_list。
  'memory.import': async (ctx, args) => {
    const p2 = needStr(args, 'path', 'memory.import');
    let bundle: { kind?: string; from?: string; entries?: Entry[] };
    try { bundle = JSON.parse(await fs.readFile(p2, 'utf8')); } catch { fail('memory.import: 无法读取 bundle: ' + p2); }
    if (!bundle || bundle.kind !== 'memory-bundle' || !Array.isArray(bundle.entries)) fail('memory.import: 不是有效的 memory-bundle 文件');
    let imported = 0, skipped_exists = 0, skipped_dup = 0;
    const ids: string[] = [];
    const fpOf = (t: string, b: string) => crypto.createHash('sha1').update(t + '\n' + b).digest('hex');
    const existing = new Map<string, string>();   // fp -> title(内容级去重)
    for await (const cur of ctx.store.iterateByScope({ includeArchived: true })) existing.set(fpOf(cur.title, cur.body), cur.id);
    for (const raw of bundle.entries) {
      const e = raw as Entry;
      if (!e || typeof e.id !== 'string' || !e.id) { skipped_dup++; continue; }
      if (await pickById(ctx.store, e.id)) { skipped_exists++; continue; }
      const title = typeof e.title === 'string' && e.title ? e.title : '(无标题)';
      const body = typeof e.body === 'string' ? e.body : '';
      if (existing.has(fpOf(title, body))) { skipped_dup++; continue; }
      const layer = (e.layer === 1 || e.layer === 2 || e.layer === 3) ? e.layer : 1;
      const scope = (SAVE_SCOPES as readonly string[]).includes(e.scope) ? e.scope : 'member';
      const id = await ctx.store.upsertEntry({
        schema_version: 1, id: '', layer, scope: scope as Scope,
        owner: e.owner && typeof e.owner === 'object' ? e.owner : { member: 'local', agent: '' },
        title, kind: (KINDS as readonly string[]).includes(e.kind) ? e.kind : 'fact',
        importance: typeof e.importance === 'number' ? e.importance : 0.5,
        stability: typeof e.stability === 'number' ? e.stability : defaultStability(layer),
        access_count: 0, last_access: nowISO(), status: 'needs_review', pinned: false,
        superseded_by: null, source_ids: Array.isArray(e.source_ids) ? e.source_ids : [], tags: Array.isArray(e.tags) ? e.tags : [],
        created_by: 'import:' + String(bundle.from || 'remote'),
        created_at: nowISO(), updated_at: nowISO(),
        body,
      });
      existing.set(fpOf(title, body), id);
      ids.push(id); imported++;
    }
    return { imported, skipped_exists, skipped_dup, ids, note: '导入条目均为 needs_review;member 用 memory.review_list resolve 逐条确认激活(M09 发布流人工闸)' };
  },
};

/**
 * 统一入口(M08 §3):权限闸门 → 分发 → 统一错误语义 { error } + isError。
 * 权限拒绝写明需要 member token;身份缺失在 needStr 之前的闸门已挡。
 */
export async function callTool(ctx: ToolCtx, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  try {
    if (!handlers[name]) fail('unknown tool: ' + name);
    assertCanInvoke(roleOf(ctx.identity), name);
    const content = await handlers[name](ctx, args);
    return { content, isError: false };
  } catch (e) {
    return { content: { error: e instanceof Error ? e.message : String(e) }, isError: true };
  }
}

export function isKnownTool(name: string): boolean { return !!handlers[name]; }
export { canInvoke };
