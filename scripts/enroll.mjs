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
const dataDir = path.resolve(flags['data-dir'] || process.env.DSH_BRAIN_DATA || 'H:/ai_works/SimpleMcpServer/data');
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
