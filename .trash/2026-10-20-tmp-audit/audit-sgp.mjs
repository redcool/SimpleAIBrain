import fs from 'node:fs/promises';
import path from 'node:path';
const DATA = 'H:/ai_works/SimpleAIBrain/data';
const out = [];
try {
  const mf = JSON.parse(await fs.readFile(path.join(DATA, 'ingest-manifest.json'), 'utf8'));
  const rows = Object.entries(mf.sessions).filter(([k, v]) => (v.identity || '').includes('soundgenprj'));
  out.push('== manifest(soundgenprj): ' + rows.length + ' sessions');
  for (const [sid, v] of rows) out.push('  ' + sid.slice(0, 28) + ' | ts=' + (v.ts || '').slice(0, 16) + ' | autoDigested=' + !!v.autoDigested + ' | src=' + (v.src || '-'));
  out.push('  (其他身份会话 ' + (Object.keys(mf.sessions).length - rows.length) + ' 条)');
} catch (e) { out.push('manifest fail: ' + e.message.slice(0, 80)); }
try {
  const spoolDir = path.join(DATA, 'memory', '_spool');
  const files = (await fs.readdir(spoolDir)).filter((f) => f.endsWith('.json'));
  const sgp = [];
  for (const f of files) { try { const rec = JSON.parse(await fs.readFile(path.join(spoolDir, f), 'utf8')); if ((rec.identity || '').includes('soundgenprj')) sgp.push({ f, rec }); } catch {} }
  out.push('== spool(soundgenprj): ' + sgp.length + ' / 全库 ' + files.length);
  for (const { f, rec } of sgp.slice(0, 12)) out.push('  ' + f.slice(0, 18) + ' | sid=' + String(rec.session_id).slice(0, 24) + ' | auto=' + !!rec.auto + ' | ts=' + String(rec.ts).slice(0, 16) + ' | ' + String(rec.content).replace(/\n/g, ' ').slice(0, 60));
} catch (e) { out.push('spool fail: ' + e.message.slice(0, 80)); }
try {
  const l0 = await fs.readFile(path.join(DATA, 'memory', 'L0-log', '2026-10', 'soundgenprj.jsonl'), 'utf8');
  const lines = l0.trim().split('\n').filter(Boolean);
  out.push('== L0-log(soundgenprj): ' + lines.length + ' rows');
  for (const ln of lines.slice(-3)) { const r = JSON.parse(ln); out.push('  ' + r.ts.slice(0, 16) + ' | ' + r.session_id.slice(0, 24) + ' | digest ' + String(r.digest).length + ' chars'); }
} catch (e) { out.push('== L0-log(soundgenprj): 0 rows'); }
const mod = await import('../dist/index.js');
const store = new mod.FileStore(DATA + '/memory');
await store.init();
const mine = []; const autoL1 = [];
for await (const e of store.iterateByScope({ includeArchived: true })) {
  if (e.owner && e.owner.agent === 'soundgenprj') mine.push(e);
  if (e.created_by === 'watcher:auto') autoL1.push(e);
}
out.push('== 库内 soundgenprj 条目: ' + mine.length);
for (const e of mine.slice(0, 12)) out.push('  [' + e.layer + '|' + e.status + '|imp ' + e.importance.toFixed(2) + '|by ' + e.created_by.slice(0, 24) + '] ' + e.title.slice(0, 40) + ' :: ' + e.body.replace(/\n/g, ' ').slice(0, 44));
out.push('== 全库 watcher:auto 条目: ' + autoL1.length);
for (const e of autoL1.slice(0, 8)) out.push('  [' + e.status + '|imp ' + e.importance.toFixed(2) + '|owner ' + (e.owner ? e.owner.member + '/' + e.owner.agent : '?') + '] ' + e.title.slice(0, 44));
try {
  const logsDir = DATA + '/_logs';
  const lf = (await fs.readdir(logsDir)).sort();
  for (const f of lf) {
    const text = await fs.readFile(path.join(logsDir, f), 'utf8');
    const lines = text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const last = lines[lines.length - 1];
    out.push('== ' + f + ': ' + lines.length + ' runs; last: ' + last.trigger + ' summarized=' + last.summarized + ' merged=' + last.merged + ' distilled=' + last.distilled + ' archived=' + last.archived + ' skipped=' + (last.skipped || 0) + ' @ ' + String(last.ts).slice(5, 16));
  }
} catch (e) { out.push('logs fail: ' + e.message.slice(0, 80)); }
console.log(out.join('\n'));