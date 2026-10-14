// SimpleAIBrain 插件入口(v0.0.2:存储层先行;完整六钩子在 M01 联调时接入)
export * from './types.js';
export type { MemoryStore } from './store/types.js';
export { FileStore, FrontmatterError } from './store/file-store.js';
export { ulid, newMemId, newRunId } from './util/id.js';
export { gitCommitIfRepo } from './util/git.js';
export const VERSION = '0.0.2';
