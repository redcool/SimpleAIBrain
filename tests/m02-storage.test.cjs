'use strict';
// M02 storage acceptance tests (M02 section 7). Run: npm test
const { test } = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const TMP = path.join(__dirname, '..', 'tmp');

async function mkStore(t) {
  const dir = await fsp.mkdtemp(path.join(TMP, 'm02-'));
  const mem = path.join(dir, 'memory');
  const mod = await import('../dist/index.js');
  const s = new mod.FileStore(mem);
  await s.init();
  t.after(async () => { await fsp.rm(dir, { recursive: true, force: true }); });
  return { s, mem, dir, mod };
}

function entry(partial) {
  return Object.assign({
    id: '',
    layer: 1,
    scope: 'agent',
    owner: { member: 'alice', agent: 'builder' },
    title: 'fbx axis mapping',
    kind: 'fact',
    body: 'Blender -Y -> Unity +Z needs manual axis mapping',
  }, partial || {});
}

function listFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full); else out.push(full);
    }
  })(dir);
  return out;
}

const relTo = (mem, f) => f.slice(mem.length + 1).split(path.sep);

test('roundtrip: upsert -> indexed -> readBody returns body without frontmatter', async (t) => {
  const { s, mem } = await mkStore(t);
  const id = await s.upsertEntry(entry({}));
  assert.ok(id.startsWith('mem_') && id.length === 30, 'id like mem_<ULID>');
  assert.strictEqual(s.size, 1);
  const files = listFiles(mem).filter((f) => f.endsWith('.md'));
  assert.strictEqual(files.length, 1);
  const rel = relTo(mem, files[0]);
  const segs = ['members', 'alice', 'agents', 'builder', 'L1'];
  assert.ok(segs.every((seg, i) => rel[i] === seg), 'agent scope dir: ' + rel.join('/'));
  assert.ok(files[0].endsWith('_fbx-axis-mapping.md'), 'filename from title slug');
  const body = await s.readBody(id);
  assert.ok(body.includes('needs manual axis mapping'), 'body complete');
  assert.ok(!body.includes('schema_version'), 'body has no frontmatter');
});

test('upsert same id twice: no duplicate file, content updated', async (t) => {
  const { s, mem } = await mkStore(t);
  const e = entry({});
  const id = await s.upsertEntry(e);
  await s.upsertEntry({ ...e, id, body: 'updated body' });
  const files = listFiles(mem).filter((f) => f.endsWith('.md'));
  assert.strictEqual(files.length, 1);
  assert.strictEqual((await s.readBody(id)).trim(), 'updated body');
});

test('moveEntry L1 to L2: old gone, new exists, layer=2', async (t) => {
  const { s, mem } = await mkStore(t);
  const id = await s.upsertEntry(entry({}));
  await s.moveEntry(id, 2);
  const after = listFiles(mem).filter((f) => f.endsWith('.md'));
  assert.strictEqual(after.length, 1);
  assert.ok(relTo(mem, after[0]).includes('L2'), 'moved to L2');
  for await (const m of s.iterateByScope({})) assert.strictEqual(m.layer, 2);
});

test('patchMeta: allowed fields apply; layer rejected; unknown id errors', async (t) => {
  const { s } = await mkStore(t);
  const id = await s.upsertEntry(entry({}));
  await s.patchMeta(id, { access_count: 3, status: 'archived' });
  for await (const m of s.iterateByScope({ includeArchived: true })) {
    assert.strictEqual(m.access_count, 3);
    assert.strictEqual(m.status, 'archived');
  }
  await assert.rejects(() => s.patchMeta(id, { layer: 2 }), /not patchable/);
  await assert.rejects(() => s.patchMeta('mem_NOPE', { status: 'active' }), /unknown id/);
});

test('iterateByScope: archived excluded by default; filters work', async (t) => {
  const { s } = await mkStore(t);
  const a = await s.upsertEntry(entry({}));
  await s.upsertEntry(entry({ title: 'member fact', scope: 'member', owner: { member: 'alice' } }));
  await s.patchMeta(a, { status: 'archived' });
  let n = 0;
  for await (const m of s.iterateByScope({})) { n++; assert.notStrictEqual(m.status, 'archived'); }
  assert.strictEqual(n, 1);
  n = 0;
  for await (const m of s.iterateByScope({ includeArchived: true })) n++;
  assert.strictEqual(n, 2);
  n = 0;
  for await (const m of s.iterateByScope({ scope: 'member' })) n++;
  assert.strictEqual(n, 1);
  n = 0;
  for await (const m of s.iterateByScope({ layer: 2 })) n++;
  assert.strictEqual(n, 0);
});

test('appendLog: L0-log/YYYY-MM/<agent>.jsonl appends lines', async (t) => {
  const { s, mem } = await mkStore(t);
  await s.appendLog({ ts: '2026-10-14T01:00:00Z', harness: 'claude-code', agent_label: 'builder', kind: 'toolflow', tool: 'blender.body.build' });
  await s.appendLog({ ts: '2026-10-14T02:00:00Z', harness: 'claude-code', agent_label: 'builder', kind: 'toolflow', tool: 'bridge.call' });
  const file = path.join(mem, 'L0-log', '2026-10', 'builder.jsonl');
  const text = await fsp.readFile(file, 'utf8');
  assert.strictEqual(text.trim().split('\n').length, 2);
  assert.ok(text.includes('blender.body.build'));
});

