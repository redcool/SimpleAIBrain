// ── SimpleAIBrain 核心类型(M02/M03 共用) ──

export type Layer = 1 | 2 | 3;
export type Scope = 'session' | 'agent' | 'member' | 'studio';
export type MemoryKind = 'fact' | 'preference' | 'event' | 'procedure' | 'decision';
export type EntryStatus = 'active' | 'superseded' | 'archived' | 'needs_review';

export interface Identity {
  studio: string;
  member: string;
  agent_label: string;
}

export interface EntryOwner {
  member: string;   // studio 级允许 ''
  agent?: string;
}

/** frontmatter 事实源(M02 §4);目录只是地址 */
export interface EntryMeta {
  schema_version: 1;
  id: string;                    // mem_<ULID>
  layer: Layer;
  scope: Scope;
  owner: EntryOwner;
  title: string;
  project?: string;              // 数据标签,不进身份
  tags?: string[];               // 自由标签(M08 save 参数),缺省 []
  kind: MemoryKind;
  importance: number;            // 0..1
  stability: number;             // S,随访问增强
  access_count: number;
  last_access: string;           // ISO8601 UTC
  status: EntryStatus;
  pinned?: boolean;              // pin:跳过衰减与自动覆盖(M03 §3);缺省 false
  superseded_by: string | null;
  source_ids: string[];
  created_by: string;            // consolidation | <member_id> | agent:<id> | import
  created_at: string;            // ISO8601 UTC
  updated_at: string;
}

export interface Entry extends EntryMeta { body: string; }

/** M02 §2:iterateByScope 的过滤条件;status 缺省 = 非 archived */
export interface ScopeQuery {
  scope?: Scope;
  layer?: Layer;
  status?: EntryStatus | EntryStatus[];
  member?: string;
  agent_label?: string;
  project?: string;
  includeArchived?: boolean;
}

export type L0Kind = 'toolflow' | 'session' | 'digest';
export interface L0Record {
  ts: string;                    // ISO8601 UTC
  harness: string;
  agent_label: string;
  kind: L0Kind;
  session_id?: string;
  tool?: string;
  digest?: string;               // 已脱敏+截断
  hash?: string;
}
