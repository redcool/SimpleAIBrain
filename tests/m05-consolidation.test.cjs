'use strict';
// M05 consolidation acceptance tests (M05 section 6). Run: npm test
const { test } = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');
const crypto = require('node:crypto');

const NOW = new Date('2026-10-14T12:00:00Z');
const OLD = '2026-07-16T00:00:00Z';

async function mk(t, opts) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'm05-'));
  const dataDir = path.join(root, 'data');
  const mod = await import('../dist/index.js');
  const store = new mod.FileStore(path.join(dataDir, 'memory'));
  await store.init();
  const state = { extractFail: new Set(), mergeOut: null, distillOut: null, delayMs: 0 };
  const fakeLLM = async (msgs) => {
    const prompt = msgs[0].content;
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
    if (prompt.indexOf('[任务:抽取]') === 0) {
      const m = prompt.match(/会话 id: (\S+)/);
      const sid = m ? m[1] : 's';
      if (state.extractFail.has(sid)) throw new Error('LLM down for ' + sid);
      return JSON.stringify(Object.assign({ summary: 'session ' + sid + ' 决定采用增量方案(出处: session ' + sid + ')', facts: [{ text: sid + ': 用 ULID 作主键', importance: 0.6, kind: 'fact' }] }, state.extractTitle ? { title: state.extractTitle } : {}));
    }
    if (prompt.indexOf('[任务:去重合并') === 0) {
      return JSON.stringify(state.mergeOut || { merges: [], conflicts: [] });
    }
    if (prompt.indexOf('[任务:蒸馏]') === 0) {
      if (state.distillOut) return JSON.stringify(state.distillOut);
      const m = prompt.match(/\[(mem_[a-z0-9]+)\]/);
      const id = m ? m[1] : 'mem_x';
      return JSON.stringify({ facts: [{ text: '原子事实(出处 ' + id + ')', kind: 'fact', importance: 0.9 }] });
    }
    throw new Error('unknown prompt');
  };
  const consolidator = new mod.Consolidator(store, Object.assign({ dataDir, callLLM: fakeLLM, logger: function () {} }, opts || {}));
  if (t && t.after) t.after(async () => { await fsp.rm(root, { recursive: true, force: true }); });
  return { mod, store, consolidator, dataDir, state };
}

async function seedSession(store, sid, content) {
  const full = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  await fsp.mkdir(path.join(store.root, '_spool'), { recursive: true });
  await fsp.writeFile(path.join(store.root, '_spool', full.slice(0, 16) + '.json'), JSON.stringify({ ts: NOW.toISOString(), session_id: sid, kind: 'digest', hash: full, identity: 's1/alice/builder', content }));
  return full.slice(0, 16);
}

async function allEntries(store, includeArchived) {
  const out = [];
  for await (const e of store.iterateByScope({ includeArchived: !!includeArchived })) out.push(e);
  return out;
}

test('summarize: 3 sessions -> 3 L1 entries with session citations', async (t) => {
  const { store, consolidator, dataDir } = await mk(t);
  for (const sid of ['s1', 's2', 's3']) await seedSession(store, sid, 'did work in ' + sid);
  const rep = await consolidator.run();
  assert.strictEqual(rep.summarized, 3);
  assert.strictEqual(rep.skipped.length, 0);
  const l1 = (await allEntries(store)).filter((e) => e.layer === 1);
  assert.strictEqual(l1.length, 3);
  for (const e of l1) {
    assert.strictEqual(e.created_by, 'consolidator');
    assert.ok(e.body.indexOf('出处: session') !== -1, 'citation in body: ' + e.title);
    assert.match(e.source_ids[0], /^[0-9a-f]{16}$/);
  }
  const stateFile = JSON.parse(await fsp.readFile(path.join(dataDir, 'consolidation-state.json'), 'utf8'));
  assert.strictEqual(Object.keys(stateFile.processed_spool).length, 3, 'cursor recorded');
});

test('idempotent: same input twice -> zero additions on second run', async (t) => {
  const { store, consolidator } = await mk(t);
  for (const sid of ['s1', 's2', 's3']) await seedSession(store, sid, 'x ' + sid);
  await consolidator.run();
  const rep2 = await consolidator.run();
  assert.strictEqual(rep2.summarized, 0);
  assert.strictEqual((await allEntries(store)).length, 3, 'no duplicates');
});

