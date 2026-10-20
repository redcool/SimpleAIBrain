import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
const DATA = 'H:/ai_works/SimpleAIBrain/data';
const out = [];
const mod = await import('../dist/index.js');
// 1) L1 created_at 时序(agent=soundgenprj)
const store = new mod.FileStore(DATA + '/memory');
await store.init();
const mine = [];
for await (const e of store.iterateByScope({ includeArchived: true })) if (e.owner && e.owner.agent === 'soundgenprj') mine.push(e);
mine.sort((a, b) => a.created_at.localeCompare(b.created_at));
out.push('== L1 created_at 时序(' + mine.length + ' 条)');
for (const e of mine) out.push('  ' + e.created_at.slice(5, 19) + ' | by ' + e.created_by.padEnd(14) + ' | imp ' + e.importance.toFixed(2) + ' | ' + e.title.slice(0, 30));
// 2) spool / 巩固 run 时刻
const spoolDir = path.join(DATA, 'memory', '_spool');
const sp = [];
for (const f of (await fs.readdir(spoolDir)).filter((f) => f.endsWith('.json'))) { try { const r = JSON.parse(await fs.readFile(path.join(spoolDir, f), 'utf8')); if ((r.identity || '').includes('soundgenprj')) sp.push(r.ts.slice(5, 19) + ' auto=' + !!r.auto + ' sid=' + String(r.session_id).slice(0, 22)); } catch {} }
sp.sort();
out.push('== spool 提交时刻(' + sp.length + ')');
for (const x of sp) out.push('  ' + x);
// 3) 巩固 runs
for (const f of (await fs.readdir(DATA + '/_logs')).sort()) {
  const lines = (await fs.readFile(path.join(DATA, '_logs', f), 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const r of lines) out.push('== run ' + r.ts.slice(5, 19) + ' ' + r.trigger + ' summarized=' + r.summarized + ' merged=' + r.merged + ' ' + r.duration_ms + 'ms');
}
// 4) 真实行为:各会话帧里的 memory.* 工具调用与口令
const mf = JSON.parse(await fs.readFile(path.join(DATA, 'ingest-manifest.json'), 'utf8'));
const sids = Object.keys(mf.sessions).filter((k) => (mf.sessions[k].identity || '').includes('soundgenprj'));
let dshRoot = 'D:/Users/Admin/.dsh/sessions';
try { const cfg = JSON.parse(await fs.readFile('H:/ai_works/SimpleMcpServer/config.json', 'utf8')); const w = cfg.aiBrain && cfg.aiBrain.ingest && cfg.aiBrain.ingest.watch; if (w && w.dsh) dshRoot = w.dsh; } catch {}
out.push('== DSH 根: ' + dshRoot);
async function findArt(sid) {
  const cand = path.join(dshRoot, sid, 'session.v3.jsonl.zstd');
  try { await fs.access(cand); return cand; } catch {}
  let dirs = [];
  try { dirs = await fs.readdir(dshRoot, { withFileTypes: true }); } catch { return null; }
  for (const d of dirs) { if (!d.isDirectory()) continue; const p = path.join(dshRoot, d.name, sid, 'session.v3.jsonl.zstd'); try { await fs.access(p); return p; } catch {} }
  return null;
}
for (const sid of sids) {
  const art = await findArt(sid);
  if (!art) { out.push('  ' + sid.slice(0, 24) + ': artifact 未找到'); continue; }
  const raw = await fs.readFile(art);
  const text = mod.decodeDshArtifact ? mod.decodeDshArtifact(raw) : null;
  let memCalls = 0; let callNames = {}; let sayKouling = 0; let frames = 0;
  if (text !== null) {
    for (const line of text.split('\n')) {
      if (!line.trim()) continue; frames++;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'tool/call' && o.data && o.data.name) { const n = String(o.data.name); if (n.startsWith('memory')) { memCalls++; callNames[n] = (callNames[n] || 0) + 1; } }
      if (o.type === 'user/message' && o.data && o.data.message) {
        const c = o.data.message.content;
        const t = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && x.text) || '').join(' ') : '';
        if (/获取记忆|存储记忆|查找记忆|记忆体检/.test(t)) sayKouling++;
      }
    }
  }
  out.push('== ' + sid.slice(0, 28) + ' | frames=' + frames + ' | memory.* 调用=' + memCalls + (Object.keys(callNames).length ? ' (' + JSON.stringify(callNames) + ')' : '') + ' | 口令=' + sayKouling);
}
console.log(out.join('\n'));