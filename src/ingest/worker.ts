import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { MemoryStore } from '../store/types.js';
import type { Identity } from '../types.js';
import { parseIdentityId, identityToString } from '../identity/identity.js';
import { readBrainJson } from '../identity/brain-json.js';
import type { BrainJson } from '../identity/brain-json.js';
import { redactText } from './redact.js';
import { decodeDshArtifact, parseDshJsonlText, extractDshMeta } from './dsh.js';
import type { DshMeta } from './dsh.js';
import { ensureDir, nowISO } from '../util/fsutil.js';

/** M06 §5:parser 层。每 harness 一个,钉版本;格式漂移 → 拒绝并告警,不猜。 */
export interface Parser {
  version: number;
  parse(raw: string): string;
  /** 二进制 artifact(如 DSH 的 zstd 分帧 session 文件);提供时 transcript_path 以 Buffer 进入 */
  parseBuffer?(buf: Buffer): string;
}

function extractClaudeishText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** claude-jsonl v1 / codex-jsonl v1:每行一个 JSON,取 user/assistant 的 message.content */
function makeJsonlParser(name: string): Parser {
  return {
    version: 1,
    parse(raw: string): string {
      const lines = raw.split('\n').filter((l) => l.trim());
      const out: string[] = [];
      let malformed = 0;
      for (const line of lines) {
        let obj: { type?: string; message?: { content?: unknown } };
        try { obj = JSON.parse(line); } catch { malformed++; continue; }
        const type = obj.type;
        if (type !== 'user' && type !== 'assistant') continue;
        const text = extractClaudeishText(obj.message?.content).trim();
        if (text) out.push(type + ': ' + text);
      }
      if (out.length === 0 && (malformed > 0 || lines.length > 0) && malformed / Math.max(1, lines.length) > 0.3) {
        throw new Error(name + ': format drift suspected (' + malformed + '/' + lines.length + ' malformed lines), refusing to guess');
      }
      return out.join('\n');
    },
  };
}

export const PARSERS: Record<string, Parser> = {
  'claude-jsonl': makeJsonlParser('claude-jsonl'),
  'codex-jsonl': makeJsonlParser('codex-jsonl'),
  'digest-md': { version: 1, parse: (raw) => String(raw ?? '') },
  // DSH session.vN.jsonl.zstd(分帧 zstd;v1 钉 v3 行形)
  'dsh-jsonl': {
    version: 1,
    parse: (raw) => parseDshJsonlText(String(raw ?? '')),
    parseBuffer: (buf) => parseDshJsonlText(decodeDshArtifact(buf)),
  },
};

