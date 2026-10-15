'use strict';
// M06 ingestion acceptance tests (M06 section 8). Run: npm test
const { test } = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function mk(t, extra) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'm06-'));
  const dataDir = path.join(root, 'data');
  const mod = await import('../dist/index.js');
  const store = new mod.FileStore(path.join(dataDir, 'memory'));
  await store.init();
  const worker = new mod.IngestWorker(Object.assign({ dataDir, store, logger: function () {}, watch: { claude: null, codex: null, dsh: null } }, extra || {}));
  if (t && t.after) t.after(async () => { worker.stop(); await fsp.rm(root, { recursive: true, force: true }); });
  return { mod, store, worker, dataDir, root };
}

async function readL0(store) {
  const dir = path.join(store.root, 'L0-log');
  const out = [];
  const walk = async (d) => {
    let entries = [];
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.jsonl')) {
        const text = await fsp.readFile(p, 'utf8');
        for (const line of text.split('\n')) if (line.trim()) out.push(JSON.parse(line));
      }
    }
  };
  await walk(dir);
  return out;
}

async function readManifest(dataDir) {
  return JSON.parse(await fsp.readFile(path.join(dataDir, 'ingest-manifest.json'), 'utf8'));
}

test('ingest via transcript_path: parsed, redacted, L0 logged, manifest recorded', async (t) => {
  const { mod, store, worker, dataDir, root } = await mk(t);
  const transcript = path.join(root, 't1.jsonl');
  await fsp.writeFile(transcript, JSON.stringify({ type: 'user', message: { content: 'please set key sk-ABCDEFGHIJKLMNOP123456' } }) + '\n' + JSON.stringify({ type: 'assistant', message: { content: 'ok, using it' } }) + '\n');
  const r = await worker.ingestOne({ harness: 'claude-jsonl', session_id: 'sA', transcript_path: transcript, identity: 's1/alice/builder' });
  assert.strictEqual(r.ok, true);
  assert.match(r.hash, /^[0-9a-f]{64}$/);
  const l0 = await readL0(store);
  assert.strictEqual(l0.length, 1);
  assert.strictEqual(l0[0].kind, 'session');
  assert.strictEqual(l0[0].harness, 'claude-jsonl');
  assert.strictEqual(l0[0].session_id, 'sA');
  assert.ok(l0[0].digest.indexOf('assistant') !== -1, 'parsed text present');
  assert.ok(l0[0].digest.indexOf('[REDACTED]') !== -1, 'secret masked');
  assert.ok(l0[0].digest.indexOf('sk-ABCD') === -1, 'raw secret absent');
  const mf = await readManifest(dataDir);
  assert.strictEqual(mf.sessions.sA.hash, r.hash);
});

test('idempotent: same session+hash -> duplicate, no second L0 line', async (t) => {
  const { store, worker, root } = await mk(t);
  const p = path.join(root, 't2.jsonl');
  await fsp.writeFile(p, JSON.stringify({ type: 'user', message: { content: 'hello world' } }) + '\n');
  await worker.ingestOne({ harness: 'claude-jsonl', session_id: 'sB', transcript_path: p, identity: 's1/alice/builder' });
  const r2 = await worker.ingestOne({ harness: 'claude-jsonl', session_id: 'sB', transcript_path: p, identity: 's1/alice/builder' });
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.duplicate, true);
  assert.strictEqual((await readL0(store)).length, 1);
});

test('unknown harness and parser drift are rejected, not guessed', async (t) => {
  const { worker, root } = await mk(t);
  const bad = await worker.ingestOne({ harness: 'gpt-json', session_id: 'sX', content: 'x' });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.error.indexOf('unknown harness') !== -1);
  const drift = path.join(root, 'drift.jsonl');
  await fsp.writeFile(drift, Array.from({ length: 10 }, (_, i) => 'not-json-' + i).join('\n'));
  const r = await worker.ingestOne({ harness: 'claude-jsonl', session_id: 'sX', transcript_path: drift, identity: 's1/alice/builder' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.indexOf('format drift') !== -1);
});

test('spool drain: hook note replayed and removed; re-drain adds nothing', async (t) => {
  const { store, worker, dataDir } = await mk(t);
  const spool = path.join(dataDir, 'ingest-spool');
  await fsp.mkdir(spool, { recursive: true });
  const note = path.join(spool, 'note1.json');
  await fsp.writeFile(note, JSON.stringify({ harness: 'digest-md', session_id: 'sC', kind: 'transcript', content: 'offline notes with ghp_AAAABBBBCCCCDDDDEEEE1111', identity: 's1/alice/builder' }));
  assert.strictEqual(await worker.drain(), 1);
  const l0 = await readL0(store);
  assert.strictEqual(l0.length, 1);
  assert.ok(l0[0].digest.indexOf('[REDACTED]') !== -1, 'ghp_ masked in spool replay');
  const left = await fsp.readdir(spool);
  assert.strictEqual(left.length, 0, 'note removed after success');
  assert.strictEqual(await worker.drain(), 0);
  assert.strictEqual((await readL0(store)).length, 1);
});

test('reconcile claude: unenrolled identity rejected (dormant until cwd lookup)', async (t) => {
  const { mod, store, dataDir, root } = await mk(t);
  const worker = new mod.IngestWorker({ dataDir, store, logger: function () {}, watch: { claude: path.join(root, 'watch'), codex: null, dsh: null } });
  const proj = path.join(root, 'watch', 'proj1');
  await fsp.mkdir(proj, { recursive: true });
  const f1 = path.join(proj, 'uuid-1111.jsonl');
  await fsp.writeFile(f1, JSON.stringify({ type: 'user', message: { content: 'watched session' } }) + '\n');
  // 0.0.12.0 opt-in:claude/codex 对账暂无 cwd→.brain.json 查找,摄入被身份闸门拒(休眠;DSH 通道承接对账覆盖)
  assert.strictEqual(await worker.reconcile(), 0);
  const mfRaw = await fsp.readFile(path.join(dataDir, 'ingest-manifest.json'), 'utf8').catch(() => null);
  assert.strictEqual(mfRaw, null, 'manifest not even created for unenrolled');
  assert.strictEqual((await readL0(store)).length, 0);
  assert.strictEqual(await worker.reconcile(), 0, 'steady state: no resubmission');
});

test('redactText: prefix patterns, sensitive field names, truncation', async (t) => {
  const { mod } = await mk(t);
  const s = mod.redactText('use sk-ABCDEFGHIJKLMNOP123456 and ghp_AAAABBBBCCCCDDDDEEEE1111', 2048);
  assert.ok(s.indexOf('sk-ABCD') === -1 && s.indexOf('ghp_AAAA') === -1);
  assert.match(s, /\[REDACTED\]/);
  const f = mod.redactText('{"api_key": "super-secret-value"}', 2048);
  assert.ok(f.indexOf('super-secret-value') === -1);
  const tr = mod.redactText('x'.repeat(3000), 2048);
  assert.strictEqual(tr.length, 2048 + '…(truncated)'.length);
});

test('identity from event lands in L0 agent_label', async (t) => {
  const { mod, store, worker } = await mk(t);
  await worker.ingestOne({ harness: 'digest-md', session_id: 'sD', content: 'plain notes', identity: 's1/alice/builder' });
  const l0 = await readL0(store);
  assert.strictEqual(l0[0].agent_label, 'builder');
});
