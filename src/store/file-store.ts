import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Entry, EntryMeta, Layer, L0Record, ScopeQuery } from '../types.js';
import { newMemId } from '../util/id.js';
import { slugify } from '../util/slug.js';
import { atomicWriteFile, ensureDir, nowISO, sanitizeSeg, uniqueFile } from '../util/fsutil.js';
import type { MemoryStore } from './types.js';

const SKIP_DIRS = new Set(['_spool', '_quarantine', 'L0-log', 'recall-log', '_identity']);
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const TMP_RE = /\.tmp-[0-9a-f]+$/;
const SCOPES = ['session', 'agent', 'member', 'studio'];
const KINDS = ['fact', 'preference', 'event', 'procedure', 'decision'];
const STATUSES = ['active', 'superseded', 'archived', 'needs_review'];

export class FrontmatterError extends Error {}

function fail(why: string): never { throw new FrontmatterError(why); }

function splitFrontmatter(content: string): { raw: Record<string, unknown>; body: string } {
  const m = FM_RE.exec(content);
  if (!m) fail('frontmatter delimiters missing');
  let raw: unknown;
  try { raw = parseYaml(m![1]); } catch (e) { fail('yaml parse failed: ' + (e instanceof Error ? e.message : String(e))); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('frontmatter is not a mapping');
  return { raw: raw as Record<string, unknown>, body: m![2].replace(/^\r?\n/, '') };
}

function validateMeta(raw: Record<string, unknown>): EntryMeta {
  if (raw.schema_version !== 1) fail('schema_version must be 1');
  if (typeof raw.id !== 'string' || !/^mem_[0-9A-HJKMNP-TV-Z]{26}$/.test(raw.id)) fail('bad id');
  if (raw.layer !== 1 && raw.layer !== 2 && raw.layer !== 3) fail('bad layer');
  if (typeof raw.scope !== 'string' || !SCOPES.includes(raw.scope)) fail('bad scope');
  const owner = raw.owner as { member?: unknown; agent?: unknown } | undefined;
  if (!owner || typeof owner !== 'object' || typeof owner.member !== 'string') fail('bad owner');
  if (raw.scope !== 'studio' && !owner.member) fail('owner.member required for non-studio scope');
  if ((raw.scope === 'agent' || raw.scope === 'session') && typeof owner.agent !== 'string') fail('owner.agent required for agent/session scope');
  if (typeof raw.title !== 'string' || !raw.title.trim()) fail('bad title');
  if (typeof raw.kind !== 'string' || !KINDS.includes(raw.kind)) fail('bad kind');
  if (typeof raw.importance !== 'number' || !(raw.importance >= 0 && raw.importance <= 1)) fail('bad importance');
  if (typeof raw.stability !== 'number' || !(raw.stability > 0)) fail('bad stability');
  if (typeof raw.access_count !== 'number' || raw.access_count < 0) fail('bad access_count');
  for (const d of ['last_access', 'created_at', 'updated_at']) {
    if (typeof raw[d] !== 'string' || Number.isNaN(Date.parse(raw[d] as string))) fail('bad ' + d);
  }
  if (typeof raw.status !== 'string' || !STATUSES.includes(raw.status)) fail('bad status');
  if (raw.superseded_by !== null && typeof raw.superseded_by !== 'string') fail('bad superseded_by');
  if (!Array.isArray(raw.source_ids) || raw.source_ids.some((x) => typeof x !== 'string')) fail('bad source_ids');
  if (typeof raw.created_by !== 'string' || !raw.created_by) fail('bad created_by');
  if (raw.pinned !== undefined && typeof raw.pinned !== 'boolean') fail('bad pinned');
  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.some((x) => typeof x !== 'string'))) fail('bad tags');
  const meta = raw as unknown as EntryMeta;
  meta.pinned = raw.pinned === true;
  return meta;
}

function serializeEntry(meta: EntryMeta, body: string): string {
  return '---\n' + stringifyYaml(meta as unknown as Record<string, unknown>, { lineWidth: 0 }) + '---\n\n' + body.trim() + '\n';
}

