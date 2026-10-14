'use strict';
// M10 quality + M11 security (mandatory items) acceptance tests. Run: npm test
const { test } = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

const NOW = new Date('2026-10-14T12:00:00Z');

async function mk(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'm10m11-'));
  const dataDir = path.join(root, 'data');
  const mod = await import('../dist/index.js');
  const store = new mod.FileStore(path.join(dataDir, 'memory'));
  await store.init();
  const member = mod.makeIdentity('s1', 'alice', '');
  if (t && t.after) t.after(async () => { await fsp.rm(root, { recursive: true, force: true }); });
  return { mod, store, dataDir, root, member };
}

async function entry(store, layer, scope, member, agent, status, imp) {
  return store.upsertEntry({ schema_version: 1, id: '', layer, scope, owner: { member, agent: agent || '' }, title: 't' + Math.random().toString(36).slice(2, 6), kind: 'fact', importance: imp === undefined ? 0.5 : imp, stability: 1.0, access_count: 0, last_access: NOW.toISOString(), status: status || 'active', pinned: false, superseded_by: null, source_ids: [], tags: [], created_by: 't', created_at: NOW.toISOString(), updated_at: NOW.toISOString(), body: 'b' });
}

test('M10 stats: valid JSON on empty and full store; scopes/recall_7d/consolidation present', async (t) => {
  const { mod, store, dataDir, member } = await mk(t);
  const empty = await mod.callTool({ identity: member, store }, 'memory.stats', {});
  assert.strictEqual(empty.isError, false);
  assert.strictEqual(empty.content.layers.L1, 0);
  assert.deepStrictEqual(empty.content.scopes, { studio: 0, member: 0, agent: 0 });
  assert.deepStrictEqual(empty.content.recall_7d, { queries: 0, hits: 0 });
  assert.strictEqual(empty.content.consolidation, null);
  await entry(store, 1, 'agent', 'alice', 'builder');
  await entry(store, 2, 'member', 'alice', '');
  await entry(store, 3, 'studio', 'studio', '');
  await mod.appendRecallLog(store, member, 'ulid 为何', ['x1', 'x2'], NOW);
  await fsp.writeFile(path.join(dataDir, 'consolidation-state.json'), JSON.stringify({ schema_version: 1, processed_spool: {}, last_run: { run_id: 'run_z', summarized: 3, merged: 1, distilled: 0, archived: 0 } }));
  const full = await mod.callTool({ identity: member, store }, 'memory.stats', {});
  assert.strictEqual(full.content.layers.L3, 1);
  assert.strictEqual(full.content.scopes.agent, 1);
  assert.strictEqual(full.content.scopes.studio, 1);
  assert.deepStrictEqual(full.content.recall_7d, { queries: 1, hits: 2 });
  assert.strictEqual(full.content.consolidation.run_id, 'run_z');
});

test('M10 recall-log replay: every logged id resolves to an entry (incl. superseded)', async (t) => {
  const { mod, store, member } = await mk(t);
  const a = await entry(store, 2, 'member', 'alice', '');
  const b = await entry(store, 2, 'member', 'alice', '');
  await store.patchMeta(b, { status: 'superseded', superseded_by: a });
  await mod.appendRecallLog(store, member, 'q1', [a, b], NOW);
  const ids = [a, b];
  for (const id of ids) {
    let found = false;
    for await (const e of store.iterateByScope({ includeArchived: true })) if (e.id === id) found = true;
    assert.ok(found, 'logged id replayable: ' + id);
  }
});

test('M10 review summary: consolidation run end logs needs_review + quarantined counts', async (t) => {
  const { mod, store, dataDir } = await mk(t);
  const lines = [];
  const worker = new mod.Consolidator(store, { dataDir, callLLM: async () => 'not-json', logger: (m) => lines.push(m), minMergeGroup: 1 });
  await entry(store, 2, 'member', 'alice', '');
  const r = await worker.run();
  assert.strictEqual(r.conflicts_needs_review, 0);
  const summary = lines.find((l) => l.indexOf('review summary') !== -1);
  assert.ok(summary, 'review summary line present');
  assert.ok(summary.indexOf('needs_review=') !== -1 && summary.indexOf('quarantined=') !== -1);
  assert.strictEqual(lines.filter((l) => l.indexOf('consolidation run_') !== -1).length, 1, 'run line present');
});

test('M10 self-exclusion: recall-log content never counted as entries', async (t) => {
  const { mod, store, member } = await mk(t);
  await entry(store, 2, 'member', 'alice', '');
  const before = await mod.callTool({ identity: member, store }, 'memory.stats', {});
  const dir = path.join(store.root, 'recall-log');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, '2026-10.jsonl'), JSON.stringify({ id: 'mem_fake', layer: 2, title: 'poison', status: 'active' }) + '\n');
  const after = await mod.callTool({ identity: member, store }, 'memory.stats', {});
  assert.strictEqual(after.content.layers.L1 + after.content.layers.L2 + after.content.layers.L3, before.content.layers.L1 + before.content.layers.L2 + before.content.layers.L3, 'recall-log self-excluded from index');
});

