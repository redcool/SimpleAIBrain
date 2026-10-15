'use strict';
// M06 section 9 retraction: session deletion -> memories exit via citation chain
const { test } = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

async function mk(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'm13-'));
  const dataDir = path.join(root, 'data');
  const mod = await import('../dist/index.js');
  const store = new mod.FileStore(path.join(dataDir, 'memory'));
  await store.init();
  if (t && t.after) t.after(async () => { await fsp.rm(root, { recursive: true, force: true }); });
  return { mod, store, dataDir, root, memRoot: path.join(dataDir, 'memory') };
}
function entry(partial) {
  return Object.assign({
    id: '', layer: 1, scope: 'agent', owner: { member: 'local', agent: 'tester' },
    title: 't', kind: 'fact', body: 'b',
  }, partial || {});
}
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
async function mkSpool(memRoot, session, content) {
  const h = sha256(content);
  const spool = path.join(memRoot, '_spool');
  await fsp.mkdir(spool, { recursive: true });
  await fsp.writeFile(path.join(spool, h.slice(0, 16) + '.json'), JSON.stringify({ session_id: session, content }));
  return h.slice(0, 16);
}
async function readL0Lines(memRoot) {
  const out = [];
  const walk = async (d) => {
    let es = []; try { es = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.jsonl')) for (const l of (await fsp.readFile(p, 'utf8')).split('\n')) if (l.trim()) out.push(JSON.parse(l));
    }
  };
  await walk(path.join(memRoot, 'L0-log'));
  return out;
}

test('retractSession: L0 rows of deleted session physically removed, others kept, malformed preserved', async (t) => {
  const { mod, store, memRoot } = await mk(t);
  await store.appendLog({ ts: 't', harness: 'dsh-jsonl', agent_label: 'a', kind: 'session', session_id: 'sessX', digest: 'x1', hash: 'h1' });
  await store.appendLog({ ts: 't', harness: 'dsh-jsonl', agent_label: 'a', kind: 'session', session_id: 'sessX', digest: 'x2', hash: 'h2' });
  await store.appendLog({ ts: 't', harness: 'dsh-jsonl', agent_label: 'a', kind: 'session', session_id: 'sessY', digest: 'y1', hash: 'h3' });
  const rep = await mod.retractSession(memRoot, store, 'sessX');
  assert.strictEqual(rep.l0_removed, 2);
  const rows = await readL0Lines(memRoot);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].session_id, 'sessY');
});

test('retractSession: spool files of session removed, others kept', async (t) => {
  const { mod, store, memRoot } = await mk(t);
  const spool = path.join(memRoot, '_spool');
  await fsp.mkdir(spool, { recursive: true });
  const hA = sha256('dead digest');
  const hB = sha256('alive digest');
  await fsp.writeFile(path.join(spool, hA.slice(0, 16) + '.json'), JSON.stringify({ session_id: 'sessX', content: 'dead digest' }));
  await fsp.writeFile(path.join(spool, hB.slice(0, 16) + '.json'), JSON.stringify({ session_id: 'sessY', content: 'alive digest' }));
  const rep = await mod.retractSession(memRoot, store, 'sessX');
  assert.strictEqual(rep.spool_removed, 1);
  const left = (await fsp.readdir(spool)).filter((f) => f.endsWith('.json'));
  assert.strictEqual(left.length, 1);
  assert.ok(left[0].startsWith(hB.slice(0, 16)));
});

test('retractSession: L1 sole dead source -> archived; pinned -> needs_review', async (t) => {
  const { mod, store, memRoot } = await mk(t);
  const hX = await mkSpool(memRoot, 'sessX', 'dead digest');
  const id1 = await store.upsertEntry(entry({ source_ids: [hX] }));
  const id2 = await store.upsertEntry(entry({ source_ids: [hX], pinned: true }));
  const rep = await mod.retractSession(memRoot, store, 'sessX', function () {});
  assert.strictEqual(rep.forgotten.length, 1);
  assert.strictEqual(rep.flagged.length, 1);
  const m1 = await store.readBody;   // noop keep shape
  for await (const m of store.scanMeta()) {
    if (m.id === id1) assert.strictEqual(m.status, 'archived');
    if (m.id === id2) assert.strictEqual(m.status, 'needs_review');
  }
  void m1;
});

test('retractSession: L2 partial survivor stripped and active; all dead -> needs_review', async (t) => {
  const { mod, store, memRoot } = await mk(t);
  const hX = await mkSpool(memRoot, 'sessX', 'dead digest');
  const hY = await mkSpool(memRoot, 'sessY', 'alive digest');
  const id1 = await store.upsertEntry(entry({ layer: 2, source_ids: [hX, hY] }));
  const id2 = await store.upsertEntry(entry({ layer: 2, source_ids: [hX] }));
  const rep = await mod.retractSession(memRoot, store, 'sessX');
  assert.strictEqual(rep.stripped.length, 1);
  assert.strictEqual(rep.flagged.length, 1);
  for await (const m of store.scanMeta()) {
    if (m.id === id1) { assert.strictEqual(m.status, 'active'); assert.deepStrictEqual(m.source_ids, [hY]); }
    if (m.id === id2) assert.strictEqual(m.status, 'needs_review');
  }
});