function firstLine(s: string): string { return (s || '').split(/\r?\n/)[0].trim().slice(0, 60); }

function fileBase(meta: EntryMeta): string {
  const date = (meta.created_at || nowISO()).slice(0, 10);
  return date + '_' + (slugify(meta.title) || 'entry') + '.md';
}

/**
 * 文件后端(M02)。单实例 = 单写者;所有变更走本类,外部直改依赖 rescan 兜底。
 * 索引:id → meta / id → 文件路径;由 init/rescan 全量构建。
 */
export class FileStore implements MemoryStore {
  readonly root: string;
  private index = new Map<string, EntryMeta>();
  private paths = new Map<string, string>();
  private quarantined: string[] = [];

  constructor(root: string) { this.root = root; }

  get size(): number { return this.index.size; }
  getQuarantined(): string[] { return [...this.quarantined]; }
  has(id: string): boolean { return this.index.has(id); }

  async init(): Promise<void> {
    await ensureDir(this.root);
    await this.cleanTmp();
    await this.rescan();
  }

  /** 清理崩溃残留的 tmp 文件(原子写只留 temp+rename,残留即为垃圾) */
  private async cleanTmp(): Promise<void> {
    await this.walk(this.root, async (file) => {
      if (TMP_RE.test(path.basename(file))) await fs.rm(file, { force: true });
    });
  }

  /** 全量重建索引;解析失败 → _quarantine,不静默丢弃(M02 §5) */
  async rescan(): Promise<void> {
    const nextIndex = new Map<string, EntryMeta>();
    const nextPaths = new Map<string, string>();
    this.quarantined = [];
    await this.walk(this.root, async (file) => {
      if (!file.toLowerCase().endsWith('.md')) return;
      try {
        const content = await fs.readFile(file, 'utf8');
        const { raw } = splitFrontmatter(content);
        const meta = validateMeta(raw);
        nextIndex.set(meta.id, meta);
        nextPaths.set(meta.id, file);
      } catch (err) {
        await this.quarantine(file, err);
      }
    });
    this.index = nextIndex;
    this.paths = nextPaths;
  }

  private async quarantine(file: string, err: unknown): Promise<void> {
    try {
      const qdir = path.join(this.root, '_quarantine');
      await ensureDir(qdir);
      const dest = await uniqueFile(qdir, path.basename(file));
      await fs.rename(file, dest);
      this.quarantined.push(path.basename(dest) + ' :: ' + (err instanceof Error ? err.message : String(err)));
    } catch { /* 隔离失败不崩 */ }
  }

