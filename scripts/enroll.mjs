#!/usr/bin/env node
// M07 - enroll: give a workspace its .brain.json (identity + random token, registered into the hub TokenRegistry).
// The user never hand-crafts the token; the memory system mints it (crypto.randomBytes(32), like an apikey).
//
// Usage:
//   node scripts/enroll.mjs [workspaceDir] [--studio s1] [--member local] [--agent <label>]
//                          [--data-dir <hub data dir>] [--force]
// Defaults: workspaceDir = cwd, studio = s1, member = local, agent = <workspace dir name>,
//           data-dir = $DSH_BRAIN_DATA or H:/ai_works/SimpleMcpServer/data (hub default layout).
// Re-run without --force: prints current enrollment, changes nothing.
// --force: issue a NEW token and rewrite .brain.json (old token stays valid until revoked).
import fs from 'node:fs/promises';
import path from 'node:path';
import fs2 from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeIdentity, identityToString, normalizeSegment, TokenRegistry } from '../dist/index.js';

const argv = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const key = argv[i].slice(2);
    if (key === 'force') flags[key] = true;
    else flags[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '';
  } else pos.push(argv[i]);
}
const ws = path.resolve(pos[0] || process.cwd());
// data-dir 探测顺序:$DSH_BRAIN_DATA → 显式 flag → hub config(aiBrain.dataDir ?? aiBrain.path/data)→ SimpleMcpServer/data 兜底
function defaultDataDir() {
  try {
    const hubCfg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'SimpleMcpServer', 'config.json');
    const c = JSON.parse(fs2.readFileSync(hubCfg, 'utf8'));
    if (c.aiBrain && c.aiBrain.dataDir) return c.aiBrain.dataDir;
    if (c.aiBrain && c.aiBrain.path) return path.join(c.aiBrain.path, 'data');
  } catch { /* 探测失败走兜底 */ }
  return 'H:/ai_works/SimpleMcpServer/data';
}
const dataDir = path.resolve(flags['data-dir'] || process.env.DSH_BRAIN_DATA || defaultDataDir());
const bjPath = path.join(ws, '.brain.json');

let existing = null;
try { existing = JSON.parse(await fs.readFile(bjPath, 'utf8')); } catch { /* not enrolled yet */ }
if (existing && existing.token && !flags.force) {
  console.log('[enroll] already enrolled: ' + [existing.studio, existing.member, existing.agent_label].join('/'));
  console.log('[enroll] identity/token unchanged; use --force to mint a new token (rotate keeps id).');
  process.exit(0);
}

// 大写/空格等工作区名自动规范化(用户不出错);显式 flag 同样规范化
const identity = makeIdentity(normalizeSegment(flags.studio || 's1'), normalizeSegment(flags.member || 'local'), normalizeSegment(flags.agent || path.basename(ws), true));
const registry = new TokenRegistry(path.join(dataDir, 'memory', '_identity', 'tokens.json'));
await registry.load();
const token = await registry.issue(identity);
await fs.writeFile(bjPath, JSON.stringify({ studio: identity.studio, member: identity.member, agent_label: identity.agent_label, token: token }, null, 2) + '\n', 'utf8');
console.log('[enroll] wrote ' + bjPath);
console.log('[enroll] identity: ' + identityToString(identity));
console.log('[enroll] token registered at ' + registry.filePath + (existing ? ' (--force: new token minted)' : ''));
console.log('[enroll] keep .brain.json safe: the token is this agent credential (like an apikey).');
console.log('[enroll] optional workspace policy: "ignore_session_prefix": "no_brain" (sessions titled with this prefix are never ingested).');

// M07 补充:给工作区写记忆使用指引(AGENTS.md 记忆节)。已有记忆节则跳过;无 AGENTS.md 则新建。不覆盖既有内容。
const MARKER = 'memory.context';
const agentsPath = path.join(ws, 'AGENTS.md');
let agents = '';
try { agents = await fs.readFile(agentsPath, 'utf8'); } catch { /* 新建 */ }
if (agents.includes(MARKER)) {
  console.log('[enroll] AGENTS.md already has a memory section; left untouched.');
} else {
  const section = ['', '## 记忆系统使用(由 enroll.mjs 生成,0.0.13.11)', '> 开始任务前:读本目录 `.brain.json` 取 token → 调用 hub(127.0.0.1:45678)的 `memory.context`,**token 作为工具参数 `_brainToken` 传入**(不是 HTTP Bearer 头)。可先 `memory.whoami` 验证身份。不带 token = 访客,只看 studio 作用域,0 命中不代表没记忆。', '> 会话结束(或用户说"存储记忆"):调 `memory.submit_session`,`session_id`=当前会话 id,`kind`="digest",`content`=本会话关键决定与新知识(400-1200 字,带出处,不含密钥)。', '> 用户口令全表(存储记忆/获取记忆/查找记忆/记忆体检/登记记忆):H:/ai_works/SimpleAIBrain/docs/用户指令.md。', '> 不要直接读记忆库数据文件当记忆来源——只有走工具才有正确的可见性与脱敏。', ''].join('\n');
  await fs.writeFile(agentsPath, agents + section, 'utf8');
  console.log('[enroll] wrote memory guide section into ' + agentsPath + (agents ? ' (appended)' : ' (created)'));
}
