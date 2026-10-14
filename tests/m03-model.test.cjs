'use strict';
// M03 memory model acceptance tests (M03 section 7). Run: npm test
const { test } = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const path = require('node:path');

const NOW = new Date('2026-10-14T12:00:00Z');
const TMP = path.join(__dirname, '..', 'tmp');

function meta(partial) {
  return Object.assign({
    id: 'mem_01TEST000000000000000000',
    layer: 1,
    scope: 'agent',
    owner: { member: 'alice', agent: 'builder' },
    title: 't',
    kind: 'fact',
    importance: 0.5,
    stability: 1.0,
    access_count: 0,
    last_access: '2026-10-14T02:00:00Z',   // delta-t = 10h before NOW
    status: 'active',
    pinned: false,
    superseded_by: null,
    source_ids: [],
    created_by: 'test',
    created_at: '2026-10-13T00:00:00Z',
    updated_at: '2026-10-13T00:00:00Z',
  }, partial || {});
}

async function mkStore(t) {
  const dir = await fsp.mkdtemp(path.join(TMP, 'm03-'));
  const mod = await import('../dist/index.js');
  const s = new mod.FileStore(path.join(dir, 'memory'));
  await s.init();
  if (t && t.after) t.after(async () => { await fsp.rm(dir, { recursive: true, force: true }); });
  return { s, mod };
}

test('scoring: dt=0 gives R=importance; exp decay over S; future clamped', async () => {
  const { mod } = await mkStore(null);
  const m = meta({ importance: 0.8, stability: 1.0, last_access: '2026-10-14T12:00:00Z' });
  const r0 = mod.recallScore(m, NOW);
  assert.ok(Math.abs(r0 - 0.8) < 1e-12, 'R=importance at dt=0, got ' + r0);
  const m24 = meta({ importance: 1.0, stability: 24.0, last_access: '2026-10-13T12:00:00Z' });
  const r24 = mod.recallScore(m24, NOW);
  assert.ok(Math.abs(r24 - Math.exp(-1)) < 1e-9, 'R=e^-1 at dt=S=24h, got ' + r24);
  const future = meta({ last_access: '2026-10-14T13:00:00Z' });
  assert.strictEqual(mod.recallScore(future, NOW), meta().importance, 'future dt clamped to 0');
  const tiny = meta({ importance: 0.0 });
  assert.strictEqual(mod.recallScore(tiny, NOW), 0, 'importance 0 -> R 0');
});

test('strengthen: S grows by (1+k); k=0 is no-op', async () => {
  const { mod } = await mkStore(null);
  assert.strictEqual(mod.strengthen(1.0, 0.25), 1.25);
  assert.strictEqual(mod.strengthen(2.0, 0), 2.0);
  assert.ok(Math.abs(mod.strengthen(4.0) - 5.0) < 1e-12, 'default k=0.25');
});

test('decaySweep: archives low-R actives, skips pinned and non-active', async () => {
  const { mod } = await mkStore(null);
  const low = meta({ id: 'mem_01LOW00000000000000000001', importance: 1.0, stability: 1.0 });       // R=e^-10
  const pinnedLow = meta({ id: 'mem_01LOW00000000000000000002', importance: 1.0, pinned: true });
  const strong = meta({ id: 'mem_01LOW00000000000000000003', stability: 1000.0 });                   // R~0.99
  const superseded = meta({ id: 'mem_01LOW00000000000000000004', status: 'superseded' });
  const already = meta({ id: 'mem_01LOW00000000000000000005', status: 'archived' });
  const review = meta({ id: 'mem_01LOW00000000000000000006', status: 'needs_review' });
  const rep = mod.decaySweep([low, pinnedLow, strong, superseded, already, review], NOW);
  assert.deepStrictEqual(rep.toArchive.map((x) => x.id), [low.id], 'only unpinned active low-R archived');
  assert.strictEqual(rep.scores.length, 6, 'scores reported for all');
});

test('state machine: legal edges pass, illegal rejected (superseded is terminal)', async () => {
  const { mod } = await mkStore(null);
  for (const to of ['superseded', 'archived', 'needs_review']) assert.ok(mod.canTransition('active', to));
  for (const to of ['active', 'superseded', 'archived']) assert.ok(mod.canTransition('needs_review', to));
  assert.ok(mod.canTransition('archived', 'active'), 'archived is reversible');
  for (const to of ['active', 'archived', 'needs_review']) assert.ok(!mod.canTransition('superseded', to), 'superseded terminal');
  assert.ok(!mod.canTransition('archived', 'superseded'));
  assert.ok(!mod.canTransition('active', 'active'));
  assert.throws(() => mod.assertTransition('superseded', 'active'), /illegal transition/);
});

