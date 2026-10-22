import fs from 'node:fs';
import path from 'node:path';
import { TokenRegistry } from '../identity/registry.js';
import { makeIdentity, identityToString } from '../identity/identity.js';

/** M07+ 用户建议(0.0.16.15):member 凭证自动保障——幂等;写入 <hub>/data/member-credential.json(部署约定:hub 与本仓库同根兄弟;失败则退回 dataDir)。 */
export async function ensureMemberCredential(registry: TokenRegistry, dataDir: string): Promise<{ file: string; action: 'exists' | 'created' | 'rotated' }> {
  let outDir = path.resolve(dataDir, '..', '..', 'SimpleMcpServer', 'data');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch { outDir = dataDir; }
  const file = path.join(outDir, 'member-credential.json');
  if (fs.existsSync(file)) return { file, action: 'exists' };
  const member = makeIdentity('s1', 'local', '');
  const existed = registry.list().includes(identityToString(member));
  const token = await registry.issue(member);
  fs.writeFileSync(file, JSON.stringify({ note: 'member 级身份凭证(s1/local)——大脑手术专用:memory.edit 的 forget/edit/supersede 需要 member 角色。妥善保管,勿提交 git。', studio: 's1', member: 'local', token }, null, 2) + '\n', 'utf8');
  return { file, action: existed ? 'rotated' : 'created' };
}