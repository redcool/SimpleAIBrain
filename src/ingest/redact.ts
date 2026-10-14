/** M06 §6:共享脱敏(强制点)。工具流水 args / 会话正文 / 导入 md 统一走这里;脱敏后才允许落 L0。 */

const SECRET_KEY_RE = /token|password|secret|apikey|api_key|authorization|credential/i;

// 常见密钥形态(前缀模式):OpenAI sk-、GitHub pat、AWS AKIA、JWT
const SECRET_VALUE_RES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{12,}\b/g,
  /\beyJ[A-Za-z0-9_-]{20,}\b/g,
];

/** 正文/文本脱敏:密钥形态打码 + "含敏感词的字段" 打码 + 截断(默认 2048,M06 §6) */
export function redactText(text: string, maxChars = 2048): string {
  let s = String(text ?? '');
  for (const re of SECRET_VALUE_RES) s = s.replace(re, '[REDACTED]');
  s = s.replace(/("(?:[^"\\]*(?:token|password|secret|apikey|api_key|authorization|credential)[^"\\]*)"(\s*:\s*)")([^"\\]*)(")/gi, '$1[REDACTED]$4');
  if (s.length > maxChars) s = s.slice(0, maxChars) + '…(truncated)';
  return s;
}

/** 工具流水 args 脱敏(M01 onToolEvent 用):键名打码 + 摘要截断 */
export function redactArgs(args: Record<string, unknown> | undefined | null, maxChars = 2048): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    out[k] = SECRET_KEY_RE.test(k) ? '[REDACTED]' : v;
  }
  let s = JSON.stringify(out);
  if (s === undefined || s === null) s = '{}';
  if (s.length > maxChars) s = s.slice(0, maxChars) + '…(truncated)';
  return s;
}

export { SECRET_KEY_RE };
