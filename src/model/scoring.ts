import type { EntryMeta } from '../types.js';

/** 默认参数(待校准,M03 §8):开跑两周后按 stats 调整 */
export const DEFAULTS = { k: 0.25, floor: 0.15 } as const;

export interface DecayOptions { floor?: number; k?: number; }

export interface DecayReport {
  scores: { id: string; R: number }[];
  toArchive: { id: string; R: number }[];   // 仅 status=active 且未 pin
}

/** 存活评分 R = importance · e^(−Δt/S),Δt 单位小时(M03 §3)。纯函数。 */
export function recallScore(
  meta: Pick<EntryMeta, 'importance' | 'stability' | 'last_access'>,
  now: Date,
): number {
  const dtMs = now.getTime() - Date.parse(meta.last_access);
  const dtH = Math.max(0, dtMs / 3600000);           // 未来时间戳按 0 处理
  const S = Math.max(meta.stability, Number.EPSILON);
  return meta.importance * Math.exp(-dtH / S);
}

/** 检索命中即复习:S ← S·(1+k)。k 默认 0.25。 */
export function strengthen(stability: number, k: number = DEFAULTS.k): number {
  return stability * (1 + k);
}

/**
 * 衰减扫描(随每日巩固 run 执行,不单独起任务):
 * R < 地板值 → 归档候选(可逆,恢复 = patchMeta 回 active)。
 * pinned 跳过扫描;superseded/archived/needs_review 不参与归档。
 * 纯函数:只报清单,落库由调用方(M05)经 store.patchMeta 执行。
 */
export function decaySweep(metas: EntryMeta[], now: Date, opts: DecayOptions = {}): DecayReport {
  const floor = opts.floor ?? DEFAULTS.floor;
  const scores: { id: string; R: number }[] = [];
  const toArchive: { id: string; R: number }[] = [];
  for (const m of metas) {
    const R = recallScore(m, now);
    scores.push({ id: m.id, R });
    if (m.status === 'active' && m.pinned !== true && R < floor) toArchive.push({ id: m.id, R });
  }
  return { scores, toArchive };
}