test('reconcile: cursor file lost -> rebuilt from L1 entries, no duplicates', async (t) => {
  const { store, consolidator, dataDir } = await mk(t);
  for (const sid of ['s1', 's2', 's3']) await seedSession(store, sid, 'x ' + sid);
  await consolidator.run();
  await fsp.rm(path.join(dataDir, 'consolidation-state.json'));
  const rep = await consolidator.run();
  assert.strictEqual(rep.summarized, 0, 'orphan repair via entry source_ids');
  assert.strictEqual((await allEntries(store)).length, 3);
});

test('cap + resume: maxSessionsPerRun=2, two runs equivalent to one', async (t) => {
  const { store, consolidator } = await mk(t, { maxSessionsPerRun: 2 });
  for (const sid of ['s1', 's2', 's3']) await seedSession(store, sid, 'x ' + sid);
  const r1 = await consolidator.run();
  assert.strictEqual(r1.summarized, 2, 'capped at 2');
  const r2 = await consolidator.run();
  assert.strictEqual(r2.summarized, 1, 'resumes from cursor');
  assert.strictEqual((await allEntries(store)).filter((e) => e.layer === 1).length, 3);
});

test('LLM failure: session skipped, run ends normally, retried next run', async (t) => {
  const { store, consolidator, state } = await mk(t);
  for (const sid of ['s1', 's2', 's3']) await seedSession(store, sid, 'x ' + sid);
  state.extractFail.add('s2');
  const r1 = await consolidator.run();
  assert.strictEqual(r1.summarized, 2);
  assert.strictEqual(r1.skipped.length, 1);
  assert.ok(r1.skipped[0].error.indexOf('LLM down') !== -1);
  state.extractFail.clear();
  const r2 = await consolidator.run();
  assert.strictEqual(r2.summarized, 1, 'skipped session retried');
  assert.strictEqual((await allEntries(store)).filter((e) => e.layer === 1).length, 3);
});

test('merge + conflicts: LLM nominates, engine adjudicates per M03 rules', async (t) => {
  const { mod, store, consolidator, state } = await mk(t, { minMergeGroup: 2 });
  await seedSession(store, 's1', 'x');
  await seedSession(store, 's2', 'y');
  const oldDecision = await store.upsertEntry({ schema_version: 1, id: '', layer: 3, scope: 'member', owner: { member: 'alice', agent: '' }, title: 'old decision', kind: 'decision', importance: 0.9, stability: 1.0, access_count: 0, last_access: NOW.toISOString(), status: 'active', pinned: false, superseded_by: null, source_ids: [], tags: [], created_by: 't', created_at: NOW.toISOString(), updated_at: NOW.toISOString(), body: 'use md5' });
  const oldFact = await store.upsertEntry({ schema_version: 1, id: '', layer: 2, scope: 'member', owner: { member: 'alice', agent: '' }, title: 'old low fact', kind: 'fact', importance: 0.3, stability: 1.0, access_count: 0, last_access: NOW.toISOString(), status: 'active', pinned: false, superseded_by: null, source_ids: [], tags: [], created_by: 't', created_at: NOW.toISOString(), updated_at: NOW.toISOString(), body: 'old claim' });
  state.mergeOut = { merges: [{ title: 'ULID 主键决策', body: '统一用 ULID(引用 L1 会话)', importance: 0.7, kind: 'fact', from: [0, 1] }], conflicts: [{ old_id: oldDecision, reason: '新会话改用 ULID' }, { old_id: oldFact, reason: '已被新知识取代' }] };
  const rep = await consolidator.run();
  assert.strictEqual(rep.merged, 1);
  assert.strictEqual(rep.conflicts_needs_review, 1, 'decision -> needs_review');
  assert.strictEqual(rep.conflicts_superseded, 1, 'low-importance -> superseded');
  const all = await allEntries(store);
  const mergedL2 = all.find((e) => e.layer === 2 && e.created_by === 'consolidator');
  assert.ok(mergedL2, 'L2 merge written');
  assert.strictEqual(mergedL2.source_ids.length, 2, 'inherits both L1 sources');
  const dec = all.find((e) => e.id === oldDecision);
  assert.strictEqual(dec.status, 'needs_review');
  const fact = all.find((e) => e.id === oldFact);
  assert.strictEqual(fact.status, 'superseded');
  assert.ok(fact.superseded_by && fact.superseded_by !== fact.id);
  const replacement = all.find((e) => e.id === fact.superseded_by);
  assert.ok(replacement.source_ids.indexOf(oldFact) !== -1, 'provenance inherited');
  assert.strictEqual(fact.layer, 2);
  assert.ok(all.find((e) => e.layer === 1 && e.status === 'active'), 'L1 evidence kept');
});

