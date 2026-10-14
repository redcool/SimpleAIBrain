'use strict';
// DSH harness ingestion (M06 section 2 DSH row): zstd framed session -> L0 via reconcile
const { test } = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');

function frame(jsonText) {
  return zlib.zstdCompressSync(Buffer.from(jsonText, 'utf8'));
}
function sessionArtifact(extraLines) {
  const header = JSON.stringify({ type: 'session', version: 3, id: 'session-test', createdAt: 1791945823629, cwd: 'X:/tmp' });
  const lines = [header].concat(extraLines || []);
  return Buffer.concat(lines.map((l) => frame(l + '\n')));
}

async function mk(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-'));
  const dataDir = path.join(root, 'data');
  const mod = await import('../dist/index.js');
  const store = new mod.FileStore(path.join(dataDir, 'memory'));
  await store.init();
  if (t && t.after) t.after(async () => { await fsp.rm(root, { recursive: true, force: true }); });
  return { mod, store, dataDir, root };
}

test('dsh-jsonl parser: framed zstd artifact -> user/assistant text, redacted into L0', async (t) => {
  const { mod, store, dataDir, root } = await mk(t);
  const worker = new mod.IngestWorker({ dataDir, store, logger: function () {}, watch: { claude: null, codex: null, dsh: null } });
  const art = path.join(root, 'session.v3.jsonl.zstd');
  await fsp.writeFile(art, sessionArtifact([
    JSON.stringify({ type: 'user/message', seq: 1, time: 1, data: { message: { role: 'user', content: [{ type: 'text', text: 'store the key sk-ABCDEFGHIJKLMNOP123456' }] } } }),
    JSON.stringify({ type: 'assistant/message', seq: 2, time: 2, data: { message: { role: 'assistant', content: [{ type: 'reasoning', text: 'internal thoughts' }, { type: 'text', text: 'done, saved' }] } } }),
    JSON.stringify({ type: 'tool/call', seq: 3, time: 3, data: { name: 'pwsh', arguments: '{}' } }),
  ]));
  const r = await worker.ingestOne({ harness: 'dsh-jsonl', session_id: 'session-test', transcript_path: art });
  assert.strictEqual(r.ok, true);
  const l0dir = path.join(store.root, 'L0-log');
  const months = await fsp.readdir(l0dir);
  const files = await fsp.readdir(path.join(l0dir, months[0]));
  const text = await fsp.readFile(path.join(l0dir, months[0], files[0]), 'utf8');
  const rec = JSON.parse(text);
  assert.strictEqual(rec.harness, 'dsh-jsonl');
  assert.ok(rec.digest.indexOf('user: store the key') !== -1, 'user text extracted');
  assert.ok(rec.digest.indexOf('assistant: done, saved') !== -1, 'assistant text extracted, reasoning skipped');
  assert.ok(rec.digest.indexOf('sk-ABCD') === -1, 'secret redacted');
});

test('scanZstdFrames: torn trailing frame skipped, complete frames decoded', async (t) => {
  const { mod } = await mk(t);
  const good = sessionArtifact([JSON.stringify({ type: 'user/message', seq: 1, data: { message: { content: 'hello' } } })]);
  const torn = Buffer.concat([good, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x01])]);
  const text = mod.decodeDshArtifact(torn);
  assert.ok(text.indexOf('hello') !== -1, 'complete frames survive torn tail');
});

test('dsh-jsonl drift: malformed lines over 30 percent rejected', async (t) => {
  const { mod, store, dataDir, root } = await mk(t);
  const worker = new mod.IngestWorker({ dataDir, store, logger: function () {}, watch: { claude: null, codex: null, dsh: null } });
  const art = path.join(root, 'bad.v3.jsonl.zstd');
  await fsp.writeFile(art, sessionArtifact(['garbage-1', 'garbage-2', 'garbage-3', 'garbage-4']));
  const r = await worker.ingestOne({ harness: 'dsh-jsonl', session_id: 'sBad', transcript_path: art });
  assert.strictEqual(r.ok, false);
  assert.ok(String(r.error).indexOf('format drift') !== -1);
});

test('reconcile dsh source: idle gate, hash dedupe, re-ingest on change', async (t) => {
  const { mod, store, dataDir, root } = await mk(t);
  const watchDir = path.join(root, 'dsh-home', 'sessions');
  const sessDir = path.join(watchDir, '--X-tmp--', 'session-abc-1234');
  await fsp.mkdir(sessDir, { recursive: true });
  const art = path.join(sessDir, 'session.v3.jsonl.zstd');
  const worker = new mod.IngestWorker({ dataDir, store, logger: function () {}, watch: { claude: null, codex: null, dsh: watchDir }, dshIdleMs: 1000 });
  await fsp.writeFile(art, sessionArtifact([JSON.stringify({ type: 'user/message', seq: 1, data: { message: { content: 'first take' } } })]));
  assert.strictEqual(await worker.reconcile(), 0, 'active fresh-mtime session skipped');
  const old = new Date(Date.now() - 60000);
  await fsp.utimes(art, old, old);
  assert.strictEqual(await worker.reconcile(), 1, 'idle session submitted');
  assert.strictEqual(await worker.reconcile(), 0, 'hash dedupe on second pass');
  const mf = JSON.parse(await fsp.readFile(path.join(dataDir, 'ingest-manifest.json'), 'utf8'));
  assert.strictEqual(mf.sessions['session-abc-1234'].hash.length, 64, 'manifest keyed by session dir name');
  await fsp.appendFile(art, frame(JSON.stringify({ type: 'user/message', seq: 2, data: { message: { content: 'second take' } } }) + '\n'));
  assert.strictEqual(await worker.reconcile(), 0, 'woken session skipped while fresh');
  await fsp.utimes(art, old, old);
  assert.strictEqual(await worker.reconcile(), 1, 'changed hash resubmitted after idle');
});

test('dshHome: DSH_HOME wins, default homedir/.dsh', async (t) => {
  const { mod } = await mk(t);
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = 'X:/custom/home';
  assert.strictEqual(mod.dshHome(), path.resolve('X:/custom/home'));
  delete process.env.DSH_HOME;
  assert.strictEqual(mod.dshHome(), path.join(os.homedir(), '.dsh'));
  if (prev !== undefined) process.env.DSH_HOME = prev;
});
