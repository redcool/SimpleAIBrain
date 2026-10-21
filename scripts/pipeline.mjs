#!/usr/bin/env node
// M11-P2b pipeline orchestrator: goal -> plan(LLM) -> staged ACP sessions with judge + file gates -> resume-able state.
// 用法: node scripts/pipeline.mjs <workspaceDir> <goal> [maxStages=4] [perStageBudget=3]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [,, workspace, goal, maxStagesArg, budgetArg] = process.argv;
if (!workspace || !goal) { console.error('usage: pipeline <workspaceDir> <goal> [maxStages=4] [perStageBudget=3]'); process.exit(2); }
const MAX_STAGES = Math.max(1, Number(maxStagesArg) || 4);
const STAGE_BUDGET = Math.max(1, Number(budgetArg) || 3);
const PROMPT_TIMEOUT_MS = 25 * 60 * 1000;
const IDLE_MS = 8000;
const DSH_BIN = 'H:/AI/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js';
const WORK_ROUTE = JSON.stringify(['litellm-funplus', 'glm-5.3-flash']);
const ws = path.resolve(workspace);
const pipeDir = path.join(ws, '_pipeline');
fs.mkdirSync(pipeDir, { recursive: true });
const stateFile = path.join(pipeDir, 'state.json');
const log = (m) => console.error('[pipeline] ' + m);
const localDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString();
const nowHM = () => localDate().slice(11, 19);
const today = () => localDate().slice(0, 10);

