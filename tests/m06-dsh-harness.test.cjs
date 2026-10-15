'use strict';
// DSH harness ingestion (M06): opt-in enrollment + ignore_session_prefix + framed zstd sessions
const { test } = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

function frame(jsonText) {
  return zlib.zstdCompressSync(Buffer.from(jsonText, 'utf8'));
}
function sessionArtifact(wsDir, extraLines, title) {
  const header = JSON.stringify({ type: 'session', version: 3, id: 'session-test', createdAt: 1791945823629, cwd: wsDir });
  const lines = [header];
  if (title !== undefined) lines.push(JSON.stringify({ type: 'session/title', seq: 1, time: 1, data: { title: title, messageSeqs: [1], source: { kind: 'fallback' } } }));
  return Buffer.concat(lines.concat(extraLines || []).map((l) => frame(l + '\n')));
}
const USER_LINE = JSON.stringify({ type: 'user/message', seq: 2, time: 2, data: { message: { role: 'user', content: [{ type: 'text', text: 'store the key sk-ABCDEFGHIJKLMNOP123456' }] } } });
const ASST_LINE = JSON.stringify({ type: 'assistant/message', seq: 3, time: 3, data: { message: { role: 'assistant', content: [{ type: 'reasoning', text: 'internal thoughts' }, { type: 'text', text: 'done, saved' }] } } });
const TOOL_LINE = JSON.stringify({ type: 'tool/call', seq: 4, time: 4, data: { name: 'pwsh', arguments: '{}' } });

async function mk(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-'));
  const dataDir = path.join(root, 'data');
  const mod = await import('../dist/index.js');
  const store = new mod.FileStore(path.join(dataDir, 'memory'));
  await store.init();
  if (t && t.after) t.after(async () => { await fsp.rm(root, { recursive: true, force: true }); });
  return { mod, store, dataDir, root };
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
async function ageArt(f) {
  const old = new Date(Date.now() - 60000);
  await fsp.utimes(f, old, old);
}

test('dsh-jsonl parser: framed zstd artifact -> user/assistant text, redacted into L0', async (t) => {
  const { mod, store, dataDir, root } = await mk(t);
  const worker = new mod.IngestWorker({ dataDir, store, logger: function () {}, watch: { claude: null, codex: null, dsh: null } });
  const art = path.join(root, 'session.v3.jsonl.zstd');
  await fsp.writeFile(art, sessionArtifact('X:/nowhere', [USER_LINE, ASST_LINE, TOOL_LINE]));
  const r = await worker.ingestOne({ harness: 'dsh-jsonl', session_id: 'session-test', transcript_path: art, identity: 's1/alice/builder' });
  assert.strictEqual(r.ok, true);
  const rec = (await readL0(store))[0];
  assert.strictEqual(rec.harness, 'dsh-jsonl');
  assert.ok(rec.digest.indexOf('user: store the key') !== -1, 'user text extracted');
  assert.ok(rec.digest.indexOf('assistant: done, saved') !== -1, 'assistant text extracted, reasoning skipped');
  assert.ok(rec.digest.indexOf('sk-ABCD') === -1, 'secret redacted');
});

test('scanZstdFrames: torn trailing frame skipped, complete frames decoded', async (t) => {
  const { mod } = await mk(t);
  const good = sessionArtifact('X:/nowhere', [USER_LINE]);
  const torn = Buffer.concat([good, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x01])]);
  const text = mod.decodeDshArtifact(torn);
  assert.ok(text.indexOf('store the key') !== -1, 'complete frames survive torn tail');
});

test('extractDshMeta: header cwd + last title wins', async (t) => {
  const { mod } = await mk(t);
  const text = [
    JSON.stringify({ type: 'session', version: 3, id: 's1', cwd: 'H:/proj/a' }),
    JSON.stringify({ type: 'session/title', data: { title: 'first title' } }),
    JSON.stringify({ type: 'session/title', data: { title: 'renamed title' } }),
  ].join('\n');
  const meta = mod.extractDshMeta(text);
  assert.strictEqual(meta.cwd, 'H:/proj/a');
  assert.strictEqual(meta.title, 'renamed title');
  const bare = mod.extractDshMeta(JSON.stringify({ type: 'session', version: 3, id: 's1', cwd: 'H:/proj/b' }));
  assert.strictEqual(bare.cwd, 'H:/proj/b');
  assert.strictEqual(bare.title, undefined);
});

test('ingestOne: identity required (opt-in premise)', async (t) => {
  const { mod, store, dataDir, root } = await mk(t);
  const worker = new mod.IngestWorker({ dataDir, store, logger: function () {}, watch: { claude: null, codex: null, dsh: null } });
  const art = path.join(root, 'session.v3.jsonl.zstd');
  await fsp.writeFile(art, sessionArtifact('X:/nowhere', [USER_LINE]));
  const r = await worker.ingestOne({ harness: 'dsh-jsonl', session_id: 'session-test', transcript_path: art });
  assert.strictEqual(r.ok, false);
  assert.ok(String(r.error).indexOf('not enrolled') !== -1);
});

test('dsh-jsonl drift: malformed lines over 30 percent rejected', async (t) => {
  const { mod, store, dataDir, root } = await mk(t);
  const worker = new mod.IngestWorker({ dataDir, store, logger: function () {}, watch: { claude: null, codex: null, dsh: null } });
  const art = path.join(root, 'bad.v3.jsonl.zstd');
  await fsp.writeFile(art, sessionArtifact('X:/nowhere', ['garbage-1', 'garbage-2', 'garbage-3', 'garbage-4']));
  const r = await worker.ingestOne({ harness: 'dsh-jsonl', session_id: 'sBad', transcript_path: art, identity: 's1/alice/builder' });
  assert.strictEqual(r.ok, false);
  assert.ok(String(r.error).indexOf('format drift') !== -1);
});

