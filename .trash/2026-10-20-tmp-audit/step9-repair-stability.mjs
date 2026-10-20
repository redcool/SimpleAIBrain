import fs from 'node:fs/promises';
const mod = await import('../dist/index.js');
const store = new mod.FileStore('data/memory');
await store.init();
const all = await Array.fromAsync(store.iterateByScope({ includeArchived: true }));
let restored = 0, migrated = 0;
for (const e of all) {
  const target = e.layer === 1 ? 72 : e.layer === 2 ? 720 : 8760;
  const patch = { stability: target };
  if (e.status === 'archived') { patch.status = 'active'; restored++; }
  await store.patchMeta(e.id, patch);
  migrated++;
}
console.log('migrated:', migrated, 'restored:', restored);
