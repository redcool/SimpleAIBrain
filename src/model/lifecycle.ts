import type { EntryMeta, EntryStatus } from '../types.js';

/** 状态机(M03 §6):superseded 为终态,只读。 */
const TRANSITIONS: Record<EntryStatus, EntryStatus[]> = {
  active: ['superseded', 'archived', 'needs_review'],
  needs_review: ['active', 'superseded', 'archived'],
  archived: ['active'],                       // 显式恢复
  superseded: [],
};

export function canTransition(from: EntryStatus, to: EntryStatus): boolean {
  return (TRANSITIONS[from] || []).includes(to);
}

export function assertTransition(from: EntryStatus, to: EntryStatus): void {
  if (!canTransition(from, to)) throw new Error('illegal transition: ' + from + ' -> ' + to);
}

/** 访问统计(M04/M05 从 recall-log 汇总后作为证据输入) */
export interface AccessStats {
  distinct_sessions: number;                  // 命中过该条目的不同会话数
  referring_sessions?: number;                // 引用该条目的不同会话数(L2→L3 备择)
  same_topic_group?: boolean;                 // 同主题 L1 归并批次(M05 判定)
}

export interface PromotionVerdict { eligible: boolean; reason: string; }

/**
 * 升层证据判定(M03 §4):时间只用于衰减,不用于升层。
 * 纯函数;达标者进候选集,决策者仍是巩固任务(M05)。
 */
export function promotionVerdict(meta: EntryMeta, stats: AccessStats): PromotionVerdict {
  if (meta.layer === 1) {
    if (stats.same_topic_group === true) return { eligible: true, reason: 'grouped into same-topic L1 batch' };
    if (stats.distinct_sessions >= 2 && meta.access_count >= 3) {
      return { eligible: true, reason: 'hit across >=2 sessions and access_count >=3' };
    }
    return { eligible: false, reason: 'L1->L2 needs same-topic group, or >=2 sessions + access_count >=3' };
  }
  if (meta.layer === 2) {
    if (stats.distinct_sessions >= 3) return { eligible: true, reason: 'hit across >=3 sessions' };
    if (meta.importance >= 0.8 && (stats.referring_sessions ?? 0) >= 2) {
      return { eligible: true, reason: 'importance >=0.8 with >=2 referring sessions' };
    }
    if (meta.pinned === true) return { eligible: true, reason: 'pinned' };
    return { eligible: false, reason: 'no L2->L3 evidence' };
  }
  return { eligible: false, reason: 'already at L3' };
}

/** 冲突消解判定(M03 §5):只判定路径,落库与 needs_review 暂存由 M05/M08 执行。 */
export type ConflictDecision = 'supersede' | 'needs_review';

export function resolveConflict(
  oldMeta: Pick<EntryMeta, 'importance' | 'pinned' | 'kind'>,
): ConflictDecision {
  if (oldMeta.pinned === true) return 'needs_review';        // 只能人工解除
  if (oldMeta.kind === 'decision') return 'needs_review';    // 决策记录不自动覆盖
  if (oldMeta.importance >= 0.8) return 'needs_review';
  return 'supersede';
}

/** supersede 时新条目继承旧条目溯源链(去重;不改旧条目——不毁证据) */
export function inheritProvenance(
  oldMeta: Pick<EntryMeta, 'id' | 'source_ids'>,
  newMeta: EntryMeta,
): void {
  const merged = [...newMeta.source_ids];
  for (const s of [oldMeta.id, ...oldMeta.source_ids]) {
    if (!merged.includes(s)) merged.push(s);
  }
  newMeta.source_ids = merged;
}