test('reconcile dsh: enrollment gate, ignore prefix, hash dedupe, manifest row deletion', async (t) => {
  const { mod, store, dataDir, root } = await mk(t);
  const watchDir = path.join(root, 'dsh-home', 'sessions');
  const wsDir = path.join(root, 'ws');
  const sessDir = path.join(watchDir, '--X-tmp--', 'session-abc-1234');
  await fsp.mkdir(sessDir, { recursive: true });
  await fsp.mkdir(wsDir, { recursive: true });
  const art = path.join(sessDir, 'session.v3.jsonl.zstd');
  await fsp.writeFile(art, sessionArtifact(wsDir, [USER_LINE]));
  const worker = new mod.IngestWorker({ dataDir, store, logger: function () {}, watch: { claude: null, codex: null, dsh: watchDir }, dshIdleMs: 1000 });
  assert.strictEqual(await worker.reconcile(), 0, 'fresh mtime skipped (idle gate)');
  await ageArt(art);
  assert.strictEqual(await worker.reconcile(), 0, 'unenrolled workspace not ingested');
  const mfRaw = await fsp.readFile(path.join(dataDir, 'ingest-manifest.json'), 'utf8').catch(() => null);
  assert.strictEqual(mfRaw, null, 'manifest untouched for unenrolled (not even created)');
  await ageArt(art);   // 再过一次空闲闸门,下一断言才有机会摄入
  const bj = { studio: 's1', member: 'local', agent_label: 'tester', token: 't'.repeat(40) };
  await fsp.writeFile(path.join(wsDir, '.brain.json'), JSON.stringify(bj));
  await ageArt(art);
  assert.strictEqual(await worker.reconcile(), 1, 'enrolled workspace ingested');
  const rec = (await readL0(store))[0];
  assert.strictEqual(rec.agent_label, 'tester', 'L0 attributed to enrolled identity');
  assert.strictEqual((await readManifest(dataDir)).sessions['session-abc-1234'].identity, 's1/local/tester', 'manifest records identity');
  assert.strictEqual(await worker.reconcile(), 0, 'hash dedupe on second pass');
  // 手工删 manifest 行 → 下轮对账补交(覆盖自原 claude 对账测试)
  const raw = JSON.parse(await fsp.readFile(path.join(dataDir, 'ingest-manifest.json'), 'utf8'));
  delete raw.sessions['session-abc-1234'];
  await fsp.writeFile(path.join(dataDir, 'ingest-manifest.json'), JSON.stringify(raw));
  await ageArt(art);
  assert.strictEqual(await worker.reconcile(), 1, 'resubmitted after manifest row deleted');
  // ignore_session_prefix(默认 no_brain):命中标题的会话不摄
  const sess2 = path.join(watchDir, '--X-tmp--', 'session-def-5678');
  await fsp.mkdir(sess2, { recursive: true });
  const art2 = path.join(sess2, 'session.v3.jsonl.zstd');
  await fsp.writeFile(art2, sessionArtifact(wsDir, [USER_LINE], 'no_brain throwaway chat'));
  await ageArt(art2);
  assert.strictEqual(await worker.reconcile(), 0, 'prefixed session ignored');
  assert.strictEqual(Object.keys((await readManifest(dataDir)).sessions).length, 1, 'ignored session not in manifest');
  // 置空前缀 → 恢复摄入
  await fsp.writeFile(path.join(wsDir, '.brain.json'), JSON.stringify(Object.assign({}, bj, { ignore_session_prefix: '' })));
  await ageArt(art2);
  assert.strictEqual(await worker.reconcile(), 1, 'empty prefix disables ignore');
  assert.strictEqual(Object.keys((await readManifest(dataDir)).sessions).length, 2, 'both sessions recorded');
});

test('enroll script: writes .brain.json, registers token, refuses re-run without force', async (t) => {
  const { root } = await mk(t);
  const wsDir = path.join(root, 'myproj');
  await fsp.mkdir(wsDir, { recursive: true });
  const dataDir = path.join(root, 'hubdata');
  const script = path.join(__dirname, '..', 'scripts', 'enroll.mjs');
  const out1 = execFileSync(process.execPath, [script, wsDir, '--data-dir', dataDir], { encoding: 'utf8' });
  assert.ok(out1.indexOf('[enroll] wrote') !== -1, 'script reports write');
  const bj = JSON.parse(await fsp.readFile(path.join(wsDir, '.brain.json'), 'utf8'));
  assert.strictEqual(bj.studio, 's1');
  assert.strictEqual(bj.member, 'local');
  assert.strictEqual(bj.agent_label, 'myproj');
  assert.ok(bj.token.length >= 32, 'random token at least 32 chars');
  const tokens = JSON.parse(await fsp.readFile(path.join(dataDir, 'memory', '_identity', 'tokens.json'), 'utf8'));
  const idKey = Object.keys(tokens.tokens)[0];
  assert.strictEqual(idKey, 's1/local/myproj', 'token registered under identity');
  const first = await fsp.readFile(path.join(wsDir, '.brain.json'), 'utf8');
  const out2 = execFileSync(process.execPath, [script, wsDir, '--data-dir', dataDir], { encoding: 'utf8' });
  assert.ok(out2.indexOf('already enrolled') !== -1, 're-run without force is a no-op');
  const second = await fsp.readFile(path.join(wsDir, '.brain.json'), 'utf8');
  assert.strictEqual(second, first, 'token unchanged on re-run');
});
