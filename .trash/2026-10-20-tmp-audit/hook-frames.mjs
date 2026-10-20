import fs from 'node:fs/promises';
const mod = await import('../dist/index.js');
const raw = await fs.readFile('D:/Users/Admin/.dsh/sessions/--H-Works-SoundGenPrj--/session-bbd769dc-ae59-4899-846d-4bc4482b9794/session.v3.jsonl.zstd');
const text = await mod.decodeDshArtifact(raw);
for (const l of String(text || '').split('\n')) {
  if (!/hook\//.test(l)) continue;
  let o; try { o = JSON.parse(l); } catch { continue; }
  if (o.type !== 'hook/invoked' && o.type !== 'hook/result') continue;
  console.log('=== ' + o.type + ' ===');
  console.log(JSON.stringify(o.data).slice(0, 600));
}