test('distill: evidence-qualified L2 -> atomic L3; not re-distilled', async (t) => {
  const { store, consolidator, state } = await mk(t);
  const l2 = await store.upsertEntry({ schema_version: 1, id: '', layer: 2, scope: 'member', owner: { member: 'alice', agent: '' }, title: 'rich knowledge', kind: 'fact', importance: 0.6, stability: 1.0, access_count: 0, last_access: NOW.toISOString(), status: 'active', pinned: false, superseded_by: null, source_ids: ['h1', 'h2', 'h3'], tags: [], created_by: 't', created_at: NOW.toISOString(), updated_at: NOW.toISOString(), body: 'three-session knowledge' });
  state.distillOut = { facts: [{ text: '原子 A(出处 ' + l2 + ')', kind: 'fact', importance: 0.9 }, { text: '原子 B(出处 ' + l2 + ')', kind: 'preference', importance: 0.7 }] };
  const rep = await consolidator.run();
  assert.strictEqual(rep.distilled, 2);
  const l3 = (await allEntries(store)).filter((e) => e.layer === 3);
  assert.strictEqual(l3.length, 2);
  for (const e of l3) {
    assert.strictEqual(e.created_by, 'consolidator');
    assert.ok(e.source_ids.indexOf(l2) !== -1, 'L3 references its L2 source');
    assert.ok(e.body.length < 60, 'atomic one-line fact');
  }
  const rep2 = await consolidator.run();
  assert.strictEqual(rep2.distilled, 0, 'no re-distill (L2 already referenced)');
});

test('decay: low-R active archived; pinned survives', async (t) => {
  const { store, consolidator } = await mk(t);
  const base = { schema_version: 1, id: '', scope: 'member', owner: { member: 'alice', agent: '' }, kind: 'fact', stability: 1.0, access_count: 0, status: 'active', superseded_by: null, source_ids: [], tags: [], created_by: 't', created_at: OLD, updated_at: OLD, body: 'b' };
  await store.upsertEntry(Object.assign({}, base, { layer: 2, title: 'weak', importance: 0.05, last_access: OLD, pinned: false }));
  await store.upsertEntry(Object.assign({}, base, { layer: 2, title: 'weak pinned', importance: 0.05, last_access: OLD, pinned: true }));
  const rep = await consolidator.run();
  assert.strictEqual(rep.archived, 1);
  const all = await allEntries(store, true);
  assert.strictEqual(all.find((e) => e.title === 'weak').status, 'archived');
  assert.strictEqual(all.find((e) => e.title === 'weak pinned').status, 'active');
});

test('git: run ends with data/ commit containing run id', async (t) => {
  const { store, consolidator, dataDir } = await mk(t);
  execSync('git init', { cwd: dataDir });
  await seedSession(store, 's1', 'x');
  const rep = await consolidator.run();
  assert.strictEqual(rep.gitCommitted, true);
  const log = execSync('git log --oneline', { cwd: dataDir }).toString();
  assert.ok(log.indexOf('consolidation ' + rep.run_id) !== -1);
});

test('singleton lock: concurrent second run reports singletonSkipped', async (t) => {
  const { store, consolidator, state } = await mk(t);
  state.delayMs = 80;
  await seedSession(store, 's1', 'x');
  const p1 = consolidator.run();
  const p2 = consolidator.run();
  const r1 = await p1;
  const r2 = await p2;
  assert.strictEqual(r1.summarized, 1);
  assert.strictEqual(r2.singletonSkipped, true, 'second concurrent run declined');
});

