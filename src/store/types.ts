import type { Entry, EntryMeta, Layer, L0Record, ScopeQuery } from '../types.js';

/** M02 §2:七操作 + 生命周期(init/rescan)。PgStore(v3)实现同一签名。 */
export interface MemoryStore {
  init(): Promise<void>;
  rescan(): Promise<void>;
  scanMeta(): AsyncIterable<EntryMeta>;
  readBody(id: string): Promise<string>;
  upsertEntry(entry: Entry): Promise<string>;
  moveEntry(id: string, toLayer: Layer): Promise<void>;
  patchMeta(id: string, patch: Partial<EntryMeta>): Promise<void>;
  appendLog(rec: L0Record): Promise<void>;
  iterateByScope(q?: ScopeQuery): AsyncIterable<Entry>;
}