test('broken YAML -> quarantined, not indexed, no crash', async (t) => {
  const { s, mem } = await mkStore(t);
  const badDir = path.join(mem, 'members', 'alice', 'agents', 'builder', 'L1');
  await fsp.mkdir(badDir, { recursive: true });
  await fsp.writeFile(path.join(badDir, '2026-10-14_broken.md'), '---\nid: [unclosed\nbody: whatever\n---\nhi\n');
  const { FileStore } = await import('../dist/index.js');
  const fresh = new FileStore(mem);
  await fresh.init();
  assert.strictEqual(fresh.size, 0);
  assert.strictEqual(fresh.getQuarantined().length, 1);
  assert.strictEqual(listFiles(path.join(mem, '_quarantine')).length, 1);
  assert.ok(!fs.existsSync(path.join(badDir, '2026-10-14_broken.md')), 'moved away');
});

test('leftover tmp file: ignored by scan, cleaned on init', async (t) => {
  const { s, mem } = await mkStore(t);
  await s.upsertEntry(entry({}));
  const dir1 = path.join(mem, 'members', 'alice', 'agents', 'builder', 'L1');
  const tmpFile = path.join(dir1, '2026-10-14_x.md.tmp-abc123');
  await fsp.writeFile(tmpFile, 'garbage');
  const { FileStore } = await import('../dist/index.js');
  const fresh = new FileStore(mem);
  await fresh.init();
  assert.strictEqual(fresh.size, 1);
  assert.ok(!fs.existsSync(tmpFile), 'tmp leftover cleaned');
});

test('external file -> rescan() picks it up', async (t) => {
  const { s, mem, mod } = await mkStore(t);
  const dir = path.join(mem, 'members', 'bob', 'agents', 'coder', 'L1');
  await fsp.mkdir(dir, { recursive: true });
  const fm = [
    '---',
    'schema_version: 1',
    'id: ' + mod.newMemId(),
    'layer: 1',
    'scope: agent',
    'owner:',
    '  member: bob',
    '  agent: coder',
    'title: external entry',
    'kind: fact',
    'importance: 0.5',
    'stability: 1.0',
    'access_count: 0',
    'last_access: 2026-10-14T00:00:00Z',
    'status: active',
    'superseded_by: null',
    'source_ids: []',
    'created_by: alice',
    'created_at: 2026-10-14T00:00:00Z',
    'updated_at: 2026-10-14T00:00:00Z',
    '---',
    '',
    'hello',
    '',
  ].join('\n');
  await fsp.writeFile(path.join(dir, '2026-10-14_external.md'), fm);
  assert.strictEqual(s.size, 0);
  await s.rescan();
  assert.strictEqual(s.size, 1);
});

test('studio/member scope paths; same title different id not overwritten', async (t) => {
  const { s, mem } = await mkStore(t);
  await s.upsertEntry(entry({ title: 'shared knowledge', scope: 'studio', owner: { member: '' }, layer: 3 }));
  await s.upsertEntry(entry({ title: 'member knowledge', scope: 'member', owner: { member: 'alice' }, layer: 3 }));
  const f1 = listFiles(mem).find((f) => relTo(mem, f)[0] === 'studio');
  const f2 = listFiles(mem).find((f) => relTo(mem, f)[0] === 'members' && relTo(mem, f)[2] === 'L3');
  assert.ok(f1, 'studio/L3 exists');
  assert.ok(f2, 'members/alice/L3 exists');
  const id1 = await s.upsertEntry(entry({ title: 'same title', body: 'one' }));
  const id2 = await s.upsertEntry(entry({ title: 'same title', body: 'two' }));
  assert.notStrictEqual(id1, id2);
  assert.strictEqual(s.size, 4);
  const md = listFiles(mem).filter((f) => f.endsWith('.md') && f.includes('same-title'));
  assert.strictEqual(md.length, 2, 'same-name files not overwritten');
});

test('gitCommitIfRepo: false for non-repo; commits inside repo', async (t) => {
  const { s, dir } = await mkStore(t);
  const mod = await import('../dist/index.js');
  assert.strictEqual(await mod.gitCommitIfRepo(dir, 'should not commit'), false);
  const hasGit = await new Promise((res) => execFile('git', ['--version'], { windowsHide: true }, (e) => res(!e)));
  if (!hasGit) return;
  await new Promise((res) => execFile('git', ['init'], { cwd: dir, windowsHide: true }, () => res()));
  await s.upsertEntry(entry({}));
  const ok = await mod.gitCommitIfRepo(dir, 'test: m02 commit');
  assert.strictEqual(ok, true);
  const log = await new Promise((res) => execFile('git', ['log', '--oneline'], { cwd: dir, windowsHide: true }, (e, o) => res(e ? '' : o)));
  assert.ok(log.includes('test: m02 commit'));
});
