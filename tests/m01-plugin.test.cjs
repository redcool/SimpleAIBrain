'use strict';
// M01 plugin contract acceptance tests (M01 section 6, brain side). Run: npm test
const { test } = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const path = require('node:path');

const TMP = path.join(__dirname, '..', 'tmp');
const NOW = new Date('2026-10-14T12:00:00Z');

async function mk(t, brainConfig) {
  const dir = await fsp.mkdtemp(path.join(TMP, 'm01-'));
  const mod = await import('../dist/index.js');
  const plugin = mod.createBrainPlugin();
  const logs = [];
  const routes = [];
  const ctx = {
    brainConfig: brainConfig || {},
    dataDir: path.join(dir, 'data'),
    logger: (m) => logs.push(m),
    callLLM: async () => '',
    httpApp: { addRoute: (method, p, h) => routes.push({ method, p, h }) },
    serverVersion: 'test-hub',
  };
  await plugin.init(ctx);
  const identity = mod.makeIdentity('s1', 'alice', 'builder');
  if (t && t.after) t.after(async () => { await plugin.shutdown(); await fsp.rm(dir, { recursive: true, force: true }); });
  return { dir, mod, plugin, logs, routes, identity, ctx };
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 60));

test('contract: version 1, name ai-brain, exactly 8 memory.* tools', async (t) => {
  const { mod, plugin } = await mk(t);
  assert.strictEqual(plugin.contractVersion, 1);
  assert.strictEqual(plugin.name, 'ai-brain');
  const tools = plugin.getTools();
  assert.strictEqual(tools.length, 8);
  for (const td of tools) {
    assert.ok(td.name.startsWith('memory.'), td.name);
    assert.ok(typeof td.description === 'string' && td.description.length > 0);
    assert.ok(td.inputSchema && td.inputSchema.type === 'object');
  }
  assert.strictEqual(mod.VERSION, '0.0.8');
});

test('init + callTool: save routed with identity; guest gating via null identity', async (t) => {
  const { mod, plugin, logs, identity } = await mk(t);
  assert.ok(logs.some((m) => m.indexOf('[ai-brain] ready') === 0), 'ready log line: ' + logs.join(' | '));
  const ok = await plugin.callTool('memory.save', { content: 'c1', kind: 'fact' }, identity);
  assert.strictEqual(ok.isError, false);
  const denied = await plugin.callTool('memory.save', { content: 'c2', kind: 'fact' }, null);
  assert.strictEqual(denied.isError, true);
  assert.ok(/read-only guest/.test(denied.content.error), 'guest denial readable');
  const unknown = await plugin.callTool('memory.nope', {}, identity);
  assert.ok(unknown.isError && /unknown tool/.test(unknown.content.error));
});

test('onToolEvent: matched tools logged to L0; memory.* and unmatched excluded', async (t) => {
  const { mod, plugin, identity, dir } = await mk(t);
  plugin.onToolEvent({ tool: 'blender.body.build', args: { preset: 'dog' }, ok: true, ms: 12, transport: 'mcp', identity });
  plugin.onToolEvent({ tool: 'memory.save', args: { content: 'self' }, ok: true, ms: 3, transport: 'mcp', identity });
  plugin.onToolEvent({ tool: 'fs.read', args: {}, ok: true, ms: 1, transport: 'rpc', identity: null });
  plugin.onToolEvent(null);
  await tick();
  const memDir = path.join(dir, 'data', 'memory');
  const files = await fsp.readdir(path.join(memDir, 'L0-log', '2026-10'));
  assert.strictEqual(files.length, 1, 'only matching tool logged');
  const text = await fsp.readFile(path.join(memDir, 'L0-log', '2026-10', files[0]), 'utf8');
  assert.ok(text.indexOf('blender.body.build') !== -1);
  assert.strictEqual(text.trim().split('\n').length, 1, 'memory.* and fs.read excluded');
});

test('onToolEvent: global switch off; truncation; secret redaction', async (t) => {
  const { mod, plugin, identity, dir } = await mk(t, { passiveLog: { enabled: false } });
  plugin.onToolEvent({ tool: 'blender.body.build', args: {}, ok: true, ms: 1, transport: 'mcp', identity });
  await tick();
  let exists = true;
  try { await fsp.access(path.join(dir, 'data', 'memory', 'L0-log')); } catch (e) { exists = false; }
  assert.strictEqual(exists, false, 'switch off -> nothing logged');
});

test('onToolEvent: oversized args truncated; secret keys redacted', async (t) => {
  const { mod, plugin, identity, dir } = await mk(t, { passiveLog: { tools: ['big.*', 'auth.*'], maxParamChars: 200 } });
  plugin.onToolEvent({ tool: 'big.op', args: { blob: 'x'.repeat(5000) }, ok: true, ms: 1, transport: 'mcp', identity });
  plugin.onToolEvent({ tool: 'auth.call', args: { token: 'sekret-value', q: 'fine' }, ok: true, ms: 1, transport: 'rpc', identity });
  await tick();
  const d = path.join(dir, 'data', 'memory', 'L0-log', '2026-10');
  const files = await fsp.readdir(d);
  const text = await fsp.readFile(path.join(d, files[0]), 'utf8');
  assert.ok(text.indexOf('(truncated)') !== -1, 'truncated marker present');
  assert.ok(text.indexOf('sekret-value') === -1, 'secret redacted');
  assert.ok(text.indexOf('[REDACTED]') !== -1);
});

test('registerRoutes: /brain/health reports entries; shutdown flushes reinforcement', async (t) => {
  const { mod, plugin, routes, identity, ctx } = await mk(t);
  plugin.registerRoutes(ctx.httpApp);
  assert.strictEqual(routes.length, 2, 'health + consolidate (M05)');
  assert.strictEqual(routes[0].p, '/brain/health');
  assert.strictEqual(routes[1].p, '/brain/consolidate');
  const health = await routes[0].h({});
  assert.strictEqual(health.ok, true);
  assert.strictEqual(health.entries, 0);
  const saved = await plugin.callTool('memory.save', { content: 'fbx note', kind: 'fact' }, identity);
  assert.strictEqual(saved.isError, false);
  const health2 = await routes[0].h({});
  assert.strictEqual(health2.entries, 1, 'health reports live entry count');
  const cr = await plugin.callTool('memory.context', { query: 'fbx' }, identity);
  assert.strictEqual(cr.isError, false, 'context via plugin works');
  await plugin.shutdown();
  const store2 = new mod.FileStore(path.join(ctx.dataDir, 'memory'));
  await store2.init();
  const meta = (await Array.fromAsync(store2.iterateByScope({})))[0];
  assert.strictEqual(meta.access_count, 1, 'shutdown flushed pending reinforcement to disk');
});
test('resolveIdentity: issued token resolves to identity; bad token null', async (t) => {
  const { mod, plugin, ctx } = await mk(t);
  const regPath = path.join(ctx.dataDir, 'memory', '_identity', 'tokens.json');
  const reg = new mod.TokenRegistry(regPath);
  await reg.load();
  const tok = await reg.issue(mod.makeIdentity('s1', 'alice', 'builder'));
  const plugin2 = mod.createBrainPlugin();
  await plugin2.init(ctx);            // fresh load picks up tokens.json from disk
  const resolved = plugin2.resolveIdentity(tok);
  assert.ok(resolved, 'token resolves');
  assert.strictEqual(resolved.member, 'alice');
  assert.strictEqual(resolved.agent_label, 'builder');
  assert.strictEqual(plugin2.resolveIdentity('not-a-real-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa'), null, 'unknown token -> null (guest)');
  await plugin2.shutdown();
});