export function sha256hex(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

export interface IngestEvent {
  identity?: string | null;
  harness: string;
  session_id: string;
  kind?: string;
  transcript_path?: string;
  content?: string;
  hash?: string;
}

export interface IngestOptions {
  dataDir: string;
  store: MemoryStore;
  logger?: (msg: string) => void;
  maxParamChars?: number;                       // 默认 2048(M06 §6)
  watch?: { claude?: string | null; codex?: string | null; dsh?: string | null };   // 覆盖 transcript 对账目录;null 关闭该源
  drainIntervalMs?: number;                     // 默认 30s
  reconcileIntervalMs?: number;                 // 默认 10min
  watchEnabled?: boolean;
  dshIdleMs?: number;                           // DSH 活跃 session 静默阈值,默认 10min(防追加中反复重摄)
}

interface Manifest {
  schema_version: 1;
  sessions: Record<string, { hash: string; ts: string; identity?: string }>;
}

const WALK_MAX_FILES = 200;
const SUBMIT_CAP_PER_CYCLE = 50;

function safeParseIdentity(s: string | null | undefined): Identity | null {
  if (!s) return null;
  try { return parseIdentityId(s); } catch { return null; }
}

/** DSH 数据根(M06 §2):$DSH_HOME → ~/.dsh,与 @deepseek-ai/dsh-home-paths 同优先级 */
export function dshHome(): string {
  const env = process.env.DSH_HOME;
  if (env && env.trim()) return path.resolve(env.trim());
  return path.join(os.homedir(), '.dsh');
}

/**
 * M06:会话摄入 worker。
 * ingestOne = POST 语义(parser → 脱敏 → L0 → manifest);
 * drain = 排空 ingest-spool(hook 断网时落的便签,重放 ingestOne,成功含重复即删);
 * reconcile = 周期对账 transcript 目录(补交崩溃/断网漏掉的会话;manifest 缺行即补)。
 */
export class IngestWorker {
  private manifest: Manifest | null = null;
  private drainTimer?: ReturnType<typeof setInterval>;
  private reconcileTimer?: ReturnType<typeof setInterval>;
  private busy = false;

  constructor(private opts: IngestOptions) {}

  private get manifestFile(): string {
    return path.join(this.opts.dataDir, 'ingest-manifest.json');
  }

  private get spoolDir(): string {
    return path.join(this.opts.dataDir, 'ingest-spool');
  }

  private async loadManifest(): Promise<Manifest> {
    if (this.manifest) return this.manifest;
    try {
      const raw = JSON.parse(await fs.readFile(this.manifestFile, 'utf8'));
      if (raw && raw.schema_version === 1 && raw.sessions && typeof raw.sessions === 'object') {
        this.manifest = raw as Manifest;
        return this.manifest;
      }
    } catch { /* 首次/损坏 → 重置 */ }
    this.manifest = { schema_version: 1, sessions: {} };
    return this.manifest;
  }

  private async saveManifest(): Promise<void> {
    if (!this.manifest) return;
    await ensureDir(this.opts.dataDir);
    await fs.writeFile(this.manifestFile, JSON.stringify(this.manifest, null, 2) + '\n', 'utf8');
  }

  /** POST /brain/ingest 语义:parser → 脱敏 → L0 → manifest(session_id+hash 幂等) */
  async ingestOne(evt: IngestEvent): Promise<{ ok: boolean; duplicate?: boolean; hash?: string; error?: string }> {
    if (!evt || typeof evt !== 'object') return { ok: false, error: 'json body required' };
    const session_id = String(evt.session_id || '');
    if (!session_id) return { ok: false, error: 'session_id required' };
    const parser = PARSERS[evt.harness];
    if (!parser) return { ok: false, error: 'unknown harness: ' + String(evt.harness) + ' (known: ' + Object.keys(PARSERS).join('/') + ')' };
    if (!evt.identity) return { ok: false, error: 'no identity: workspace not enrolled (.brain.json)' };   // 0.0.12.0 opt-in:身份是摄入前提
    let raw = '';
    let rawBuf: Buffer | null = null;
    try {
      if (evt.content !== undefined && evt.content !== null && String(evt.content).length > 0) {
        raw = String(evt.content);
      } else if (evt.transcript_path) {
        rawBuf = await fs.readFile(evt.transcript_path);        // 同机只传路径(M06 §4);二进制(zstd)安全
      } else {
        return { ok: false, error: 'content or transcript_path required' };
      }
    } catch (e) {
      return { ok: false, error: 'transcript unreadable: ' + (e instanceof Error ? e.message : String(e)) };
    }
    let text: string;
    try {
      text = rawBuf !== null && parser.parseBuffer ? parser.parseBuffer(rawBuf) : parser.parse(rawBuf !== null ? rawBuf.toString('utf8') : raw);
    } catch (e) {
      this.opts.logger?.('[ai-brain] ingest parse failed (' + evt.harness + ' ' + session_id + '): ' + (e instanceof Error ? e.message : String(e)));
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (!text.trim()) return { ok: false, error: 'parser produced empty text' };
    const hash = evt.hash ? String(evt.hash) : sha256hex(text);
    const manifest = await this.loadManifest();
    const seen = manifest.sessions[session_id];
    if (seen && seen.hash === hash) return { ok: true, duplicate: true, hash };
    const identity = safeParseIdentity(evt.identity);
    const agent_label = identity ? (identity.agent_label || identity.member) : 'unknown';
    const maxChars = this.opts.maxParamChars ?? 2048;
    await this.opts.store.appendLog({
      ts: nowISO(),
      harness: evt.harness,
      agent_label,
      kind: 'session',
      session_id,
      digest: redactText(text, maxChars),       // 脱敏后才落 L0(M06 §6 强制点)
      hash,
    });
    manifest.sessions[session_id] = { hash, ts: nowISO(), identity: evt.identity };
    await this.saveManifest();
    return { ok: true, duplicate: false, hash };
  }

  /** 排空 spool:hook 断网时落的便签;成功(含重复)即删,失败保留下轮重试 */
  async drain(): Promise<number> {
    let files: string[] = [];
    try { files = (await fs.readdir(this.spoolDir)).filter((f) => f.endsWith('.json')).sort(); } catch { return 0; }
    let n = 0;
    for (const f of files) {
      const p = path.join(this.spoolDir, f);
      let evt: IngestEvent;
      try { evt = JSON.parse(await fs.readFile(p, 'utf8')); } catch {
        try { await fs.rm(p); } catch { /* 并发 */ }
        continue;                               // 损坏便签 → 丢弃(不猜)
      }
      const r = await this.ingestOne(evt);
      if (r.ok) {
        try { await fs.rm(p); } catch { /* 并发 */ }
        n++;
      }
    }
    return n;
  }

  /** 周期对账:扫 transcript 目录,manifest 缺行/哈希变化即补交(manifest 以文件为准:每轮强制重读,人工删行会被看到) */
  async reconcile(): Promise<number> {
    if (this.opts.watchEnabled === false) return 0;
    this.manifest = null;                       // 不信内存缓存(M06 §8:手工删行 → 补交)
    const home = os.homedir();
    const dirs: { harness: string; dir: string; zstd?: boolean; idleMs?: number }[] = [];
    const w = this.opts.watch || {};
    const claudeDir = w.claude === undefined ? path.join(home, '.claude', 'projects') : w.claude;
    const codexDir = w.codex === undefined ? path.join(home, '.codex', 'sessions') : w.codex;
    const dshDir = w.dsh === undefined ? path.join(dshHome(), 'sessions') : w.dsh;
    if (claudeDir) dirs.push({ harness: 'claude-jsonl', dir: claudeDir });
    if (codexDir) dirs.push({ harness: 'codex-jsonl', dir: codexDir });
    if (dshDir) dirs.push({ harness: 'dsh-jsonl', dir: dshDir, zstd: true, idleMs: this.opts.dshIdleMs ?? 600_000 });
    let submitted = 0;
    for (const d of dirs) {
      const files = await this.walkJsonl(d.dir, d.zstd === true);
      for (const f of files) {
        if (submitted >= SUBMIT_CAP_PER_CYCLE) return submitted;
        if (d.idleMs) {
          // DSH 活跃闸门:追加中的 session 不摄(防反复全文重摄);静默超阈值才提交
          try { const st = await fs.stat(f); if (Date.now() - st.mtimeMs < d.idleMs) continue; } catch { continue; }
        }
        // DSH:session 目录名即 id;claude/codex:文件名去 .jsonl
        const session_id = d.zstd ? path.basename(path.dirname(f)) : path.basename(f).replace(/\.jsonl$/i, '');
        let raw: Buffer;
        try { raw = await fs.readFile(f); } catch { continue; }
        const hash = crypto.createHash('sha256').update(raw).digest('hex');
        const manifest = await this.loadManifest();
        const seen = manifest.sessions[session_id];
        if (seen && seen.hash === hash) continue;
        let identity: string | null = null;
        if (d.zstd) {
          // opt-in(0.0.12.0):工作区 .brain.json 决定摄入;cwd 取自会话头,标题取末次 session/title
          let meta: DshMeta;
          try { meta = extractDshMeta(decodeDshArtifact(raw)); } catch { continue; }
          if (!meta.cwd) continue;
          let bj: BrainJson;
          try { bj = await readBrainJson(path.join(meta.cwd, '.brain.json')); } catch { continue; }   // 未登记/损坏 → 不摄不记 manifest(补文件即补摄历史)
          const prefix = bj.ignore_session_prefix === undefined ? 'no_brain' : bj.ignore_session_prefix;
          if (prefix && meta.title && meta.title.startsWith(prefix)) continue;
          identity = identityToString(bj.identity);
        }
        const r = await this.ingestOne({ harness: d.harness, session_id, kind: 'transcript', transcript_path: f, hash, identity });
        if (r.ok && !r.duplicate) submitted++;
      }
    }
    return submitted;
  }

  private async walkJsonl(dir: string, zstd = false): Promise<string[]> {
    const out: string[] = [];
    const walk = async (d: string, depth: number): Promise<void> => {
      if (depth > 4 || out.length >= WALK_MAX_FILES) return;
      let entries: string[] = [];
      try { entries = await fs.readdir(d); } catch { return; }
      for (const e of entries) {
        if (out.length >= WALK_MAX_FILES) return;
        const p = path.join(d, e);
        const isArtifact = e.endsWith('.jsonl') || (zstd && /\.jsonl\.zstd$/.test(e));
        if (isArtifact) { out.push(p); continue; }
        let st;
        try { st = await fs.stat(p); } catch { continue; }
        if (st.isDirectory()) await walk(p, depth + 1);
      }
    };
    await walk(dir, 0);
    return out;
  }

  /** 启动周期任务(drain + reconcile;均 unref,不阻退出) */
  start(): void {
    if (this.drainTimer) return;
    this.drainTimer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      void this.drain().catch(() => {}).finally(() => { this.busy = false; });
    }, this.opts.drainIntervalMs ?? 30_000);
    if (typeof this.drainTimer.unref === 'function') this.drainTimer.unref();
    this.reconcileTimer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      void this.reconcile().catch(() => {}).finally(() => { this.busy = false; });
    }, this.opts.reconcileIntervalMs ?? 600_000);
    if (typeof this.reconcileTimer.unref === 'function') this.reconcileTimer.unref();
  }

  stop(): void {
    if (this.drainTimer) { clearInterval(this.drainTimer); this.drainTimer = undefined; }
    if (this.reconcileTimer) { clearInterval(this.reconcileTimer); this.reconcileTimer = undefined; }
  }
}
