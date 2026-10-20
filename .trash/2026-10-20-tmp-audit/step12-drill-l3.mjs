import fs from 'node:fs/promises';
import path from 'node:path';
// 读 hub 配置拿 agnes 通道(只在进程内,不打印 key)
const cfg = JSON.parse(await fs.readFile('H:/ai_works/SimpleMcpServer/config.json', 'utf8'));
const LLM = cfg.llm;
const callLLM = async (messages) => {
  const r = await fetch(LLM.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + LLM.apiKey },
    body: JSON.stringify({ model: LLM.model, messages, temperature: 0.7, max_tokens: 4096 }),
  });
  const j = await r.json();
  const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!c) throw new Error('LLM no content: ' + JSON.stringify(j).slice(0, 200));
  return c;
};
const mod = await import('../dist/index.js');
const dataDir = 'H:/ai_works/SimpleAIBrain/tmp/drill-l3-data';
await fs.rm(dataDir, { recursive: true, force: true });
const store = new mod.FileStore(path.join(dataDir, 'memory'));
await store.init();
const crypto = await import('node:crypto');
const NOW = new Date().toISOString();
async function seed(sid, content) {
  const full = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  await fs.mkdir(path.join(store.root, '_spool'), { recursive: true });
  await fs.writeFile(path.join(store.root, '_spool', full.slice(0, 16) + '.json'), JSON.stringify({ ts: NOW, session_id: sid, kind: 'digest', hash: full, identity: 's1/local/drillagent', content }));
}
const theme = (v) => '【演练数据,非生产】SimpleAIBrain 发布守则(版本' + v + '):发布前必须跑满 90 项测试;主版本号只在跨模块行为变更时递增;docs 主表与 modules 必须同 commit 更新;tmp 目录不入库;发布后 24 小时内观察 hub 日志一次。出处:演练会话 ' + v;
await seed('drill-s1', theme('v1,细节:构建命令 npm run build;测试 node --test;发布标签打在 main 分支'));
await seed('drill-s2', theme('v2,细节:回滚流程是 git revert 后重新构建;公告写进 AGENTS.md 最后更新行'));
await seed('drill-s3', theme('v3,细节:发布检查清单由 M03 主表生成;健康检查端点是 /brain/health'));
const consolidator = new mod.Consolidator(store, { dataDir, callLLM, logger: function () {}, minMergeGroup: 3 });
const r1 = await consolidator.run();
console.log('run1:', JSON.stringify(r1));
const r2 = await consolidator.run();
console.log('run2:', JSON.stringify(r2));
const r3 = await consolidator.run();
console.log('run3:', JSON.stringify(r3));
const all = await Array.fromAsync(store.iterateByScope({ includeArchived: true }));
const l3 = all.filter((e) => e.layer === 3);
console.log('layers:', all.map((e) => 'L' + e.layer).join(','));
for (const e of l3) console.log('L3[' + e.status + ' imp=' + e.importance + ']: ' + e.title + ' | ' + e.body.slice(0, 80).replace(/\n/g, ' '));
