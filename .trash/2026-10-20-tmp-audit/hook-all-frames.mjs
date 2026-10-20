import fs from 'node:fs/promises';
const mod = await import('../dist/index.js');
const raw = await fs.readFile('D:/Users/Admin/.dsh/sessions/--H-Works-SoundGenPrj--/session-bbd769dc-ae59-4899-846d-4bc4482b9794/session.v3.jsonl.zstd');
const text = await mod.decodeDshArtifact(raw);
const lines = String(text || '').split('\n').filter((l) => l.trim());
console.log('frames: ' + lines.length);
for (const l of lines) {
  let o; try { o = JSON.parse(l); } catch { continue; }
  if (o.type === 'hook/invoked' || o.type === 'hook/result') console.log(o.type + ' t=' + o.time + ' ' + JSON.stringify(o.data).slice(0, 220));
  if (o.type === 'turn/start') console.log('turn/start t=' + o.time);
  if (o.type === 'user/message') { const c = o.data && o.data.message && o.data.message.content; const t = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && x.text) || '').join(' ') : ''; console.log('user t=' + o.time + ': ' + t.slice(0, 40)); }
}