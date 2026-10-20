import fs from 'node:fs/promises';
// SoundGenPrj 身份验证(不打印 token)
const bj = JSON.parse(await fs.readFile('H:/Works/SoundGenPrj/.brain.json', 'utf8'));
const call = (name, args) => fetch('http://127.0.0.1:45678/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: Object.assign({}, args, { _brainToken: bj.token }) } }) }).then((r) => r.json());
const who = await call('memory.whoami', {});
console.log('soundgenprj whoami ->', String(who.result?.content?.[0]?.text ?? JSON.stringify(who.error)).slice(0, 160));
const st = await call('memory.stats', {});
console.log('soundgenprj stats ->', String(st.result?.content?.[0]?.text ?? JSON.stringify(st.error)).slice(0, 220).replace(/\n/g, ' '));
