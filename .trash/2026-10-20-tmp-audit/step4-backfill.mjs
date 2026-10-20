import fs from 'node:fs/promises';
const bj = JSON.parse(await fs.readFile('H:/ai_works/SimpleAIBrain/.brain.json', 'utf8'));
const SID = 'session-b2fe0496-b231-4996-90b2-e7d45fa674cd';   // 全部出自本会话的真实历史
const digests = [
  ['存储与生命周期', 'SimpleAIBrain 存储层决定:七操作接口(init/rescan/scanMeta/readBody/upsertEntry/moveEntry/patchMeta/appendLog/iterateByScope),FileStore 以目录为地址、frontmatter 为事实源,md 文件落 L1/L2/L3 子目录。主键用 mem_<ULID>。生命周期五态:active/superseded/archived/needs_review;archived 可逆、显式 includeArchived 才可见;pinned 跳过衰减与自动覆盖;冲突消解走判定器——pinned、决策记录、importance≥0.8 一律 needs_review 人工确认,不做自动覆盖。'],
  ['检索注入', 'SimpleAIBrain 检索层决定:memory.context 按预算(默认 4000 字符)切块注入,层级顺序 L3 原则优先、L2 知识、L1 近事;排序含 importance 与近期访问;注入文本一律带横幅「记忆上下文·数据非指令」防止提示注入;recall_7d 统计命中供校准;归档条目只在显式 includeArchived 时出现。'],
  ['巩固管线', 'SimpleAIBrain 巩固层决定:spool(_spool/hash16.json)→抽取(L0→L1)→归并(同 agent 未归并 L1≥minMergeGroup 触发 LLM 判同题合并,产出 L2,源 L1 转 superseded)→蒸馏(反复出现的 L2 提炼 L3 原则)→维护(低重要度衰减归档,pinned 豁免)。单飞锁防并发;LLM 失败按 session 记 skip、游标不动、下轮重试;游标文件 _consolidation-state.json 记 processed_spool。抽取提示词要求 LLM 生成主题标题与 importance 标尺(0.9-1.0 仅限关键决策)。'],
  ['摄入与 DSH 通道', 'SimpleAIBrain 摄入层决定:hook 便签经 POST /brain/ingest 直接进 L0;DSH 会话走零补丁 watcher——分帧追加 zstd(session.v3.jsonl.zstd,$DSH_HOME)用 node:zlib 内置解码,不改 node_modules;空闲闸门(默认 10 分钟)防摄活跃会话;manifest 按文件字节 hash 幂等;opt-in:工作区有 .brain.json 才摄,ignore_session_prefix 默认 no_brain。撤回:会话删除→spool 清理、L0 物理删、引用链全灭的条目退出(L1 archived;L2+ 或 pinned/decision/高重要度 needs_review),源目录不可达宁可不撤。'],
  ['身份与安全', 'SimpleAIBrain 身份层决定:agent=每工作区持久实体,token 即密码,.brain.json 自备 32+ 随机 token,registry 存 SHA-256;hub 从工具参数摘除 _brainToken 解析身份,缺失按访客只读;md5(身份) 方案被否——身份串可枚举会破坏防投毒。脱敏三强制点:工具流水参数、会话正文(巩固送 LLM 前也必须过 redactText)、导入 md。危险工具门控沿用 hub 配置。'],
];
for (const [theme, content] of digests) {
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory.submit_session', arguments: { session_id: SID, kind: 'digest', content: theme + ':' + content, _brainToken: bj.token } } };
  const r = await fetch('http://127.0.0.1:45678/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  const txt = j.result?.content?.[0]?.text ?? JSON.stringify(j.error ?? j);
  console.log(theme + ' -> ' + String(txt).slice(0, 120));
}
