import fs from 'node:fs/promises';
const mod = await import('../dist/index.js');
const raw = await fs.readFile('D:/Users/Admin/.dsh/sessions/--H-Works-SoundGenPrj--/session-bbd769dc-ae59-4899-846d-4bc4482b9794/session.v3.jsonl.zstd');
const text = await mod.decodeDshArtifact(raw);
for (const l of String(text || '').split('\n')) {
  let o; try { o = JSON.parse(l); } catch { continue; }
  if (o.type === 'system/message') console.log('=== system/message ===\n' + JSON.stringify(o.data).slice(0, 500));
  if (o.type === 'request/context') { const s = JSON.stringify(o.data); console.log('=== request/context (len ' + s.length + ') ==='); const i = s.indexOf('记忆上下文'); console.log(i >= 0 ? 'CONTAINS 记忆上下文 @' + i + ': ' + s.slice(Math.max(0, i - 60), i + 200) : 'no memory banner; head: ' + s.slice(0, 300)); }
  if (o.type === 'hook/invoked') console.log('=== invoked full ===\n' + JSON.stringify(o).slice(0, 700));
}