#!/usr/bin/env node
// 0.0.16.21: 自主任务口令启动器。解析目标 → 以分离进程跑 pipeline.mjs(随会话结束继续跑)→ 落 PID/日志 → 立即返回。
// 用法: node pipeline-start.mjs "<目标>" [maxStages=4] [perStageBudget=3] [--dry]
// 口令纪律:目标必须带引号(防讨论误触);agent 启动后立即汇报并退出,禁止等待/轮询——完成有弹窗,进度走「自主任务状态」。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const args = argv.filter((a) => a !== '--dry');
const goal = args[0];
if (!goal || !goal.trim()) { console.error('usage: pipeline-start "<目标>" [maxStages=4] [perStageBudget=3] [--dry]'); process.exit(2); }
const ws = process.cwd();
const pipeDir = path.join(ws, '_pipeline');
fs.mkdirSync(pipeDir, { recursive: true });
const pidFile = path.join(pipeDir, 'run.pid');
// 单实例守卫:已有活实例则拒绝(用「停自主任务」结束或「自主任务状态」查看)
if (fs.existsSync(pidFile)) {
  try {
    const old = Number(fs.readFileSync(pidFile, 'utf8').trim());
    process.kill(old, 0);
    console.log('[pipeline-start] 已有实例运行中 (pid=' + old + ')。查进度:「自主任务状态」;结束:「停自主任务」。');
    process.exit(3);
  } catch { /* 死 PID,清掉继续 */ try { fs.unlinkSync(pidFile); } catch {} }
}
const stages = Math.max(1, Number(args[1]) || 4);
const budget = Math.max(1, Number(args[2]) || 3);
const pipelineJs = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pipeline.mjs');
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const logPath = path.join(pipeDir, 'run-' + stamp + '.log');
if (dry) {
  console.log('[pipeline-start] dry-run: 将执行 node ' + pipelineJs + ' "' + ws + '" "' + goal + '" ' + stages + ' ' + budget);
  console.log('[pipeline-start] 日志将写 ' + logPath + ';PID 将写 ' + pidFile);
  process.exit(0);
}
const out = fs.openSync(logPath, 'a');
fs.appendFileSync(logPath, '[pipeline-start] ' + new Date().toISOString() + ' goal=' + goal.slice(0, 120) + ' stages=' + stages + ' budget=' + budget + '\n');
const child = spawn(process.execPath, [pipelineJs, ws, goal, String(stages), String(budget)], { cwd: ws, detached: true, stdio: ['ignore', out, out] });
child.unref();
fs.writeFileSync(pidFile, String(child.pid) + '\n');
console.log('[pipeline-start] 已启动 pid=' + child.pid);
console.log('[pipeline-start] 工作区=' + ws);
console.log('[pipeline-start] 目标=' + goal);
console.log('[pipeline-start] 阶段上限=' + stages + ' 每阶段纠偏=' + budget);
console.log('[pipeline-start] 日志=' + logPath);
console.log('[pipeline-start] 进度查询=「自主任务状态」 结束=「停自主任务」;完成时会弹窗提醒。');