#!/usr/bin/env node
// M07 - enroll: give a workspace its .brain.json (identity + random token, registered into the hub TokenRegistry).
// The user never hand-crafts the token; the memory system mints it (crypto.randomBytes(32), like an apikey).
//
// Usage:
//   node scripts/enroll.mjs [workspaceDir] [--studio s1] [--member local] [--agent <label>]
//                          [--data-dir <hub data dir>] [--force]
// Defaults: workspaceDir = cwd, studio = s1, member = local, agent = <workspace dir name>,
//           data-dir = --data-dir > $DSH_BRAIN_DATA > hub config(aiBrain.dataDir ?? aiBrain.path/data) > <本仓库>/data(兜底,带警告).
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
// data-dir 探测顺序:显式 flag → $DSH_BRAIN_DATA → hub config(aiBrain.dataDir ?? aiBrain.path/data)→ 本仓库 data 兜底
function defaultDataDir() {
  try {
    const hubCfg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'SimpleMcpServer', 'config.json');
    const c = JSON.parse(fs2.readFileSync(hubCfg, 'utf8'));
    if (c.aiBrain && c.aiBrain.dataDir) return c.aiBrain.dataDir;
    if (c.aiBrain && c.aiBrain.path) return path.join(c.aiBrain.path, 'data');
  } catch { /* 探测失败走兜底 */ }
  const selfData = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
  console.warn('[enroll] 警告:hub config 不可读,dataDir 兜底到 ' + selfData + '(与 hub 实际路径可能分叉,注册前请确认或用 --data-dir 显式指定)');
  return selfData;
}
const dataDir = path.resolve(flags['data-dir'] || process.env.DSH_BRAIN_DATA || defaultDataDir());
function hubPort() {
  try {
    const hubCfg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'SimpleMcpServer', 'config.json');
    const c = JSON.parse(fs2.readFileSync(hubCfg, 'utf8'));
    if (c && (c.port || c.serverPort)) return Number(c.port || c.serverPort);
  } catch { /* 探测失败用默认 */ }
  return 45678;
}
const PORT = hubPort();
const bjPath = path.join(ws, '.brain.json');

let existing = null;
try { existing = JSON.parse(await fs.readFile(bjPath, 'utf8')); } catch { /* not enrolled yet */ }
if (existing && existing.token && !flags.force) {
  console.log('[enroll] already enrolled: ' + [existing.studio, existing.member, existing.agent_label].join('/'));
  console.log('[enroll] identity/token unchanged; use --force to mint a new token (rotate keeps id).');
  await hubCheck(existing.token);
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
  const section = ['', '## 记忆系统使用(由 enroll.mjs 生成,0.0.16.13)', '> 开始任务前:读本目录 `.brain.json` 取 token → 调用 hub(默认 127.0.0.1:45678,以部署实际为准)的 `memory.context`,**token 作为工具参数 `_brainToken` 传入**(不是 HTTP Bearer 头)。可先 `memory.whoami` 验证身份。不带 token = 访客,只看 studio 作用域,0 命中不代表没记忆。', '> 会话结束(或用户说"存储记忆"):调 `memory.submit_session`,`session_id`=当前会话 id,`kind`="digest",`content`=本会话关键决定与新知识(400-1200 字,带出处,不含密钥)。', '> 用户口令全表(存储记忆/获取记忆/查找记忆/记忆体检/登记记忆):<SimpleAIBrain>/docs/用户指令.md(部署约定:SimpleAIBrain 与 SimpleMcpServer 为同根兄弟目录;或设环境变量 SIMPLEAIBRAIN_HOME 指向 SimpleAIBrain 仓库)。', '> 不要直接读记忆库数据文件当记忆来源——只有走工具才有正确的可见性与脱敏。',
'> 记忆之门 = hub(SimpleMcpServer,127.0.0.1:45678)。调用 memory.* 报 ECONNREFUSED/fetch failed = 门没开:向用户报告,由用户在**可见 cmd 窗口**启动 hub(启动与核对方法见 <SimpleAIBrain>/docs/用户指令.md(部署约定:SimpleAIBrain 与 SimpleMcpServer 为同根兄弟目录;或设环境变量 SIMPLEAIBRAIN_HOME 指向 SimpleAIBrain 仓库)「记忆之门」节);agent 不应私自后台拉起 hub。', ''].join('\n');
  await fs.writeFile(agentsPath, agents + section, 'utf8');
  console.log('[enroll] wrote memory guide section into ' + agentsPath + (agents ? ' (appended)' : ' (created)'));
}

// M11 补充(0.0.16.11):记忆之门健康检查——在线则验证身份,离线则给启动指引(不代为启动)
async function hubCheck(token) {
  try {
    const r = await fetch('http://127.0.0.1:' + PORT + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory.whoami', arguments: { _brainToken: token } } }), signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    const txt = j && j.result && Array.isArray(j.result.content) ? String(j.result.content[0].text) : '';
    console.log('[enroll] hub: ONLINE (127.0.0.1:45678) — ' + (txt ? txt.replace(/\s+/g, ' ').slice(0, 120) : 'whoami ok'));
  } catch {
    console.log('[enroll] hub: OFFLINE — 记忆之门未启动(' + PORT + ' 无响应)。');
    console.log('[enroll]   启动方法:在可见 cmd 窗口运行 hub 启动命令(SimpleMcpServer),核对 banner 时间戳;详见 <SimpleAIBrain>/docs/用户指令.md(部署约定:SimpleAIBrain 与 SimpleMcpServer 为同根兄弟目录;或设环境变量 SIMPLEAIBRAIN_HOME 指向 SimpleAIBrain 仓库)「记忆之门」节。');
    console.log('[enroll]   .brain.json 已就绪,hub 启动后即可用;enroll 不代为启动(可见窗口纪律)。');
  }
}
await hubCheck(JSON.parse(await fs.readFile(bjPath, 'utf8')).token);
