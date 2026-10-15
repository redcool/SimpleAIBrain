import { readFile } from 'node:fs/promises';
import type { Identity } from '../types.js';
import { IdentityError, makeIdentity } from './identity.js';

export interface BrainJson { identity: Identity; token: string; ignore_session_prefix?: string; }

/**
 * 解析项目根的 .brain.json(M07 §3):
 * { "studio": "...", "member": "...", "agent_label": "...", "token": "<随机>" }
 * 字段非法 → IdentityError,错误信息带规范化建议(不自动改写)。
 */
export async function readBrainJson(file: string): Promise<BrainJson> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    throw new IdentityError('.brain.json unreadable at ' + file + ': ' + (e instanceof Error ? e.message : String(e)));
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new IdentityError('.brain.json must be a JSON object');
  }
  const o = raw as Record<string, unknown>;
  const token = o.token;
  if (typeof token !== 'string' || token.length < 32) {
    throw new IdentityError('.brain.json token missing or too short (32-byte random expected)');
  }
  const ignore = o.ignore_session_prefix;
  if (ignore !== undefined && typeof ignore !== 'string') {
    throw new IdentityError('.brain.json ignore_session_prefix must be a string (empty string disables)');
  }
  return { identity: makeIdentity(o.studio, o.member, o.agent_label ?? ''), token, ignore_session_prefix: ignore };
}
