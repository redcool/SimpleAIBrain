import { execFile } from 'node:child_process';
import path from 'node:path';
import { exists } from './fsutil.js';

function execGit(args: string[], cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true }, (err, stdout, stderr) => {
      const out = ((stdout || '') + (stderr || '')).trim();
      const code = err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : (err ? 1 : 0);
      resolve({ code, out });
    });
  });
}

/**
 * data/ 若是 git 仓库则 add+commit(M05 每次巩固 run 结束调用)。
 * 非仓库 / git 缺失 / 无变更 → 返回 false,绝不抛错。
 */
export async function gitCommitIfRepo(dir: string, message: string): Promise<boolean> {
  try {
    if (!(await exists(path.join(dir, '.git')))) return false;
    const probe = await execGit(['--version'], dir);
    if (probe.code !== 0) return false;
    await execGit(['add', '-A'], dir);
    const c = await execGit(['commit', '-m', message], dir);
    // exit 1 + "nothing to commit" 属正常
    if (c.code !== 0 && !/nothing to commit/i.test(c.out)) return false;
    return true;
  } catch { return false; }
}
