import fs from 'node:fs/promises';
const mod = await import('../dist/index.js');
const raw = await fs.readFile('D:/Users/Admin/.dsh/sessions/--H-ai_works-SimpleAIBrain--/session-b2fe0496-b231-4996-90b2-e7d45fa674cd/session.v3.jsonl.zstd');
const text = await mod.decodeDshArtifact(raw);
const lines = String(text || '').split('\n').filter((l) => l.trim());
for (const l of lines) {
  let o; try { o = JSON.parse(l); } catch { continue; }
  if (o.type === 'hook/result') console.log('result turn=' + o.data.turn + ' t=' + o.time + ' exit=' + o.data.exitCode + ' ms=' + Math.round(o.data.durationMs) + ' stderr=' + JSON.stringify(o.data.stderrSummary || o.data.stderr || '(none)').slice(0, 420));
  if (o.type === 'hook/invoked') console.log('invoked turn=' + o.data.turn + ' t=' + o.time);
}