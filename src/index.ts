// SimpleAIBrain 插件入口(v0.0.2:存储层先行;完整六钩子在 M01 联调时接入)
export * from './types.js';
export type { MemoryStore } from './store/types.js';
export { FileStore, FrontmatterError } from './store/file-store.js';
export { ulid, newMemId, newRunId } from './util/id.js';
export { gitCommitIfRepo } from './util/git.js';
export { DEFAULTS, recallScore, strengthen, decaySweep } from './model/scoring.js';
export type { DecayOptions, DecayReport } from './model/scoring.js';
export { canTransition, assertTransition, promotionVerdict, resolveConflict, inheritProvenance } from './model/lifecycle.js';
export type { AccessStats, PromotionVerdict, ConflictDecision } from './model/lifecycle.js';
export const VERSION = '0.0.3';