test('deadDshSessions: manifest dsh rows vs disk; dir missing -> unavailable', async (t) => {
  const { mod, root } = await mk(t);
  const dshDir = path.join(root, 'sessions');
  const s1 = path.join(dshDir, '--ws--', 'session-aaa');
  await fsp.mkdir(s1, { recursive: true });
  await fsp.writeFile(path.join(s1, 'session.v3.jsonl.zstd'), Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x01]));
  const sessions = { 'session-aaa': { src: 'dsh' }, 'session-bbb': { src: 'dsh' }, 'session-ccc': {} };
  const scan = await mod.deadDshSessions(sessions, dshDir);
  assert.deepStrictEqual(scan.dead, ['session-bbb'], 'vanished file detected; non-dsh row ignored');
  const scan2 = await mod.deadDshSessions(sessions, path.join(root, 'no-such-dir'));
  assert.strictEqual(scan2.unavailable, true, 'missing dir = source unavailable, never retract');
});

test('reconcile e2e: enrolled session ingested, artifact deleted, next reconcile retracts', async (t) => {
  const { mod, store, dataDir, root, memRoot } = await mk(t);
  const logs = [];
  const watchDir = path.join(root, 'dsh-home', 'sessions');
  const wsDir = path.join(root, 'ws');
  const sessDir = path.join(watchDir, '--X-tmp--', 'session-del-0001');
  await fsp.mkdir(sessDir, { recursive: true });
  await fsp.mkdir(wsDir, { recursive: true });
  const zlib = await import('node:zlib');
  const frame = (txt) => zlib.zstdCompressSync(Buffer.from(txt, 'utf8'));
  const header = JSON.stringify({ type: 'session', version: 3, id: 'session-del-0001', createdAt: 1, cwd: wsDir });
  const userLine = JSON.stringify({ type: 'user/message', seq: 1, data: { message: { role: 'user', content: [{ type: 'text', text: 'to be deleted' }] } } });
  const art = path.join(sessDir, 'session.v3.jsonl.zstd');
  await fsp.writeFile(art, Buffer.concat([frame(header + '\n'), frame(userLine + '\n')]));
  await fsp.writeFile(path.join(wsDir, '.brain.json'), JSON.stringify({ studio: 's1', member: 'local', agent_label: 'tester', token: 't'.repeat(40) }));
  const worker = new mod.IngestWorker({ dataDir, store, logger: (m) => logs.push(m), watch: { claude: null, codex: null, dsh: watchDir }, dshIdleMs: 1000 });
  const old = new Date(Date.now() - 60000);
  await fsp.utimes(art, old, old);
  assert.strictEqual(await worker.reconcile(), 1, 'enrolled session ingested');
  const mf = JSON.parse(await fsp.readFile(path.join(dataDir, 'ingest-manifest.json'), 'utf8'));
  assert.strictEqual(mf.sessions['session-del-0001'].src, 'dsh', 'manifest row carries dsh marker');
  // 删除会话工件(整目录)
  await fsp.rm(sessDir, { recursive: true, force: true });
  await worker.reconcile();
  const logsAll = logs.join('\n');
  assert.ok(logsAll.indexOf('retraction session-del-0001') !== -1, 'retraction logged');
  assert.strictEqual((await readL0Lines(memRoot)).length, 0, 'L0 rows retracted');
  const mf2 = JSON.parse(await fsp.readFile(path.join(dataDir, 'ingest-manifest.json'), 'utf8'));
  assert.strictEqual(mf2.sessions['session-del-0001'], undefined, 'manifest row removed');
});

test('reconcile safety valve: whole dsh dir missing -> retraction skipped, nothing lost', async (t) => {
  const { mod, store, dataDir, root } = await mk(t);
  const logs = [];
  const watchDir = path.join(root, 'dsh-home', 'sessions');
  await fsp.mkdir(watchDir, { recursive: true });
  const worker = new mod.IngestWorker({ dataDir, store, logger: (m) => logs.push(m), watch: { claude: null, codex: null, dsh: watchDir }, dshIdleMs: 1000 });
  // 伪造一条 dsh manifest 行(文件其实不存在,但整个目录将被移走模拟盘未挂载)
  await fsp.mkdir(path.join(dataDir, 'memory'), { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'ingest-manifest.json'), JSON.stringify({ schema_version: 1, sessions: { 'session-gone': { hash: 'h', ts: 't', identity: 's1/local/x', src: 'dsh' } } }));
  await fsp.rm(watchDir, { recursive: true, force: true });   // 目录整体消失 = 源不可用
  await worker.reconcile();
  assert.ok(logs.join('\n').indexOf('source unavailable') !== -1, 'unavailability logged');
  const mf = JSON.parse(await fsp.readFile(path.join(dataDir, 'ingest-manifest.json'), 'utf8'));
  assert.ok(mf.sessions['session-gone'], 'row kept, no retraction on unavailable source');
});