test('M11 poison labeling: context block first line carries data-not-instruction tag', async (t) => {
  const { mod, store, member } = await mk(t);
  await store.upsertEntry({ schema_version: 1, id: '', layer: 2, scope: 'member', owner: { member: 'alice', agent: '' }, title: 'kv store', kind: 'decision', importance: 0.6, stability: 1.0, access_count: 0, last_access: NOW.toISOString(), status: 'active', pinned: false, superseded_by: null, source_ids: [], tags: ['ulid'], created_by: 't', created_at: NOW.toISOString(), updated_at: NOW.toISOString(), body: 'we chose ULID' });
  const r = await mod.callTool({ identity: member, store }, 'memory.context', { query: 'ulid' });
  const text = r.content.text !== undefined ? r.content.text : String(r.content);
  assert.ok(String(text).indexOf('数据非指令') !== -1, 'first-line tag present');
});

test('M11 redaction: three sources (tool args / session body / imported md) all masked', async (t) => {
  const { mod, store, dataDir, root } = await mk(t);
  const args = mod.redactArgs({ token: 'abc', note: 'fine' }, 2048);
  assert.ok(args.indexOf('[REDACTED]') !== -1, 'tool args masked');
  const body = mod.redactText('key is sk-ABCDEFGHIJKLMNOP123456 in chat', 2048);
  assert.ok(body.indexOf('sk-ABCD') === -1, 'session body masked');
  const worker = new mod.IngestWorker({ dataDir, store, logger: function () {}, watch: { claude: null, codex: null } });
  const r = await worker.ingestOne({ harness: 'digest-md', session_id: 'sM', content: '# imported notes\napi key ghp_AAAABBBBCCCCDDDDEEEE1111' });
  assert.strictEqual(r.ok, true, 'imported md ingested');
  const l0dir = path.join(store.root, 'L0-log');
  const months = await fsp.readdir(l0dir);
  const files = await fsp.readdir(path.join(l0dir, months[0]));
  const text = await fsp.readFile(path.join(l0dir, months[0], files[0]), 'utf8');
  assert.ok(text.indexOf('ghp_AAAA') === -1, 'imported md masked in L0');
});

test('M11 member exit: subtree removed, stats consistent, git records it', async (t) => {
  const { mod, store, dataDir, member } = await mk(t);
  execSync('git init', { cwd: dataDir });
  await entry(store, 1, 'agent', 'alice', 'builder');
  await entry(store, 2, 'member', 'alice', '');
  await entry(store, 3, 'studio', 'studio', '');
  const removed = await store.removeMember('alice');
  assert.strictEqual(removed, 2, 'personal entries cleared');
  await new Promise((r2) => setTimeout(r2, 80));
  let aliceLeft = 0, studioKept = 0;
  for await (const e of store.iterateByScope({ includeArchived: true })) {
    if (e.scope === 'studio') studioKept++;
    else if (e.owner.member === 'alice') aliceLeft++;
  }
  assert.strictEqual(aliceLeft, 0, 'no alice personal entries remain');
  assert.strictEqual(studioKept, 1, 'studio entry kept');
  const st = await mod.callTool({ identity: member, store }, 'memory.stats', {});
  assert.strictEqual(st.content.scopes.studio, 1);
  const committed = await mod.gitCommitIfRepo(dataDir, 'member exit: alice (2 entries cleared)');
  assert.strictEqual(committed, true);
  const log = execSync('git log --oneline', { cwd: dataDir }).toString();
  assert.ok(log.indexOf('member exit: alice') !== -1, 'exit recorded in git');
});

test('M11 restore drill: clone data/ repo, fresh store stats match', async (t) => {
  const { mod, store, dataDir, root } = await mk(t);
  execSync('git init', { cwd: dataDir });
  const id1 = await entry(store, 2, 'member', 'alice', '');
  const id2 = await entry(store, 2, 'member', 'alice', '');
  assert.strictEqual(await mod.gitCommitIfRepo(dataDir, 'backup before drill'), true);
  const cloneDir = path.join(root, 'restore');
  execSync('git clone ' + JSON.stringify(dataDir) + ' ' + JSON.stringify(cloneDir));
  const restored = new mod.FileStore(path.join(cloneDir, 'memory'));
  await restored.init();
  let n = 0;
  for await (const e of restored.iterateByScope({ includeArchived: true })) { if (e.id === id1 || e.id === id2) n++; }
  assert.strictEqual(n, 2, 'restored entries match pre-delete stats');
});