test('promotion L1->L2: same-topic group or >=2 sessions + access>=3', async () => {
  const { mod } = await mkStore(null);
  const ok = meta({ layer: 1, access_count: 3 });
  assert.ok(mod.promotionVerdict(ok, { distinct_sessions: 2 }).eligible);
  assert.ok(!mod.promotionVerdict(ok, { distinct_sessions: 1 }).eligible, 'single session not enough');
  assert.ok(mod.promotionVerdict(meta({ layer: 1, access_count: 0 }), { distinct_sessions: 1, same_topic_group: true }).eligible);
});

test('promotion L2->L3: 3 sessions, or imp>=0.8+2 refs, or pin; L3 never', async () => {
  const { mod } = await mkStore(null);
  const m = meta({ layer: 2 });
  assert.ok(mod.promotionVerdict(m, { distinct_sessions: 3 }).eligible);
  assert.ok(!mod.promotionVerdict(m, { distinct_sessions: 2 }).eligible);
  assert.ok(mod.promotionVerdict(meta({ layer: 2, importance: 0.8 }), { distinct_sessions: 0, referring_sessions: 2 }).eligible);
  assert.ok(!mod.promotionVerdict(meta({ layer: 2, importance: 0.8 }), { distinct_sessions: 0, referring_sessions: 1 }).eligible);
  assert.ok(!mod.promotionVerdict(meta({ layer: 2, importance: 0.7 }), { distinct_sessions: 0, referring_sessions: 2 }).eligible);
  assert.ok(mod.promotionVerdict(meta({ layer: 2, pinned: true }), { distinct_sessions: 0 }).eligible);
  assert.ok(!mod.promotionVerdict(meta({ layer: 3 }), { distinct_sessions: 99 }).eligible);
});

test('conflict: low-priority supersedes; high-priority goes needs_review', async () => {
  const { mod } = await mkStore(null);
  assert.strictEqual(mod.resolveConflict(meta({ importance: 0.5, kind: 'fact' })), 'supersede');
  assert.strictEqual(mod.resolveConflict(meta({ importance: 0.8 })), 'needs_review');
  assert.strictEqual(mod.resolveConflict(meta({ kind: 'decision' })), 'needs_review');
  assert.strictEqual(mod.resolveConflict(meta({ pinned: true })), 'needs_review');
});

test('inheritProvenance: new entry inherits old chain, dedup, old untouched', async () => {
  const { mod } = await mkStore(null);
  const oldM = meta({ id: 'mem_01OLD000000000000000000001', source_ids: ['a', 'b'] });
  const fresh = meta({ id: 'mem_01NEW000000000000000000001', source_ids: ['b', 'c'] });
  mod.inheritProvenance(oldM, fresh);
  assert.deepStrictEqual(fresh.source_ids, ['b', 'c', 'mem_01OLD000000000000000000001', 'a']);
  assert.deepStrictEqual(oldM.source_ids, ['a', 'b'], 'old entry untouched');
});

test('integration: pin skips decay; archive->restore roundtrip via store', async (t) => {
  const { s, mod } = await mkStore(t);
  const id = await s.upsertEntry({ ...meta({ id: '', importance: 1.0, stability: 1.0 }), body: 'x' });
  await s.patchMeta(id, { pinned: true });
  let rep = mod.decaySweep(await Array.fromAsync(s.iterateByScope({ includeArchived: true })), NOW);
  assert.strictEqual(rep.toArchive.length, 0, 'pinned skipped by decay');
  await s.patchMeta(id, { pinned: false });
  rep = mod.decaySweep(await Array.fromAsync(s.iterateByScope({ includeArchived: true })), NOW);
  assert.strictEqual(rep.toArchive.length, 1, 'unpinned low-R archived candidate');
  const st = (await Array.fromAsync(s.iterateByScope({ includeArchived: true })))[0].status;
  mod.assertTransition(st, 'archived');
  await s.patchMeta(id, { status: 'archived' });
  let n = 0;
  for await (const m of s.iterateByScope({})) n++;
  assert.strictEqual(n, 0, 'archived hidden by default');
  mod.assertTransition('archived', 'active');
  await s.patchMeta(id, { status: 'active' });
  for await (const m of s.iterateByScope({})) n++;
  assert.strictEqual(n, 1, 'restored to active and visible');
});
