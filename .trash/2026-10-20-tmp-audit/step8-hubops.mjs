import fs from 'node:fs/promises';
const bj = JSON.parse(await fs.readFile('H:/ai_works/SimpleAIBrain/.brain.json', 'utf8'));
const digest = [
  'SimpleMcpServer(hub)操作要点,出处: session-b2fe0496 系列(D14-D17):',
  '1) 端口 45678;agent 直连入口 POST /rpc(JSON-RPC tools/call);MCP 走 /sse、/mcp-stream;/brain/health 查 brain 插件健康,/health 查 hub 全局。',
  '2) 重启流程:杀 45678 监听进程 → 等端口释放 → 在 H:/ai_works/SimpleMcpServer 启动 node dist/index.js;重启后必须核对新 banner 时间戳,否则可能在跟旧进程说话;需要实时观测时用可见 cmd 窗口(不重定向日志——日志进文件就看不到实时输出)。',
  '3) LLM 渠道链:config.json 的 llm 段,主渠道 + fallbacks(最多 3 条,按序回退);换信任的 LLM 只改配置;maxTokens 必须 ≥4096,1024 会截断巩固输出。web.search 挂了先重启 hub。',
  '4) 工作纪律在 docs/Agent工作纪律.md:短句、同一概念同名、同名文件加版本号不覆盖、临时文件进 tmp/、夜班(22:00-10:00)问题自决并记 夜班-日期.md、版本 x.y.z.w(z=大功能,w=小改)。AGENTS.md 是项目知识库,功能变更后必须更新并改"最后更新"。',
  '5) brain 插件由 config 的 aiBrain.path 加载,数据目录 SimpleAIBrain/data;插件加载失败=优雅降级(hub 照常跑,只是没有 memory.* 工具)。',
].join('\n');
const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory.submit_session', arguments: { session_id: 'session-b2fe0496-b231-4996-90b2-e7d45fa674cd', kind: 'digest', content: digest, _brainToken: bj.token } } };
const r = await fetch('http://127.0.0.1:45678/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const j = await r.json();
console.log('submit ->', String(j.result?.content?.[0]?.text ?? JSON.stringify(j.error ?? j)).slice(0, 200));
