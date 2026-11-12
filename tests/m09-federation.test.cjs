'use strict';
// M09 Tier2 federation acceptance tests. Run: npm test
const { test } = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const path = require('node:path');

const TMP = path.join(__dirname, '..', 'tmp');

async function mk(t, brainConfig) {
  const dir = await fsp.mkdtemp(path.join(TMP, 'm09-'));
  const mod = await import('../dist/index.js');
  const plugin = mod.createBrainPlugin();
  const routes = [];
  const ctx = {
    brainConfig: brainConfig || {},
    dataDir: path.join(dir, 'data'),
    logger: () => {},
    callLLM: async () => '',
    httpApp: { addRoute: (method, p, h) => routes.push({ method, p, h }) },
    serverVersion: 'test-hub',
  };
  await plugin.init(ctx);
  plugin.registerRoutes(ctx.httpApp);
  const agent = mod.makeIdentity('s1', 'alice', 'builder');
  const member = mod.makeIdentity('s1', 'alice', '');
  if (t && t.after) t.after(async () => { await plugin.shutdown(); await fsp.rm(dir, { recursive: true, force: true }); });
  return { dir, mod, plugin, routes, agent, member };
}

test('RemoteStore: write ops rejected with publish-flow hint (M09 §5-3)', async (t) => {
  const { mod } = await mk(t);
  const { RemoteStore } = await import('../dist/store/remote-store.js');
  const rs = new RemoteStore({ url: 'http://127.0.0.1:9', token: 'x' });
  await assert.rejects(() => rs.upsertEntry({ schema_version: 1, id: '', layer: 1, scope: 'studio', owner: { member: 'r', agent: '' }, title: 't', kind: 'fact', importance: 0.5, stability: 1, access_count: 0, last_access: '', status: 'active', pinned: false, superseded_by: null, source_ids: [], tags: [], created_by: '', created_at: '', updated_at: '', body: 'b' }), /联邦只读/);
  await assert.rejects(() => rs.appendLog({ ts: '', harness: 'x', tool: 't', args: {}, ok: true, ms: 1, transport: 'mcp' }), /联邦只读/);
});

test('/brain/query: bad token -> empty+denied (no existence leak); good token -> studio-only (M09 §5-1/2)', async (t) => {
  const { plugin, routes, agent, member } = await mk(t, { federation: { tokens: ['fed-secret-1'] } });
  const r1 = await plugin.callTool('memory.save', { content: '共识条目:统一歌词术语表', kind: 'decision', scope: 'studio' }, member);
  assert.strictEqual(r1.isError, false, 'member studio save ok');
  await plugin.callTool('memory.save', { content: '个人条目:不应跨库可见', kind: 'fact' }, agent);
  const q = routes.find((r) => r.p === '/brain/query');
  assert.ok(q, 'route registered');
  const bad = await q.h({ token: 'wrong', query: '' });
  assert.deepStrictEqual(bad, { results: [], policy: 'denied' });
  const notoken = await q.h({});
  assert.strictEqual(notoken.policy, 'denied');
  const good = await q.h({ token: 'fed-secret-1', query: '' });
  assert.strictEqual(good.policy, 'studio-only');
  assert.strictEqual(good.results.length, 1, 'only the studio entry');
  assert.ok(/统一歌词术语表/.test(good.results[0].title + good.results[0].body));
  const none = await q.h({ token: 'fed-secret-1', query: '不存在的词' });
  assert.strictEqual(none.results.length, 0);
});

test('publish flow: export -> import lands needs_review with import:* provenance; dedup on re-import; resolve activates (M09 §5-4)', async (t) => {
  const hub1 = await mk(t);
  const r1 = await hub1.plugin.callTool('memory.save', { content: '共识:发布流程走 bundle+人工确认', kind: 'decision', scope: 'studio' }, hub1.member);
  assert.strictEqual(r1.isError, false);
  await hub1.plugin.callTool('memory.save', { content: 'agent 私有条目甲', kind: 'fact' }, hub1.agent);
  // guest/agent 不能 export(member 独占)
  const deny = await hub1.plugin.callTool('memory.export', {}, hub1.agent);
  assert.ok(deny.isError && /member token/.test(deny.content.error), 'agent denied export');
  const exp = await hub1.plugin.callTool('memory.export', {}, hub1.member);
  assert.strictEqual(exp.isError, false);
  assert.strictEqual(exp.content.count, 2, 'both active entries exported');
  const file = exp.content.file;
  assert.ok(await fsp.access(file).then(() => true, () => false), 'bundle written');
  // hub2 导入
  const hub2 = await mk(t);
  const imp1 = await hub2.plugin.callTool('memory.import', { path: file }, hub2.member);
  assert.strictEqual(imp1.isError, false);
  assert.strictEqual(imp1.content.imported, 2);
  assert.strictEqual(imp1.content.skipped_exists, 0);
  const stats = await hub2.plugin.callTool('memory.stats', {}, hub2.member);
  assert.strictEqual(stats.content.status.needs_review, 2, 'imported entries pending review');
  // dedup:重复导入
  const imp2 = await hub2.plugin.callTool('memory.import', { path: file }, hub2.member);
  assert.strictEqual(imp2.content.imported, 0);
  assert.strictEqual(imp2.content.skipped_dup, 2, 'content-fingerprint dedup (import assigns fresh ids, so re-import matches by fp)');
  // member resolve 激活一条
  const one = imp1.content.ids[0];
  const res = await hub2.plugin.callTool('memory.review_list', { action: 'resolve', id: one, verdict: 'active' }, hub2.member);
  assert.strictEqual(res.isError, false);
  const after = await hub2.plugin.callTool('memory.stats', {}, hub2.member);
  assert.strictEqual(after.content.status.needs_review, 1);
  // created_by 可追溯
  const search = await hub2.plugin.callTool('memory.search', { query: '发布流程 bundle', limit: 10 }, hub2.member);
  assert.ok(search.content.results.some((x) => /import:/.test(x.created_by || '')), 'import provenance visible');
});

