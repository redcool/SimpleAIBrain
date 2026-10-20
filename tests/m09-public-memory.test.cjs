'use strict';
// M09 tier-1 public memory (0.0.15): consensus proposal -> member resolve -> studio prior -> supersede provenance
const { test } = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const path = require('node:path');

const TMP = path.join(__dirname, '..', 'tmp');

async function mk(t) {
  const dir = await fsp.mkdtemp(path.join(TMP, 'm09-'));
  const mod = await import('../dist/index.js');
  const store = new mod.FileStore(path.join(dir, 'memory'));
  await store.init();
  const agentA = mod.makeIdentity('s1', 'alice', 'builder');
  const agentB = mod.makeIdentity('s1', 'bob', 'helper');   // 不同 member:验证 studio 层跨成员可见
  const member = mod.makeIdentity('s1', 'alice', '');
  const mkCtx = (identity) => ({ identity, store });
  if (t && t.after) t.after(async () => { await fsp.rm(dir, { recursive: true, force: true }); });
  return { mod, store, mkCtx, agentA, agentB, member };
}
function ok(r) { if (r.isError) throw new Error('tool error: ' + JSON.stringify(r.content)); return r.content; }
async function byId(store, id) {
  for await (const e of store.iterateByScope({ includeArchived: true })) if (e.id === id) return e;
  return null;
}

test('agent studio save = consensus proposal (needs_review), invisible until resolved', async (t) => {
  const { mod, store, mkCtx, agentA } = await mk(t);
  const r = ok(await mod.callTool(mkCtx(agentA), 'memory.save', { content: '发布守则 V2:必须先跑完整测试再发布', kind: 'decision', scope: 'studio', tags: ['release'] }));
  assert.ok(/共识提案/.test(r.note), 'proposal wording');
  const e = await byId(store, r.id);
  assert.strictEqual(e.status, 'needs_review', 'proposal parked');
  assert.strictEqual(e.scope, 'studio');
  const rl = ok(await mod.callTool(mkCtx(agentA), 'memory.stats', {}));
  assert.ok(rl.status.needs_review >= 1, 'review counter sees proposal');
  const eng = await import('../dist/retrieval/engine.js');
  const out = await eng.rankCandidates(store, agentA, { query: 'release', now: new Date() });
  assert.strictEqual(out.ranked.length, 0, 'needs_review excluded from retrieval');
});

test('member resolve activates; studio entry wins prior and is visible across members', async (t) => {
  const { mod, store, mkCtx, agentA, agentB, member } = await mk(t);
  const old1 = ok(await mod.callTool(mkCtx(agentA), 'memory.save', { content: '守则旧版:直接发布也行', kind: 'decision', tags: ['release'] }));
  const prop = ok(await mod.callTool(mkCtx(agentA), 'memory.save', { content: '发布守则 V2:必须先跑完整测试再发布', kind: 'decision', scope: 'studio', tags: ['release'] }));
  const res = ok(await mod.callTool(mkCtx(member), 'memory.review_list', { action: 'resolve', id: prop.id, verdict: 'active' }));
  assert.strictEqual(res.status, 'active');
  assert.ok(Array.isArray(res.conflict_candidates) && res.conflict_candidates.some((c) => c.id === old1.id), 'conflict suggestion lists old entry');
  const eng = await import('../dist/retrieval/engine.js');
  const now = new Date();
  const forA = await eng.rankCandidates(store, agentA, { query: 'release', now });
  assert.strictEqual(forA.ranked[0].entry.scope, 'studio', 'studio prior wins over same-layer agent entry');
  const forB = await eng.rankCandidates(store, agentB, { query: 'release', now });
  assert.ok(forB.ranked.some((x) => x.entry.id === prop.id), 'studio entry visible to another member agent');
});

test('member supersede writes provenance superseded_by = consensus id', async (t) => {
  const { mod, store, mkCtx, agentA, member } = await mk(t);
  const old1 = ok(await mod.callTool(mkCtx(agentA), 'memory.save', { content: '守则旧版:直接发布也行', kind: 'decision', tags: ['release'] }));
  const dec = ok(await mod.callTool(mkCtx(member), 'memory.save', { content: '发布守则 V2:必须先跑完整测试再发布', kind: 'decision', scope: 'studio', tags: ['release'] }));
  const r = ok(await mod.callTool(mkCtx(member), 'memory.edit', { id: old1.id, action: 'supersede', ref: dec.id }));
  assert.strictEqual(r.status, 'superseded');
  assert.strictEqual(r.superseded_by, dec.id);
  const e = await byId(store, old1.id);
  assert.strictEqual(e.status, 'superseded', 'evidence preserved, marked superseded');
  assert.strictEqual(e.superseded_by, dec.id);
});

test('agents cannot resolve or supersede (member gate)', async (t) => {
  const { mod, store, mkCtx, agentA, member } = await mk(t);
  const dec = ok(await mod.callTool(mkCtx(member), 'memory.save', { content: '发布守则 V2', kind: 'decision', scope: 'studio', tags: ['release'] }));
  const r1 = await mod.callTool(mkCtx(agentA), 'memory.review_list', { action: 'resolve', id: dec.id, verdict: 'active' });
  assert.strictEqual(r1.isError, true);
  assert.ok(/member token/.test(JSON.stringify(r1.content)), 'agent resolve denied');
  const r2 = await mod.callTool(mkCtx(agentA), 'memory.edit', { id: dec.id, action: 'supersede', ref: dec.id });
  assert.strictEqual(r2.isError, true, 'agent supersede denied');
});

test('member direct studio save stays active (no review needed)', async (t) => {
  const { mod, store, mkCtx, member } = await mk(t);
  const r = ok(await mod.callTool(mkCtx(member), 'memory.save', { content: '发布守则 V1(会议定稿)', kind: 'decision', scope: 'studio', tags: ['release'] }));
  const e = await byId(store, r.id);
  assert.strictEqual(e.status, 'active', 'member credential commits directly');
  assert.strictEqual(e.scope, 'studio');
});
