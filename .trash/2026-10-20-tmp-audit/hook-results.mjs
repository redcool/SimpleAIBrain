import fs from 'node:fs/promises';
const mod = await import('../dist/index.js');
const raw = await fs.readFile('D:/Users/Admin/.dsh/sessions/--H-Works-SoundGenPrj--/session-bbd769dc-ae59-4899-846d-4bc4482b9794/session.v3.jsonl.zstd');
const text = await mod.decodeDshArtifact(raw);
const lines = String(text || '').split('\n').filter((l) => l.trim());
for (const l of lines) {
  let o; try { o = JSON.parse(l); } catch { continue; }
  if (o.type === 'hook/result') console.log('result turn=' + o.data.turn + ' exit=' + o.data.exitCode + ' ms=' + Math.round(o.data.durationMs) + ' stderr=' + JSON.stringify(o.data.stderrSummary || o.data.stderr || '(none)').slice(0, 400));
  if (o.type === 'hook/invoked') console.log('invoked turn=' + o.data.turn + ' t=' + o.time);
}