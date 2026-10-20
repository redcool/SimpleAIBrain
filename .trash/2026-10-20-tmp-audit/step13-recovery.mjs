import fs from 'node:fs/promises';
import path from 'node:path';
const realMem = 'H:/ai_works/SimpleAIBrain/data/memory';
const copyRoot = 'H:/ai_works/SimpleAIBrain/tmp/drill-recovery';
const copyMem = path.join(copyRoot, 'memory');
await fs.rm(copyRoot, { recursive: true, force: true });
await fs.cp(realMem, copyMem, { recursive: true });
const mod = await import('../dist/index.js');
async function openStore() {
  const st = new mod.FileStore(copyMem);
  await st.init();
  return st;
}
let st = await openStore();
const before = await Array.fromAsync(st.iterateByScope({ includeArchived: true }));
console.log('baseline entries:', before.length);
// 破坏:删 1 个 L1 文件 + 弄坏 1 个 L2 文件
const l1 = before.find((e) => e.layer === 1);
const l2 = before.find((e) => e.layer === 2);
const l1file = before.find((e) => e.layer === 1);
// 找真实文件路径:L1 目录下按标题前缀
const l1dir = path.join(copyMem, 'members', 'local', 'agents', 'simpleaibrain', 'L1');
const l2dir = path.join(copyMem, 'members', 'local', 'L2');
const l1files = (await fs.readdir(l1dir)).filter((f) => f.endsWith('.md'));
const l2files = (await fs.readdir(l2dir)).filter((f) => f.endsWith('.md'));
const victim = l1files[0];
await fs.rm(path.join(l1dir, victim));
await fs.writeFile(path.join(l2dir, l2files[0]), '<<<corrupted: not valid frontmatter {{{', 'utf8');
console.log('sabotage: deleted', victim, '| corrupted', l2files[0]);
// 重新打开:目录即地址,init 重扫描
let crashed = false;
try {
  st = await openStore();
  const after = await Array.fromAsync(st.iterateByScope({ includeArchived: true }));
  console.log('after sabotage init: entries =', after.length, '(corrupt file visible?', after.some((e) => e.id && after.indexOf(e) >= 0), ')');
  console.log('deleted entry gone:', !after.some((e) => e.title === (l1file || victim) || true));
} catch (e) {
  crashed = true;
  console.log('INIT CRASHED on corrupt file:', e.message.slice(0, 120));
}
// 恢复:从"备份"(原始真库)拷回被删文件与完好版被损坏文件
const realL1dir = path.join(realMem, 'members', 'local', 'agents', 'simpleaibrain', 'L1');
const realL2dir = path.join(realMem, 'members', 'local', 'L2');
await fs.cp(path.join(realL1dir, victim), path.join(l1dir, victim));
await fs.cp(path.join(realL2dir, l2files[0]), path.join(l2dir, l2files[0]));
st = await openStore();
const restored = await Array.fromAsync(st.iterateByScope({ includeArchived: true }));
console.log('after restore: entries =', restored.length, '(baseline', before.length + ')');
