import fs from 'node:fs/promises';
import path from 'node:path';
const root = 'H:/ai_works/SimpleAIBrain/data/memory';
let files = [];
const walk = async (d) => { for (const e of await fs.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else if (e.name.endsWith('.md') || e.name.endsWith('.json')) files.push(p); } };
await walk(root);
const bad = [];
for (const f of files) {
  const t = await fs.readFile(f, 'utf8');
  const lines = t.split('\n');
  lines.forEach((ln, i) => {
    if (/[\uFFFD]/.test(ln) || /\u9526\u65A4|\u9524\u5934/.test(ln) || /[\u00C0-\u00FF]{3,}/.test(ln) || /\\u[0-9a-fA-F]{4}/.test(ln)) {
      bad.push(path.relative(root, f) + ':' + (i + 1) + ' ' + ln.trim().slice(0, 90));
    }
  });
}
console.log('scanned files:', files.length, 'suspect lines:', bad.length);
for (const b of bad.slice(0, 12)) console.log(b);
