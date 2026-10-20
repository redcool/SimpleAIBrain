import fs from 'node:fs/promises';
const mod = await import('../dist/index.js');
const art = 'D:/Users/Admin/.dsh/sessions/--H-Works-SoundGenPrj--/session-bbd769dc-ae59-4899-846d-4bc4482b9794/session.v3.jsonl.zstd';
const raw = await fs.readFile(art);
const text = await mod.decodeDshArtifact(raw);
const lines = String(text || '').split('\n').filter((l) => l.trim());
console.log('frames: ' + lines.length);
const ty = {}; let hook = 0; let mem = 0; let firstUser = ''; let cwd = '';
for (const l of lines) {
  let o; try { o = JSON.parse(l); } catch { continue; }
  ty[o.type] = (ty[o.type] || 0) + 1;
  if (/hook/i.test(l)) hook++;
  if (/memory-hook|memory\.context/.test(l)) mem++;
  if (o.type === 'session' && o.cwd) cwd = o.cwd;
  if (!firstUser && o.type === 'user/message') { const c = o.data && o.data.message && o.data.message.content; firstUser = (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && x.text) || '').join(' ') : '').slice(0, 80); }
}
console.log('types: ' + JSON.stringify(ty));
console.log('hook mentions: ' + hook + ' | memory mentions: ' + mem);
console.log('cwd: ' + cwd);
console.log('first user: ' + firstUser);