  private async walk(dir: string, visit: (file: string) => Promise<void>): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      if (d.name.startsWith('.')) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (SKIP_DIRS.has(d.name)) continue;
        await this.walk(full, visit);
      } else {
        await visit(full);
      }
    }
  }

  private dirFor(meta: EntryMeta): string {
    const L = 'L' + meta.layer;
    if (meta.scope === 'studio') return path.join(this.root, 'studio', L);
    const member = sanitizeSeg(meta.owner.member || 'unknown');
    if (meta.scope === 'member') return path.join(this.root, 'members', member, L);
    const agent = sanitizeSeg(meta.owner.agent || 'default');
    return path.join(this.root, 'members', member, 'agents', agent, L);
  }

  async *scanMeta(): AsyncIterable<EntryMeta> { yield* this.index.values(); }

  async *iterateByScope(q: ScopeQuery = {}): AsyncIterable<Entry> {
    for (const meta of this.index.values()) {
      if (q.scope && meta.scope !== q.scope) continue;
      if (q.layer && meta.layer !== q.layer) continue;
      let allow: EntryMeta['status'][] | undefined;
      if (q.status) allow = Array.isArray(q.status) ? [...q.status] : [q.status];
      else if (!q.includeArchived) allow = ['active', 'superseded', 'needs_review'];
      if (allow && !allow.includes(meta.status)) continue;
      if (q.member && meta.owner.member !== q.member) continue;
      if (q.agent_label && meta.owner.agent !== q.agent_label) continue;
      if (q.project && meta.project !== q.project) continue;
      yield { ...meta, body: await this.readBody(meta.id) };
    }
  }

  async readBody(id: string): Promise<string> {
    const file = this.paths.get(id);
    if (!file) fail('unknown id: ' + id);
    const content = await fs.readFile(file!, 'utf8');
    return splitFrontmatter(content).body;
  }

  async upsertEntry(input: Entry): Promise<string> {
    const meta: EntryMeta = { ...input };
    const now = nowISO();
    if (!meta.id) meta.id = newMemId();
    meta.schema_version = 1;
    if (!meta.created_at) meta.created_at = now;
    meta.updated_at = now;
    if (meta.importance === undefined) meta.importance = 0.5;
    if (meta.stability === undefined) meta.stability = 1.0;
    if (meta.access_count === undefined) meta.access_count = 0;
    if (!meta.last_access) meta.last_access = meta.created_at;
    if (!meta.status) meta.status = 'active';
    if (meta.pinned === undefined) meta.pinned = false;
    if (meta.superseded_by === undefined) meta.superseded_by = null;
    if (!meta.source_ids) meta.source_ids = [];
    if (!meta.tags) meta.tags = [];
    if (!meta.created_by) meta.created_by = 'unknown';
    if (!meta.scope) meta.scope = meta.owner?.agent ? 'agent' : 'member';
    if (!meta.title || !meta.title.trim()) meta.title = firstLine(input.body) || 'untitled';
    validateMeta(meta as unknown as Record<string, unknown>);

    const dir = this.dirFor(meta);
    await ensureDir(dir);
    let file = this.paths.get(meta.id);
    if (!file) file = await uniqueFile(dir, fileBase(meta));
    await atomicWriteFile(file, serializeEntry(meta, input.body));
    this.index.set(meta.id, meta);
    this.paths.set(meta.id, file);
    return meta.id;
  }

  async moveEntry(id: string, toLayer: Layer): Promise<void> {
    const meta = this.index.get(id);
    const file = this.paths.get(id);
    if (!meta || !file) fail('unknown id: ' + id);
    if (meta.layer === toLayer) return;
    const body = await this.readBody(id);
    const newMeta: EntryMeta = { ...meta, layer: toLayer, updated_at: nowISO() };
    const dir = this.dirFor(newMeta);
    await ensureDir(dir);
    const newFile = await uniqueFile(dir, path.basename(file));
    await atomicWriteFile(newFile, serializeEntry(newMeta, body));
    await fs.rm(file, { force: true });   // git 视为 rename(内容近似),历史由 git 跟随
    this.index.set(id, newMeta);
    this.paths.set(id, newFile);
  }

  static PATCHABLE: ReadonlySet<string> = new Set([
    'title', 'project', 'importance', 'stability', 'access_count', 'last_access',
    'status', 'superseded_by', 'source_ids', 'pinned', 'tags',
  ]);

  async patchMeta(id: string, patch: Partial<EntryMeta>): Promise<void> {
    const meta = this.index.get(id);
    const file = this.paths.get(id);
    if (!meta || !file) fail('unknown id: ' + id);
    for (const k of Object.keys(patch)) {
      if (!FileStore.PATCHABLE.has(k)) fail('field not patchable: ' + k + ' (use moveEntry/upsertEntry)');
    }
    const body = await this.readBody(id);
    const newMeta: EntryMeta = { ...meta, ...patch, updated_at: nowISO() };
    validateMeta(newMeta as unknown as Record<string, unknown>);
    await atomicWriteFile(file, serializeEntry(newMeta, body));
    this.index.set(id, newMeta);
  }

  async appendLog(rec: L0Record): Promise<void> {
    const ym = (rec.ts || nowISO()).slice(0, 7);
    const dir = path.join(this.root, 'L0-log', ym);
    await ensureDir(dir);
    const file = path.join(dir, sanitizeSeg(rec.agent_label || 'unknown') + '.jsonl');
    await fs.appendFile(file, JSON.stringify(rec) + '\n', 'utf8');
  }
}
