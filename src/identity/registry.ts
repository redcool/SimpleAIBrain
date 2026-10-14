import crypto from 'node:crypto';
import type { Identity } from '../types.js';
import { atomicWriteFile, exists } from '../util/fsutil.js';
import { identityToString, parseIdentityId } from './identity.js';

/** 随机 32 字节 → base64url(M07 §2;绝不用字段拼接) */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

interface TokenFile { schema_version: 1; tokens: Record<string, string>; }

/**
 * token 注册表:内存映射 ID → SHA-256(token)。
 * 明文 token 只在签发/登记时经过一次,持久层只存哈希。
 * 文件位置由 hub 决定(M07 §3);吊销/轮换不动 ID,记忆归属不受影响。
 */
export class TokenRegistry {
  private hashes = new Map<string, string>();
  constructor(readonly filePath: string) {}

  async load(): Promise<void> {
    this.hashes.clear();
    if (!(await exists(this.filePath))) return;
    const { readFile } = await import('node:fs');
    const text = await (await import('node:fs/promises')).readFile(this.filePath, 'utf8');
    const data = JSON.parse(text) as TokenFile;
    if (!data || data.schema_version !== 1 || typeof data.tokens !== 'object') {
      throw new Error('token file malformed: ' + this.filePath);
    }
    for (const [id, hash] of Object.entries(data.tokens)) this.hashes.set(id, hash);
  }

  private async save(): Promise<void> {
    const data: TokenFile = { schema_version: 1, tokens: Object.fromEntries(this.hashes) };
    await atomicWriteFile(this.filePath, JSON.stringify(data, null, 2) + '\n');
  }

  /** 签发新 token 并登记;返回明文 token(仅此一次) */
  async issue(identity: Identity): Promise<string> {
    const token = generateToken();
    await this.register(identity, token);
    return token;
  }

  /** 登记已有 token(例如 .brain.json 里用户自备的) */
  async register(identity: Identity, token: string): Promise<void> {
    if (typeof token !== 'string' || token.length < 32) throw new Error('token too short (32-byte random expected)');
    this.hashes.set(identityToString(identity), hashToken(token));
    await this.save();
  }

  /** token → 身份;查不到/未带 → null(只读访客) */
  resolve(token: string | undefined | null): Identity | null {
    if (!token) return null;
    const h = hashToken(token);
    for (const [id, hash] of this.hashes) {
      if (hash === h) return parseIdentityId(id);
    }
    return null;
  }

  /** 轮换:换 token,ID 不变;旧 token 立即失效 */
  async rotate(identity: Identity, newToken?: string): Promise<string> {
    const token = newToken ?? generateToken();
    await this.register(identity, token);
    return token;
  }

  /** 吊销:删映射;返回是否存在过 */
  async revoke(identity: Identity): Promise<boolean> {
    const had = this.hashes.delete(identityToString(identity));
    if (had) await this.save();
    return had;
  }

  list(): string[] { return [...this.hashes.keys()]; }
}
