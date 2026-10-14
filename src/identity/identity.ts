import type { Identity } from '../types.js';

/** 身份段字符集(M07 §2):小写 [a-z0-9-_.],段内不允许 '/' */
const SEG_RE = /^[a-z0-9-_.]+$/;
/** agent_label 额外允许 '@'(harness 标签,文档示例 builder@claude-code) */
const LABEL_RE = /^[a-z0-9-_.@]+$/;

export class IdentityError extends Error {}

/** 规范化建议(仅用于报错信息,不自动改写——显式优于隐式) */
export function normalizeSegment(s: string, allowAt = false): string {
  return s
    .toLowerCase()
    .replace(allowAt ? /[^a-z0-9-_.@]+/g : /[^a-z0-9-_.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function checkSeg(kind: string, value: unknown, optional = false, allowAt = false): string {
  if (value === undefined || value === null || value === '') {
    if (optional) return '';
    throw new IdentityError(kind + ' must be a non-empty string');
  }
  if (typeof value !== 'string') throw new IdentityError(kind + ' must be a string');
  const re = allowAt ? LABEL_RE : SEG_RE;
  if (!re.test(value)) {
    throw new IdentityError(
      kind + ' "' + value + '" has invalid characters: only [a-z0-9-_.] lowercase allowed' + (allowAt ? ' (agent_label also allows @)' : '') + '. suggested: "' + normalizeSegment(value, allowAt) + '"',
    );
  }
  return value;
}

/**
 * 构造并校验身份。agent_label 允许为空串 = member 级凭证(M07 §4 权限层)。
 * project 不在这里——它是每次操作的数据标签,不进身份。
 */
export function makeIdentity(studio: unknown, member: unknown, agentLabel: unknown = ''): Identity {
  return {
    studio: checkSeg('studio', studio),
    member: checkSeg('member', member),
    agent_label: checkSeg('agent_label', agentLabel, true, true),
  };
}

export function identityToString(id: Identity): string {
  return id.studio + '/' + id.member + '/' + id.agent_label;
}

/** 段内字符集保证不含 '/',三段解析安全 */
export function parseIdentityId(s: string): Identity {
  const parts = s.split('/');
  if (parts.length !== 3) throw new IdentityError('identity id must be <studio>/<member>/<agent_label>: ' + s);
  return makeIdentity(parts[0], parts[1], parts[2]);
}
