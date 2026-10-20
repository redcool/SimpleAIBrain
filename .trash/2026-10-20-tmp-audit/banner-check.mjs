import fs from 'node:fs/promises';
const mod = await import('../dist/index.js');
const raw = await fs.readFile('D:/Users/Admin/.dsh/sessions/--H-ai_works-SimpleAIBrain--/session-b2fe0496-b231-4996-90b2-e7d45fa674cd/session.v3.jsonl.zstd');
const text = await mod.decodeDshArtifact(raw);
const lines = String(text || '').split('\n').filter((l) => l.trim());
const banners = [];
let lastReqCtx = '';
for (const l of lines) {
  if (l.includes('记忆上下文')) banners.push(l.slice(0, 300));
  let o; try { o = JSON.parse(l); } catch { continue; }
  if (o.type === 'request/context') lastReqCtx = JSON.stringify(o.data).slice(0, 200);
}
console.log('frames with banner: ' + banners.length);
for (const b of banners.slice(-2)) console.log('  ' + b);
console.log('last request/context: ' + lastReqCtx);
console.log('total lines: ' + lines.length);