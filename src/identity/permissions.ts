import type { Identity } from '../types.js';

export type Role = 'agent' | 'member' | 'guest';

/** M08 工具名(v1 八个) */
export const MEMORY_TOOLS = [
  'memory.save', 'memory.search', 'memory.context', 'memory.submit_session',
  'memory.stats', 'memory.whoami', 'memory.review_list', 'memory.edit',
] as const;

/**
 * 权限矩阵(M07 §4):闸门在 hub 工具分发处执行,存储层不重复实现。
 * agent 一切写入降级为"候选"(L1 起),与原则 3 一致。
 */
const MATRIX: Record<Role, ReadonlySet<string>> = {
  guest: new Set(['memory.search', 'memory.context', 'memory.whoami']),   // whoami 全部可用(M08 §2,调试)
  agent: new Set(['memory.save', 'memory.search', 'memory.context', 'memory.submit_session', 'memory.stats', 'memory.whoami']),
  member: new Set([...MEMORY_TOOLS]),
};

/** 身份 → 角色:null=访客;agent_label 非空=agent;空=member 级凭证 */
export function roleOf(identity: Identity | null): Role {
  if (!identity) return 'guest';
  return identity.agent_label ? 'agent' : 'member';
}

export function canInvoke(role: Role, tool: string): boolean {
  return MATRIX[role].has(tool);
}

export function allowedTools(role: Role): string[] {
  return [...MATRIX[role]];
}

/** 拒绝时给出可操作的提示(验收:agent 调 edit 需明确提示要 member token) */
export function assertCanInvoke(role: Role, tool: string): void {
  if (canInvoke(role, tool)) return;
  const need = role === 'guest' ? 'a registered identity (current: read-only guest)' : 'a member token';
  throw new Error('permission denied: ' + tool + ' requires ' + need + ' (role: ' + role + ')');
}
