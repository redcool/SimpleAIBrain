import crypto from 'node:crypto';

// Crockford Base32(ULID 字母表)
const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 时间可排序 ID:10 字符时间戳(50bit,毫秒) + 16 字符随机(80bit)= 标准 26 字符 */
export function ulid(now = Date.now()): string {
  let ts = now;
  let tsChars = '';
  for (let i = 0; i < 10; i++) { tsChars = ENC[ts % 32] + tsChars; ts = Math.floor(ts / 32); }
  let n = BigInt('0x' + crypto.randomBytes(10).toString('hex'));
  let rand = '';
  for (let i = 0; i < 16; i++) { rand = ENC[Number(n % 32n)] + rand; n /= 32n; }
  return tsChars + rand;
}

export function newMemId(): string { return 'mem_' + ulid(); }
export function newRunId(): string { return 'run_' + ulid(); }
