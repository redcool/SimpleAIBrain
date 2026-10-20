import fs from 'node:fs/promises';
import path from 'node:path';
const mod = await import('../dist/index.js');
const root = 'D:/Users/Admin/.dsh/sessions';
const dirs = [];
async function walk(d) { for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else if (e.name === 'session.v3.jsonl.zstd') dirs.push(p); } }
await walk(root);
for (const art of dirs) {
  try {
    const raw = await fs.readFile(art);
    const text = await mod.decodeDshArtifact(raw);
    const lines = String(text || '').split('\n').filter((l) => l.trim());
    let hooks = 0; let marker = false; let cwd = ''; let lastT = 0; let turns = 0;
    for (const l of lines) {
      if (/memory-hook|hook-state|0\.0\.15\.2/.test(l)) marker = true;
      let o; try { o = JSON.parse(l); } catch { continue; }
      if (o.type === 'hook/invoked') hooks++;
      if (o.type === 'turn/start') turns++;
      if (o.type === 'session' && o.cwd) cwd = o.cwd;
      if (o.time) lastT = Math.max(lastT, o.time);
    }
    console.log((marker ? '>>>' : '   ') + ' hooks=' + hooks + ' turns=' + turns + ' cwd=' + cwd.slice(0, 40) + ' last=' + new Date(lastT).toISOString().slice(5, 16) + ' | ' + art.slice(root.length + 1, root.length + 60));
  } catch (e) { console.log('ERR ' + art.slice(-50) + ' ' + e.message.slice(0, 50)); }
}