#!/usr/bin/env node
// 0.0.16.15 用户指令「生成用户身份」:幂等确保 member(s1/local)凭证,打印位置与状态。
// 位置解析:$DSH_BRAIN_DATA → SimpleMcpServer/config.json(aiBrain.path 的 data)→ 兄弟目录约定。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileStore, ensureMemberCredential, TokenRegistry } from '../dist/index.js';

function resolveDataDir() {
  if (process.env.DSH_BRAIN_DATA) return process.env.DSH_BRAIN_DATA;
  try {
    const hubCfg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'SimpleMcpServer', 'config.json');
    const c = JSON.parse(fs.readFileSync(hubCfg, 'utf8'));
    if (c.aiBrain && c.aiBrain.dataDir) return c.aiBrain.dataDir;
    if (c.aiBrain && c.aiBrain.path) return path.join(c.aiBrain.path, 'data');
  } catch { /* 兜底 */ }
  return 'H:/ai_works/SimpleAIBrain/data';
}
const dataDir = resolveDataDir();
const registry = new TokenRegistry(path.join(dataDir, 'memory', '_identity', 'tokens.json'));
await registry.load();
const mc = await ensureMemberCredential(registry, dataDir);
console.log('[member-identity] ' + mc.action + ': ' + mc.file);
console.log('[member-identity] 身份 s1/local(role=member)——memory.edit/大脑手术专用;勿提交 git。');