// ── ACP 连接 ──
function connect(role) {
  const child = spawn(process.execPath, [DSH_BIN, '--profile', 'acp'], { cwd: ws, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; let nextId = 1;
  const pending = new Map();
  const chunks = [];
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line || line.startsWith('Content-Length')) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.code + ': ' + msg.error.message)) : p.resolve(msg.result); }
      } else if (msg.method === 'session/update') {
        const u = (msg.params || {}).update || {};
        if (u.sessionUpdate === 'agent_message_chunk' && u.content && u.content.text) chunks.push(u.content.text);
      }
    }
  });
  child.stderr.on('data', (d) => { const t = d.toString('utf8').trim(); if (t) log(role + '-stderr: ' + t.slice(0, 120)); });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const timo = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + what)), ms))]);
  return {
    role, child, chunks,
    rpc, timo,
    async start() {
      await timo(rpc('initialize', { protocolVersion: 1, clientCapabilities: {} }), 60000, role + ':init');
      const sn = await timo(rpc('session/new', { cwd: ws, mcpServers: [] }), 120000, role + ':new');
      this.sessionId = sn.sessionId || (sn.session && sn.session.sessionId);
      for (const o of sn.configOptions || []) {
        if (o.id === 'model' && !/litellm|funplus|glm|sense|agnes/i.test(String(o.currentValue))) {
          await timo(rpc('session/set_config_option', { sessionId: this.sessionId, configId: 'model', value: WORK_ROUTE }), 30000, role + ':route');
          break;
        }
      }
      log(role + ' ready');
      return this;
    },
    async prompt(text) {
      chunks.length = 0;
      const res = await timo(this.rpc('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text }] }), PROMPT_TIMEOUT_MS, role + ':prompt');
      return { stopReason: res && res.stopReason, text: chunks.join('').trim() };
    },
    kill() { try { child.kill(); } catch {} },
  };
}

// ── 判官留痕 ──
function judgeLog(entry) {
  const f = path.join(ws, '判官_' + today() + '.md');
  if (!fs.existsSync(f)) fs.writeFileSync(f, '# 判官决策记录 ' + today() + '\n\n> 自动生成:每轮审核的问题与决策,供用户查阅。\n');
  fs.appendFileSync(f, entry + '\n');
}

// ── 文件硬检查 ──
const fileGate = (outFile) => {
  if (!outFile) return { ok: true };
  const p = path.join(ws, outFile);
  if (!fs.existsSync(p)) return { ok: false, why: '输出文件不存在: ' + outFile };
  const sz = fs.statSync(p).size;
  if (sz < 20) return { ok: false, why: '输出文件过小(' + sz + 'B): ' + outFile };
  return { ok: true };
};

async function main() {
  // 断点续跑:已有 state 就接着走
  let state;
  if (fs.existsSync(stateFile)) {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    log('resume: ' + state.stages.filter(s => s.status === 'done').length + '/' + state.stages.length + ' done');
  } else {
    state = { goal, started: localDate(), stages: [], stop: null };
    // ── 阶段 0:计划分解 ──
    const planner = await connect('planner').start();
    const planPrompt = '你是任务编排器。把用户目标分解为 ' + MAX_STAGES + ' 个以内、可串行执行的阶段。每阶段是独立子会话(互相不共享对话记忆,只通过文件交接)。\n【用户目标】' + goal + '\n【要求】1)每阶段 prompt 必须自包含:写明输入文件(相对路径)、要做什么、输出文件(相对路径)、质量要求;2)outputFile 是该阶段必须产出的文件相对路径;3)acceptance 一句话可检验的验收标准;4)第一阶段的输入可以来自工具(如搜索/记忆检索),不依赖不存在的前置文件。\n只输出 JSON,不要其他文字:{"stages":[{"name":"阶段1-xxx","prompt":"...","outputFile":"xxx.md","acceptance":"..."}]}';
    let plan;
    try {
      const pr = await planner.prompt(planPrompt);
      const m = pr.text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('no json in plan: ' + pr.text.slice(0, 100));
      plan = JSON.parse(m[0]);
      if (!Array.isArray(plan.stages) || plan.stages.length === 0) throw new Error('empty stages');
      plan.stages = plan.stages.slice(0, MAX_STAGES);
    } catch (e) {
      log('plan failed: ' + e.message.slice(0, 120));
      fs.writeFileSync(stateFile, JSON.stringify({ ...state, stop: 'plan-failed: ' + e.message.slice(0, 120) }, null, 2));
      planner.kill(); process.exit(1);
    }
    planner.kill();
    state.stages = plan.stages.map((s, i) => ({ idx: i + 1, name: s.name, prompt: s.prompt, outputFile: s.outputFile || null, acceptance: s.acceptance || '', status: 'pending', rounds: 0, verdict: null }));
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    fs.writeFileSync(path.join(pipeDir, 'plan.md'), '# 流水线计划\n\n**目标**: ' + goal + '\n\n' + state.stages.map(s => (s.idx) + '. **' + s.name + '** → ' + s.outputFile + '\n   - 验收: ' + s.acceptance).join('\n'));
    log('plan: ' + state.stages.length + ' stages');
  }
  // ── 逐阶段执行 ──
  let stop = null;
  for (const st of state.stages) {
    if (st.status === 'done') continue;
    log('== ' + st.name + ' ==');
    st.status = 'running'; fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    let worker = await connect('worker' + st.idx).start();
    const judge = await connect('judge' + st.idx).start();
    let stagePrompt = st.prompt + '\n\n【执行纪律】检索/阅读只保留要点(每条≤100字)并立即落盘到输出文件,避免长上下文;输出文件名必须严格使用: ' + (st.outputFile || '阶段要求中的文件名') + '。完成后回复:已完成。';
    let lastNudge = '';
    let done = false;
    for (let round = 1; round <= STAGE_BUDGET; round++) {
      st.rounds = round;
      let res;
      try {
        res = await worker.prompt(stagePrompt);
      } catch (e) {
        const isTimeout = /timeout/.test(String(e && e.message));
        const gate0 = fileGate(st.outputFile);
        if (isTimeout && gate0.ok) {
          log('worker timeout but file gate ok -> judge by files');
          worker.kill();
          res = { stopReason: 'end_turn', text: '(执行者超时,请仅依据工作区文件核验验收标准)' };
        } else if (isTimeout) {
          log('worker timeout, gate not ok -> respawn and continue');
          worker.kill();
          st.rounds = round; fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
          stagePrompt = '上次执行超时。请检查工作区现有文件状态,继续完成本阶段工作,确保输出文件: ' + (st.outputFile || '(见阶段要求)') + '。完成后回复:已完成。';
          worker = await connect('worker' + st.idx + 'r' + round).start();
          continue;
        } else if (/context overflow|overflow/i.test(String(e && e.message))) {
          log('worker context overflow -> respawn with frugality rider');
          worker.kill();
          st.rounds = round; fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
          stagePrompt = '上次执行因上下文过长失败。请节俭工作:检索只保留要点(每条≤100字),要点立即写入输出文件,不要长篇引用。确保输出文件: ' + (st.outputFile || '(见阶段要求)') + '。完成后回复:已完成。';
          worker = await connect('worker' + st.idx + 'f' + round).start();
          continue;
        } else { st.verdict = 'prompt-error: ' + e.message.slice(0, 100); break; }
      }
      if (res.stopReason !== 'end_turn') { st.verdict = 'stopReason:' + res.stopReason; break; }
      // 判官(语义审,会自己读文件核验)
      const jp = '你是审核判官。审核执行者的一轮工作。\n【阶段目标】' + st.prompt + '\n【验收标准】' + (st.acceptance || '输出文件 ' + st.outputFile + ' 存在且内容达标') + '\n【执行者本轮输出】' + (res.text.slice(0, 1200) || '(无)') + '\n【规则】达成→pass;未达成但可自动纠正→fix(给定向提示);需用户决策→escalate。只输出一行 JSON:{"verdict":"pass|fix|escalate","reason":"一句话","nudge":"fix 时的一句话定向提示"}';
      let jd;
      try {
        const jr = await judge.prompt(jp);
        const m = jr.text.match(/\{[\s\S]*\}/);
        jd = m ? JSON.parse(m[0]) : { verdict: 'escalate', reason: 'judge-unparseable', nudge: '' };
        if (!['pass', 'fix', 'escalate'].includes(jd.verdict)) throw new Error('bad verdict');
      } catch (e) { jd = { verdict: 'escalate', reason: 'judge-failed: ' + e.message.slice(0, 60), nudge: '' }; }
      // 文件硬检查(判官 pass 之后仍要过闸)
      const gate = fileGate(st.outputFile);
      const finalOk = jd.verdict === 'pass' && gate.ok;
      judgeLog('## ' + nowHM() + ' [' + st.name + '] 第' + round + '轮\n- **阶段目标**: ' + st.prompt.slice(0, 120) + '\n- **执行者输出摘要**: ' + (res.text.slice(0, 150) || '(无)') + '\n- **判官决策**: ' + jd.verdict + ' | **文件闸**: ' + (gate.ok ? '通过' : gate.why) + '\n- **理由**: ' + String(jd.reason || '').slice(0, 180) + (jd.nudge ? '\n- **纠正提示**: ' + jd.nudge : ''));
      st.verdict = jd.verdict + (gate.ok ? '' : ' | ' + gate.why);
      log(st.name + ' r' + round + ': judge=' + jd.verdict + ' gate=' + (gate.ok ? 'ok' : gate.why));
      if (finalOk) { done = true; break; }
      if (jd.verdict === 'escalate') break;
      let nudge = gate.ok ? jd.nudge : ('输出文件未达标(' + gate.why + '),请完成并正确写入: ' + st.outputFile);
      if (nudge === lastNudge) { st.verdict = 'loop-guard: same nudge twice'; break; }
      lastNudge = nudge;
      stagePrompt = nudge;
      await new Promise((r) => setTimeout(r, IDLE_MS));
    }
    worker.kill(); judge.kill();
    st.status = done ? 'done' : 'failed';
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    if (!done) { stop = 'stage-failed: ' + st.name; break; }
  }
  // ── 汇总 ──
  if (!stop) stop = 'all-done';
  state.stop = stop; state.finished = localDate();
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  const doneN = state.stages.filter(s => s.status === 'done').length;
  judgeLog('## 结论\n- **终态**: ' + stop + ' (' + doneN + '/' + state.stages.length + ' 阶段完成);**目标**: ' + goal.slice(0, 100));
  fs.writeFileSync(path.join(pipeDir, 'report.md'), '# 流水线报告\n\n**目标**: ' + goal + '\n**终态**: ' + stop + ' (' + doneN + '/' + state.stages.length + ')\n\n' + state.stages.map(s => (s.idx) + '. ' + s.name + ' — ' + s.status + (s.outputFile ? '(→ ' + s.outputFile + ')' : '') + (s.verdict ? ' | ' + s.verdict : '')).join('\n'));
  log('done: ' + stop + ' (' + doneN + '/' + state.stages.length + ')');
  process.exit(0);
}
main().catch((e) => { log('fatal: ' + (e && e.message)); process.exit(1); });
