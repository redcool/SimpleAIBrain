#!/usr/bin/env node
// M11-P1 auto-speak driver: spawn DSH ACP agent, drive task, auto-continue on idle.
// 用法: node scripts/auto-speak.mjs <workspaceDir> <taskText> [budget] [idleMs]
// 零补丁:只走官方 ACP 表面;状态落 data/auto-speak-state/;密钥不入日志。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [,, workspace, taskText, budgetArg, idleArg] = process.argv;
if (!workspace || !taskText) { console.error('usage: auto-speak <workspaceDir> <taskText> [budget=5] [idleMs=10000]'); process.exit(2); }
const BUDGET = Math.max(1, Number(budgetArg) || 5);
const IDLE_MS = Math.max(0, Number(idleArg) ?? 10000);
const PROMPT_TIMEOUT_MS = 10 * 60 * 1000;
const TOTAL_BUDGET_MS = 30 * 60 * 1000;
const DSH_BIN = 'H:/AI/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js';
const stateDir = 'H:/ai_works/SimpleAIBrain/data/auto-speak-state';
fs.mkdirSync(stateDir, { recursive: true });
const stateFile = path.join(stateDir, 'run-' + Date.now() + '.json');
const state = { started: new Date().toISOString(), workspace, task: taskText.slice(0, 200), budget: BUDGET, prompts: 0, stop: null, turns: [] };
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

const child = spawn(process.execPath, [DSH_BIN, '--profile', 'acp'], { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
let nextId = 1;
const pending = new Map();
const log = (m) => console.error('[driver] ' + m);

child.stdout.on('data', (d) => {
  buf += d.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line || line.startsWith('Content-Length')) continue;
    let msg; try { msg = JSON.parse(line); } catch { log('non-json line: ' + line.slice(0, 80)); continue; }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.code + ': ' + msg.error.message)) : p.resolve(msg.result); }
    } else if (msg.method) {
      if (msg.method === 'session/update') {
        const u = msg.params || {};
        if (u.update && u.update.sessionUpdate === 'agent_message_chunk' && u.update.content && u.update.content.text) {
          state.turns.push({ t: Date.now(), kind: 'chunk', text: u.update.content.text.slice(0, 400) });
        }
      } else { log('note: ' + msg.method); }
    }
  }
});
child.stderr.on('data', (d) => { const s = d.toString('utf8').trim(); if (s) log('child-stderr: ' + s.slice(0, 200)); });
child.on('exit', (code) => log('child exit ' + code));

const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + what)), ms))]);
const lastText = () => { for (let i = state.turns.length - 1; i >= 0; i--) { const t = state.turns[i]; if (t.kind === 'chunk' && t.text.trim()) return t.text.trim(); } return ''; };
const looksLikeQuestion = (s) => /[?？]\s*$/.test(s) || /^(请|需要你|你希望|要我先)/.test(s.slice(0, 12));

async function main() {
  const t0 = Date.now();
  await withTimeout(rpc('initialize', { protocolVersion: 1, clientCapabilities: {} }), 60000, 'initialize');
  log('initialized');
  const sn = await withTimeout(rpc('session/new', { cwd: path.resolve(workspace), mcpServers: [] }), 120000, 'session/new');
  const sessionId = sn.sessionId || (sn.session && sn.session.sessionId);
  log('session: ' + sessionId);
  state.sessionId = sessionId; save();
  // v2:路由选择——默认 deepseek-official 无 key;枚举 providers/configOptions,切到可用路由
  try {
    const pl = await withTimeout(rpc('providers/list', {}), 30000, 'providers/list');
    state.providers = (pl.providers || []).map((p) => p.providerId + ':' + JSON.stringify(p.currentRoute || p.routing || {}).slice(0, 80));
    log('providers: ' + state.providers.join(' | '));
  } catch (e) { log('providers/list failed: ' + e.message.slice(0, 100)); }
  const opts = sn.configOptions || sn.config_options || [];
  state.configOptions = opts.map((o) => ({ id: o.id, name: o.name, type: o.type, current: o.currentValue, choices: (o.options || []).map((c) => c.value + '(' + c.name + ')') }));
  log('configOptions: ' + JSON.stringify(state.configOptions).slice(0, 700));
  const mo = opts.find((o) => o.id === 'model' && o.type === 'select');
  if (mo && !/litellm|funplus|glm|sense|agnes/i.test(String(mo.currentValue))) {
    const routeValue = JSON.stringify(['litellm-funplus', 'glm-5.3-flash']);
    try {
      await withTimeout(rpc('session/set_config_option', { sessionId, configId: 'model', value: routeValue }), 30000, 'set_config_option');
      state.routeSet = routeValue;
      log('route set -> ' + routeValue);
    } catch (e) { log('set_config_option failed: ' + e.message.slice(0, 120)); }
  }
  save();
  let text = taskText;
  for (let round = 0; round < BUDGET; round++) {
    if (Date.now() - t0 > TOTAL_BUDGET_MS) { state.stop = 'total-timeout'; break; }
    state.prompts = round + 1;
    log('prompt #' + (round + 1) + ': ' + text.slice(0, 80));
    save();
    let res;
    try {
      res = await withTimeout(rpc('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }), PROMPT_TIMEOUT_MS, 'prompt#' + (round + 1));
    } catch (e) { state.stop = 'prompt-error: ' + e.message.slice(0, 120); break; }
    const stopReason = res && res.stopReason;
    state.turns.push({ t: Date.now(), kind: 'settle', stopReason });
    log('settled: ' + stopReason);
    const tail = lastText();
    if (stopReason === 'end_turn' && round + 1 < BUDGET) {
      if (looksLikeQuestion(tail)) { state.stop = 'agent-asked-question'; break; }
      log('idle ' + IDLE_MS + 'ms then continue');
      await new Promise((r) => setTimeout(r, IDLE_MS));
      text = '继续';
    } else { state.stop = stopReason || 'no-stop-reason'; break; }
  }
  state.finished = new Date().toISOString(); save();
  log('done: ' + state.stop + ' prompts=' + state.prompts + ' state=' + stateFile);
  try { child.kill(); } catch {}
  process.exit(0);
}
main().catch((e) => { log('fatal: ' + (e && e.message)); state.stop = 'fatal: ' + String(e && e.message).slice(0, 160); save(); try { child.kill(); } catch {} ; process.exit(1); });