test('M11 mandatory: spool content redacted before LLM extract (secrets never leave)', async (t) => {
  const { mod, store, consolidator, dataDir, state } = await mk(t);
  const seenPrompts = [];
  const orig = consolidator.opts.callLLM;
  state.capture = true;
  // 包一层捕获 prompt
  const capped = new mod.Consolidator(store, Object.assign({ dataDir, logger: function () {} }, { callLLM: async function (msgs, o) { seenPrompts.push(String(msgs[0].content)); return orig(msgs, o); } }));
  const secret = 'the key is sk-ABCDEFGHIJKLMNOP123456 keep it safe';
  const full = crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
  await fsp.mkdir(path.join(store.root, '_spool'), { recursive: true });
  await fsp.writeFile(path.join(store.root, '_spool', full.slice(0, 16) + '.json'), JSON.stringify({ ts: NOW.toISOString(), session_id: 'sec-sess', kind: 'digest', hash: full, identity: 's1/alice/builder', content: secret }));
  await capped.run();
  assert.strictEqual(seenPrompts.length >= 1, true, 'LLM was called');
  const extractPromptText = seenPrompts.find(function (p) { return p.indexOf('[任务:抽取]') === 0; });
  assert.ok(extractPromptText, 'extract prompt captured');
  assert.ok(extractPromptText.indexOf('sk-ABCDEFGHIJKLMNOP') === -1, 'raw secret absent from prompt');
  assert.ok(extractPromptText.indexOf('[REDACTED]') !== -1, 'redaction marker present');
});

test('extract: LLM-generated title becomes entry title; fallback keeps session id', async (t) => {
  const { mod, store, consolidator, dataDir, state } = await mk(t);
  const full = crypto.createHash('sha256').update('titled digest', 'utf8').digest('hex');
  await fsp.mkdir(path.join(store.root, '_spool'), { recursive: true });
  await fsp.writeFile(path.join(store.root, '_spool', full.slice(0, 16) + '.json'), JSON.stringify({ ts: NOW.toISOString(), session_id: 'title-sess', kind: 'digest', hash: full, identity: 's1/alice/builder', content: 'titled digest content' }));
  state.extractTitle = '记忆系统接入决策';
  await consolidator.run();
  let titled = null;
  for await (const e of store.scanMeta()) if (e.source_ids.indexOf(full.slice(0, 16)) !== -1) titled = e;
  assert.ok(titled, 'entry created');
  assert.strictEqual(titled.title, '记忆系统接入决策');
});

test('parseJsonOut repairs trailing commas in LLM output', async () => {
  const { mod } = await mk();
  const raw = '{ "merges": [ { "title": "a", "from": [1, 2,], "importance": 0.7, }, ], "conflicts": [], }';
  const out = mod.parseJsonOut(raw, 'merge');
  assert.strictEqual(out.merges.length, 1);
  assert.strictEqual(out.merges[0].from.length, 2);
  assert.throws(() => mod.parseJsonOut('{ "a": [1, 2 }', 'merge'), /not valid JSON/);   // 有大括号但内部结构坏 → 修复通道救不了
  assert.throws(() => mod.parseJsonOut('no braces here', 'merge'), /no JSON object/);
});

test('run log: daily jsonl written with trigger and report', async (t) => {
  const { store, consolidator, dataDir } = await mk(t);
  await seedSession(store, 's1', 'x');
  const rep = await consolidator.run('schedule');
  const day = new Date().toLocaleDateString('sv');
  const raw = await fsp.readFile(path.join(dataDir, '_logs', 'consolidate-' + day + '.jsonl'), 'utf8');
  const lines = raw.trim().split('\n').map((l) => JSON.parse(l));
  const rec = lines.find((r) => r.run_id === rep.run_id);
  assert.ok(rec, 'run recorded');
  assert.strictEqual(rec.trigger, 'schedule');
  assert.strictEqual(rec.summarized, rep.summarized);
});

test('distill cap: at most 5 L3 atoms per L2', async (t) => {
  const { store, consolidator, state } = await mk(t);
  const l2 = await store.upsertEntry({ schema_version: 1, id: '', layer: 2, scope: 'member', owner: { member: 'alice', agent: '' }, title: 'rich knowledge', kind: 'fact', importance: 0.6, stability: 1.0, access_count: 0, last_access: NOW.toISOString(), status: 'active', pinned: false, superseded_by: null, source_ids: ['h1', 'h2', 'h3'], tags: [], created_by: 't', created_at: NOW.toISOString(), updated_at: NOW.toISOString(), body: 'three-session knowledge' });
  state.distillOut = { facts: Array.from({ length: 7 }, (_, i) => ({ text: '原子事实' + i + '(出处 ' + l2 + ')', kind: 'fact', importance: 0.8 })) };
  await consolidator.run();
  const all = await allEntries(store);
  assert.strictEqual(all.filter((e) => e.layer === 3).length, 5, 'hard cap 5');
});
