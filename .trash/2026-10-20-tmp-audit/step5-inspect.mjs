import fs from 'node:fs/promises';
import path from 'node:path';
const mem = 'H:/ai_works/SimpleAIBrain/data/memory';
let files = [];
const walk = async (d) => { for (const e of await fs.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else if (e.name.endsWith('.md')) files.push(p); } };
await walk(mem);
const byLayer = {};
for (const f of files) {
  const t = await fs.readFile(f, 'utf8');
  const layer = (t.match(/^layer: (\d)/m) || [])[1];
  const title = (t.match(/^title: (.*)$/m) || [])[1];
  const status = (t.match(/^status: (.*)$/m) || [])[1];
  const imp = (t.match(/^importance: (.*)$/m) || [])[1];
  const src = (t.match(/source_ids:\n((?:  - .+\n?)+)/m) || [''])[1].replace(/  - /g, '').trim().split('\n').join(',');
  (byLayer[layer] = byLayer[layer] || []).push({ title, status, imp, src, file: path.relative(mem, f) });
}
for (const k of Object.keys(byLayer).sort()) {
  console.log('L' + k + ' x' + byLayer[k].length);
  for (const e of byLayer[k]) console.log('  [' + e.status + ' imp=' + e.imp + '] ' + e.title + '  src=' + e.src);
}
