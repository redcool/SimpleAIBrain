import fs from 'node:fs/promises';
import path from 'node:path';
const mem = 'H:/ai_works/SimpleAIBrain/data/memory';
// 1) 找 L1 文件
let files = [];
const walk = async (d) => { for (const e of await fs.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else if (e.name.endsWith('.md')) files.push(p); } };
await walk(mem);
console.log('md files: ' + files.map((f) => path.relative(mem, f)).join(', '));
for (const f of files) console.log('--- ' + path.relative(mem, f) + ' ---\n' + (await fs.readFile(f, 'utf8')).slice(0, 900));
// 2) 游标
try { console.log('\n--- state:\n' + await fs.readFile(path.join(mem, '_consolidation-state.json'), 'utf8')); } catch (e) { console.log('no state file: ' + e.message); }
// 3) 检索:memory.context
const bj = JSON.parse(await fs.readFile('H:/ai_works/SimpleAIBrain/.brain.json', 'utf8'));
const call = (name, args) => fetch('http://127.0.0.1:45678/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: Object.assign({ _brainToken: bj.token }, args) } }) }).then((r) => r.json());
const ctx = await call('memory.context', { query: 'DSH 接入 撤回 opt-in token' });
console.log('\n--- memory.context:\n' + JSON.stringify(ctx.result?.content?.[0] ?? ctx.error ?? ctx).slice(0, 700));
const stats = await call('memory.stats', {});
console.log('\n--- memory.stats:\n' + JSON.stringify(stats.result?.content?.[0] ?? stats.error ?? stats).slice(0, 400));
