import fs from 'node:fs/promises';
const bj = JSON.parse(await fs.readFile('H:/ai_works/SimpleAIBrain/.brain.json', 'utf8'));
const call = (name, args) => fetch('http://127.0.0.1:45678/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: Object.assign({}, args, { _brainToken: bj.token }) } }) }).then((r) => r.json());
// 1) 正确路径:token 作为工具参数
const ctx = await call('memory.context', { query: 'DSH 撤回 巩固 身份' });
const t = String(ctx.result?.content?.[0]?.text ?? JSON.stringify(ctx.error ?? ctx));
console.log('context(with token arg) ->', t.slice(0, 260).replace(/\n/g, ' | '));
// 2) 身份自检
const who = await call('memory.whoami', {});
console.log('whoami ->', String(who.result?.content?.[0]?.text ?? JSON.stringify(who.error ?? who)).slice(0, 200));
// 3) 对照:无 token(访客)
const g = await fetch('http://127.0.0.1:45678/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory.context', arguments: { query: 'DSH 撤回 巩固 身份' } } }) }).then((r) => r.json());
console.log('context(guest) ->', String(g.result?.content?.[0]?.text ?? JSON.stringify(g.error ?? g)).slice(0, 200).replace(/\n/g, ' | '));
