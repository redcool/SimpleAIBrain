#!/usr/bin/env node
// memory-hook.mjs — DSH SessionStart/UserPromptSubmit 钩子(0.0.15.2)
// 从 stdin 读 Claude Code 钩子载荷 {session_id, cwd, prompt, hook_event_name};
// 会话 cwd 有 .brain.json(已登记)时,把 memory.context 的检索结果打到 stdout,
// 桥会把 plain stdout 作为 additionalContext 注入下一轮模型请求。
// 任何失败都静默 exit 0(钩子 exit 2 会阻断,绝不走到);绝不打印 token。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const HUB = process.env.SIMPLEBRAIN_HUB_URL || 'http://127.0.0.1:45678';
const STATE_DIR = 'H:/ai_works/SimpleAIBrain/data/hook-state';
const PROMPT_THROTTLE_MS = 20 * 60 * 1000; // UserPromptSubmit 两次注入最小间隔
const FALLBACK_QUERY = '核心规则 决策 进度';
const die = () => process.exit(0);

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(''));
    setTimeout(() => resolve(buf), 3000).unref();
  });
}

async function main() {
  const raw = await readStdin();
  let evt = {};
  try { evt = JSON.parse(raw); } catch { /* 无载荷或非 JSON → 仍可按 cwd 继续 */ }
  const cwd = evt.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const eventName = evt.hook_event_name || 'SessionStart';
  const bjPath = path.join(cwd, '.brain.json');
  if (!fs.existsSync(bjPath)) die();
  let bj; try { bj = JSON.parse(fs.readFileSync(bjPath, 'utf8')); } catch { die(); }
  if (!bj || !bj.token) die();
  // 节流:SessionStart 恒注入并重置计时;UserPromptSubmit 间隔内跳过
  const sid = String(evt.session_id || cwd);
  const stateFile = path.join(STATE_DIR, crypto.createHash('sha1').update(sid).digest('hex').slice(0, 16) + '.json');
  try {
    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (eventName !== 'SessionStart' && process.env.SIMPLEBRAIN_HOOK_NO_THROTTLE !== '1') {
      if (Date.now() - (st.lastInject || 0) < PROMPT_THROTTLE_MS) die();
    }
  } catch { /* 无状态 → 视为首次 */ }
  const prompt = typeof evt.prompt === 'string' ? evt.prompt.trim().slice(0, 200) : '';
  const query = prompt || FALLBACK_QUERY;
  const body = {
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'memory.context', arguments: { query, _brainToken: bj.token } },
  };
  let resp;
  try {
    resp = await fetch(HUB + '/rpc', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
  } catch { die(); }
  if (!resp || !resp.ok) die();
  let j; try { j = await resp.json(); } catch { die(); }
  let payload = j && j.result && Array.isArray(j.result.content) ? String(j.result.content[0].text) : '';
  try { const inner = JSON.parse(payload); if (inner && typeof inner.text === 'string' && inner.text.trim()) payload = inner.text; } catch { /* 原样输出 */ }
  payload = payload.trim();
  if (!payload) die();
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ lastInject: Date.now(), event: eventName, query: query.slice(0, 80) }) + '\n');
  } catch { /* 状态失败不影响注入 */ }
  process.stdout.write(payload + '\n');
}
main().then(die, die);
