import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export async function ensureDir(dir: string): Promise<void> { await fs.mkdir(dir, { recursive: true }); }

export function nowISO(): string { return new Date().toISOString(); }

/** 原子写:同卷 temp + rename(M02 §5) */
export async function atomicWriteFile(file: string, content: string): Promise<void> {
  const tmp = path.join(path.dirname(file), path.basename(file) + '.tmp-' + crypto.randomBytes(4).toString('hex'));
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}

/** 路径段清洗:文件系统非法字符 → '-',小写,去首尾点空格,限长 */
export function sanitizeSeg(s: string, max = 64): string {
  const out = (s || '')
    .toLowerCase()
    .replace(/[\x00-\x1f\\/:*?"<>|]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, max)
    .replace(/[.\s-]+$/g, '');
  return out || 'unknown';
}

/** 目标文件已存在则插短随机后缀,保证不覆盖(纪律 3) */
export async function uniqueFile(dir: string, base: string): Promise<string> {
  let file = path.join(dir, base);
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  while (await exists(file)) {
    file = path.join(dir, stem + '-' + crypto.randomBytes(2).toString('hex') + ext);
  }
  return file;
}

export async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
