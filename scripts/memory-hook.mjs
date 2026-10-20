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
import os from 'node:os';
const TRACE = 'H:/ai_works/SimpleAIBrain/data/hook-state/trace.log';
const TRACE2 = path.join(os.tmpdir(), 'dsh-hook-trace.log');
function trace(o) { const line = JSON.stringify(Object.assign({ t: new Date().toISOString(), v: process.version, cwd0: process.cwd(), exec: process.execPath }, o)) + '\n'; try { fs.appendFileSync(TRACE2, line); } catch {} try { fs.mkdirSync(path.dirname(TRACE), { recursive: true }); fs.appendFileSync(TRACE, line); } catch {} }
const die = (why) => { const info = 'MEMORY-HOOK-DIE why=' + why + ' | cwd0=' + process.cwd() + ' | evtKeys=' + JSON.stringify(typeof evt !== 'undefined' ? Object.keys(evt || {}) : null) + ' | evtCwd=' + (typeof evt !== 'undefined' ? evt.cwd : null) + ' | bjExists=' + (typeof bjPath !== 'undefined' ? fs.existsSync(bjPath) : '?') + ' | v=' + process.version; try { process.stderr.write(info + '\n'); } catch {} trace({ why }); try { if (fs.existsSync('H:/ai_works/SimpleAIBrain/tmp/hook-debug.flag')) { const evName2 = (typeof evt !== 'undefined' && evt.hook_event_name) || 'UserPromptSubmit'; process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: evName2, additionalContext: info } }) + '\n'); } } catch {} process.exit(0); };

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

function boot() { const line = new Date().toISOString() + ' | ' + process.version + ' | ' + process.execPath + ' | argv=' + JSON.stringify(process.argv.slice(1)); try { fs.appendFileSync(path.join(os.tmpdir(), 'dsh-hook-boot.log'), line + '\n'); } catch {} try { fs.appendFileSync('H:/ai_works/SimpleAIBrain/data/hook-state/boot.log', line + '\n'); } catch {} }
boot();

async function main() {
  const raw = await readStdin();
  trace({ step: 'stdin', bytes: raw.length, head: raw.slice(0, 220) });
  let evt = {};
  try { evt = JSON.parse(raw); } catch { /* 无载荷或非 JSON → 仍可按 cwd 继续 */ }
  const cwd = evt.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const eventName = evt.hook_event_name || 'SessionStart';
  const bjPath = path.join(cwd, '.brain.json');
  trace({ step: 'cwd-check', path: bjPath, exists: fs.existsSync(bjPath) });
  if (!fs.existsSync(bjPath)) die('no-brain-json');
  let bj; try { bj = JSON.parse(fs.readFileSync(bjPath, 'utf8')); } catch (e) { die('bj-parse:' + e.message.slice(0, 60)); }
  if (!bj || !bj.token) die('no-token');
  // 节流:SessionStart 恒注入并重置计时;UserPromptSubmit 间隔内跳过
  const sid = String(evt.session_id || cwd);
  const stateFile = path.join(STATE_DIR, crypto.createHash('sha1').update(sid).digest('hex').slice(0, 16) + '.json');
  let st = null;
  try {
    st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (eventName !== 'SessionStart' && process.env.SIMPLEBRAIN_HOOK_NO_THROTTLE !== '1') {
      if (Date.now() - (st.lastInject || 0) < PROMPT_THROTTLE_MS) die('throttled');
    }
  } catch { /* 无状态 → 视为首次 */ }
  let promptText = typeof evt.prompt === 'string' ? evt.prompt : '';
  const bi = promptText.indexOf('[记忆上下文');
  if (bi >= 0) promptText = promptText.slice(0, bi);
  promptText = promptText.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (promptText && promptText.length < 4 && eventName !== 'SessionStart') die('trivial-prompt');
  const prompt = promptText || FALLBACK_QUERY;
  const query = prompt || FALLBACK_QUERY;
  const body = {
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'memory.context', arguments: { query, _brainToken: bj.token, budget: 2000 } },
  };
  let resp;
  try {
    resp = await fetch(HUB + '/rpc', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
  } catch (e) { die('fetch:' + e.message.slice(0, 80)); }
  trace({ step: 'fetched', status: resp ? resp.status : null });
  if (!resp || !resp.ok) die('http-' + (resp ? resp.status : 'null'));
  let j; try { j = await resp.json(); } catch (e) { die('json:' + e.message.slice(0, 60)); }
  let payload = j && j.result && Array.isArray(j.result.content) ? String(j.result.content[0].text) : '';
  try { const inner = JSON.parse(payload); if (inner && typeof inner.text === 'string' && inner.text.trim()) payload = inner.text; } catch { /* 原样输出 */ }
  payload = payload.trim();
  if (!payload) die('empty-payload');
  const hash = crypto.createHash('sha1').update(payload).digest('hex').slice(0, 16);
  if (eventName !== 'SessionStart' && process.env.SIMPLEBRAIN_HOOK_NO_THROTTLE !== '1') {
    if (st && st.lastHash === hash) die('same-content');
    if (Date.now() - (st && st.lastInject || 0) < 10 * 60 * 1000) die('rate-limited');
  }
  trace({ step: 'inject', chars: payload.length });
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ lastInject: Date.now(), lastHash: hash, event: eventName, query: query.slice(0, 80) }) + '\n');
  } catch { /* 状态失败不影响注入 */ }
  const evName = (typeof evt !== 'undefined' && evt.hook_event_name) || 'UserPromptSubmit';
  const structured = JSON.stringify({ hookSpecificOutput: { hookEventName: evName, additionalContext: payload } });
  process.stdout.write(structured + '\n');
  trace({ step: 'done', structured: true });
}
main().then(() => { /* 成功路径已在 trace done */ }, (e) => die('uncaught:' + (e && e.message || '').slice(0, 80)));
