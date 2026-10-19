'use strict';
// M07 identity & permission acceptance tests (M07 section 5). Run: npm test
const { test } = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const TMP = path.join(__dirname, '..', 'tmp');

async function mk(t) {
  const dir = await fsp.mkdtemp(path.join(TMP, 'm07-'));
  const mod = await import('../dist/index.js');
  const reg = new mod.TokenRegistry(path.join(dir, 'tokens.json'));
  await reg.load();
  if (t && t.after) t.after(async () => { await fsp.rm(dir, { recursive: true, force: true }); });
  return { dir, mod, reg };
}

test('same token resolves to same id; rotate keeps id, kills old token', async (t) => {
  const { mod, reg, dir } = await mk(t);
  const id = mod.makeIdentity('studio1', 'alice', 'builder@claude-code');
  const tok = await reg.issue(id);
  const a = reg.resolve(tok);
  const b = reg.resolve(tok);
  assert.deepStrictEqual(a, b, 'same token -> same identity');
  assert.strictEqual(mod.identityToString(a), 'studio1/alice/builder@claude-code');
  const tok2 = await reg.rotate(id);
  assert.notStrictEqual(tok2, tok);
  assert.strictEqual(reg.resolve(tok), null, 'old token dead');
  assert.strictEqual(mod.identityToString(reg.resolve(tok2)), 'studio1/alice/builder@claude-code', 'id unchanged');
  // persistence: fresh registry over same file still resolves, plaintext never stored
  const reg2 = new mod.TokenRegistry(path.join(dir, 'tokens.json'));
  await reg2.load();
  assert.strictEqual(mod.identityToString(reg2.resolve(tok2)), 'studio1/alice/builder@claude-code');
  const raw = await fsp.readFile(path.join(dir, 'tokens.json'), 'utf8');
  assert.ok(!raw.includes(tok2), 'plaintext token not persisted');
  assert.ok(raw.includes(crypto.createHash('sha256').update(tok2).digest('hex')), 'hash persisted');
});

test('concat-string attack: id string is not a token; tokens unique per issue', async (t) => {
  const { mod, reg } = await mk(t);
  const id = mod.makeIdentity('studio1', 'alice', 'builder');
  await reg.issue(id);
  assert.strictEqual(reg.resolve('studio1/alice/builder'), null, 'id string does not resolve');
  assert.strictEqual(reg.resolve(''), null);
  assert.strictEqual(reg.resolve(undefined), null, 'missing token = guest');
  const t1 = await reg.issue(id);
  const t2 = await reg.issue(id);
  assert.notStrictEqual(t1, t2, 'random 32-byte, not derived from fields');
  assert.strictEqual(reg.resolve('studio1' + '/' + 'alice' + '/' + 'builder'.repeat(4)), null);
});

test('guest: search/context allowed; save/stats/edit denied', async (t) => {
  const { mod } = await mk(t);
  const role = mod.roleOf(null);
  assert.strictEqual(role, 'guest');
  assert.ok(mod.canInvoke(role, 'memory.search'));
  assert.ok(mod.canInvoke(role, 'memory.context'));
  for (const tool of ['memory.save', 'memory.stats', 'memory.edit', 'memory.submit_session']) {
    assert.ok(!mod.canInvoke(role, tool), tool + ' denied for guest');
    assert.throws(() => mod.assertCanInvoke(role, tool), /read-only guest/);
  }
  assert.ok(mod.canInvoke(role, 'memory.whoami'), 'whoami allowed for guest (M08 section 2 ruling)');
});

test('agent token: edit/review_list denied with member-token hint; save ok', async (t) => {
  const { mod } = await mk(t);
  const role = mod.roleOf(mod.makeIdentity('s', 'alice', 'builder'));
  assert.strictEqual(role, 'agent');
  assert.ok(mod.canInvoke(role, 'memory.save'));
  assert.ok(mod.canInvoke(role, 'memory.submit_session'));
  assert.ok(!mod.canInvoke(role, 'memory.edit'));
  assert.throws(() => mod.assertCanInvoke(role, 'memory.edit'), /member token/, 'explicit hint per acceptance');
  assert.throws(() => mod.assertCanInvoke(role, 'memory.review_list'), /member token/);
});

test('member token (empty agent_label): full access', async (t) => {
  const { mod } = await mk(t);
  const role = mod.roleOf(mod.makeIdentity('s', 'alice', ''));
  assert.strictEqual(role, 'member');
  for (const tool of mod.MEMORY_TOOLS) assert.ok(mod.canInvoke(role, tool), tool);
});

test('.brain.json: invalid fields error with suggestion; valid parses', async (t) => {
  const { mod, dir } = await mk(t);
  const file = path.join(dir, '.brain.json');
  await fsp.writeFile(file, JSON.stringify({ studio: 'Studio1', member: 'a lice', agent_label: 'Builder', token: 'x'.repeat(40) }));
  await assert.rejects(() => mod.readBrainJson(file), (e) => {
    assert.ok(/suggested: /.test(e.message), 'carries normalization suggestion');
    return true;
  });
  await fsp.writeFile(file, JSON.stringify({ studio: 'studio1', member: 'alice', agent_label: 'builder@claude-code', token: 't'.repeat(43) }));
  const bj = await mod.readBrainJson(file);
  assert.strictEqual(mod.identityToString(bj.identity), 'studio1/alice/builder@claude-code');
  assert.strictEqual(bj.token, 't'.repeat(43));
  await fsp.writeFile(file, JSON.stringify({ studio: 'studio1', member: 'alice' }));
  await assert.rejects(() => mod.readBrainJson(file), /token missing/);
  await fsp.writeFile(file, '{ broken');
  await assert.rejects(() => mod.readBrainJson(file), /unreadable/);
});

test('revoke: mapping removed, memory ownership untouched (id unchanged)', async (t) => {
  const { mod, reg } = await mk(t);
  const id = mod.makeIdentity('s', 'alice', 'b');
  const tok = await reg.issue(id);
  assert.ok(await reg.revoke(id));
  assert.strictEqual(reg.resolve(tok), null);
  assert.ok(!(await reg.revoke(id)), 'second revoke false');
  assert.strictEqual(mod.identityToString(id), 's/alice/b', 'id object unchanged by revoke');
});

test('registry hot-reload: token enrolled by another process is recognized without reload call', async (t) => {
  const { mod, reg, dir } = await mk(t);
  const reg2 = new mod.TokenRegistry(path.join(dir, 'tokens.json'));
  await reg2.load();   // 模拟另一个进程(enroll):它自己 load,然后签发
  const idB = mod.makeIdentity('studio1', 'alice', 'soundgenprj');
  const tokB = await reg2.issue(idB);
  // reg1 从未重新 load——按 mtime 热加载后应能认出
  const got = reg.resolve(tokB);
  assert.ok(got, 'hot-reloaded registry recognizes new token');
  assert.strictEqual(mod.identityToString(got), 'studio1/alice/soundgenprj');
  assert.strictEqual(reg.resolve('bogus-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), null, 'wrong token still null');
});
