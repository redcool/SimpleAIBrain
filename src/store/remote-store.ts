import type { Entry, EntryMeta, L0Record, Layer, ScopeQuery } from '../types.js';
import type { MemoryStore } from './types.js';

/** M09 §4:RemoteStore——联邦只读端。实现读子集(iterateByScope/scanMeta/readBody),写操作一律拒绝并提示发布流。
 *  数据来源:对端 hub 的 POST /brain/query(联邦 token;服务方默认仅出 studio 条目,未授权返回空不报错)。 */
export class RemoteStore implements MemoryStore {
  private readonly url: string;
  private readonly token: string;
  private cache: Entry[] = [];
  constructor(opts: { url: string; token: string }) { this.url = opts.url.replace(/\/$/, ''); this.token = opts.token; }

  async init(): Promise<void> { await this.refresh(); }
  async rescan(): Promise<void> { await this.refresh(); }

  private async refresh(): Promise<void> {
    const r = await fetch(this.url + '/brain/query', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '', limit: 500, token: this.token }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error('federation query http-' + r.status + ' (remote=' + this.url + ')');
    const j = (await r.json()) as { results?: Array<Record<string, unknown>>; policy?: string };
    if (j.policy === 'denied') throw new Error('federation token rejected by remote (policy denied)');
    const now = new Date().toISOString();
    this.cache = (j.results || []).map((x) => ({
      schema_version: 1,
      id: String(x.id || ''),
      layer: (Number(x.layer) || 2) as Layer,
      scope: 'studio' as const,
      owner: { member: 'remote', agent: '' },
      title: String(x.title || '(无标题)'),
      kind: 'fact' as const,
      importance: typeof x.importance === 'number' ? x.importance : 0.5,
      stability: 1, access_count: 0,
      last_access: String(x.updated_at || now),
      status: 'active' as const, pinned: false, superseded_by: null,
      source_ids: [], tags: [],
      created_by: String(x.created_by || 'remote'),
      created_at: String(x.updated_at || now),
      updated_at: String(x.updated_at || now),
      body: String(x.body || ''),
    }));
  }

  async *scanMeta(): AsyncIterable<EntryMeta> {
    await this.refresh();
    for (const e of this.cache) {
      yield { id: e.id, layer: e.layer, scope: e.scope, owner: e.owner, title: e.title, kind: e.kind,
        importance: e.importance, stability: e.stability, access_count: e.access_count, last_access: e.last_access,
        status: e.status, pinned: e.pinned, superseded_by: e.superseded_by,
        created_by: e.created_by, created_at: e.created_at, updated_at: e.updated_at,
        source_ids: e.source_ids, tags: e.tags } as EntryMeta;
    }
  }

  async readBody(id: string): Promise<string> {
    await this.refresh();
    const e = this.cache.find((x) => x.id === id);
    return e ? e.body : '';
  }

  async *iterateByScope(_q?: ScopeQuery): AsyncIterable<Entry> {
    await this.refresh();
    for (const e of this.cache) yield e;   // 远端已按 studio-only 策略过滤(_q 忽略,文档见 M09 §4)
  }

  private deny(): never {
    throw new Error('M09 联邦只读:远程库不接受写操作;请走发布流(memory.export 打包 → 对方 member memory.import 确认)');
  }
  async upsertEntry(_e: Entry): Promise<string> { this.deny(); }
  async moveEntry(_id: string, _to: Layer): Promise<void> { this.deny(); }
  async patchMeta(_id: string, _p: Partial<EntryMeta>): Promise<void> { this.deny(); }
  async appendLog(_r: L0Record): Promise<void> { this.deny(); }
}
