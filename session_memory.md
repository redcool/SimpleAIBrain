# Session Memory — SimpleAIBrain 开发会话记忆

> 作用:记录本仓库开发过程中的**决策**、**踩坑根因**与**操作手册**,供后续会话快速恢复上下文。
> 更新规则:每次会话结束时追加;踩坑记录必须包含【现象 / 根因 / 修复】三段。

## 0. 项目全貌

```
SimpleAIBrain = simpleMCPServer 的记忆插件包(进程内插件,由 ai_brain_path 加载)
设计:docs/memory-design.md(主文档)+ docs/modules/(11 个模块文档)
状态:M02 存储层已完成(0.0.2.0,2026-10-14,11/11 测试);进度见主文档 §4 状态表
```

## 1. 决策记录

### D1. 记忆系统设计定稿(2026-10-14,八轮设计讨论)
- 关键定论:进程内插件(不做子进程 MCP,理由:被动钩子+单写者+零协议开销);v1 文件后端(frontmatter 事实源 + data/ 独立 git),MemoryStore 七操作接口为 PgStore 留位;压缩与存活分离(R = importance·e^(−Δt/S),S 随访问增强);写入自由短期、升层受限长期;身份 = studio/member/agent_label 明文 ID + 随机 token(project 不进身份);摄入 = SessionEnd hook 投便签 → POST → spool → watcher(双入口埋点,排除 memory.*);跨工作室只读联邦、不共享写。
- 主文档 §1 十条不变量是后续一切实现的否决权来源。

### D2. 文档组织方式(2026-10-14)
- 用户要求:先主文档 → 拆模块文档 → 大模块继续拆,每个模块"足够简单、确定" → 实现时用状态表标注完成情况。
- 落实:主文档 §4 状态表为进度唯一事实源;11 个模块文档每个 ≤200 行、含验收标准。

### D3. M02 存储层实现决策(2026-10-14)
- 运行时依赖仅 `yaml`(frontmatter 解析);其余全用 node: 内置(fs/path/crypto/child_process)。
- frontmatter 表补充 `title` 字段(缺省取正文首行 ≤60 字符,决定文件 slug),已回写 02-storage.md。
- ULID 按标准 26 字符(10 时间戳 + 16 随机 80bit);首版误写 36 字符,被 id 正则拦下后修正。
- FileStore 在七操作外补 init()/rescan()/cleanTmp():tmp 残留清理、坏 YAML → _quarantine;patchMeta 走白名单(结构字段 layer/owner 只能走 moveEntry/upsert)。
- 测试命令用 `node --test tests/*.test.cjs`(本机 Node v24 不接受目录参数)。

### D4. M03 记忆模型实现决策(2026-10-14)
- pin 落地为 frontmatter 字段 "pinned: bool"(文档原本只提语义没有字段),FileStore 校验/patch 白名单同步支持。
- M03 全部为纯函数(src/model/scoring.ts + lifecycle.ts):decaySweep 只报归档候选清单,落库由 M05 经 store.patchMeta 执行——规则与执行分离。
- 状态机用显式转移表:active→{superseded,archived,needs_review};needs_review→{active,superseded,archived};archived→{active};superseded 终态只读。
- 证据判定输入为 AccessStats(去重会话数等),由 recall-log(M10)汇总供给;"同主题归并"作为 L1→L2 的组级路径传入。
- 默认参数 k=0.25、地板 0.15 以 DEFAULTS 常量暴露;待开跑两周后校准(M03 §8)。

### D5. M07 身份与权限实现决策(2026-10-14)
- 文档内矛盾裁定:字符集表未含 @,但 §2 示例 builder@claude-code —— 依示例放宽 agent_label 允许 @,studio/member 仍严格 [a-z0-9-_.];已回写文档。
- TokenRegistry 持久文件只存 SHA-256 哈希;明文 token 仅 issue/register 返回一次;rotate/revoke 不动 ID。
- 角色约定:identity=null → 访客(只读 search/context);agent_label 非空 → agent;空串 → member 级凭证(全权)。
- 权限闸门只做判定(assertCanInvoke 带可操作提示),执行点在 hub 工具分发处(M01 联调接线)。
- .brain.json 非法字段报错带 "suggested:" 规范化建议,不自动改写(显式优于隐式)。

### D6. M08 工具面实现决策(2026-10-14)
- 工具恰 8 个;描述总字符基线 239(测试断言 ≤1500 防悄悄膨胀)。
- 裁定:whoami 对访客开放(M08 §2 "全部" 优先于 M07 §4 ❌;访客需要知道自己是访客);M07 文档矩阵已回写。
- save 诚实语义:固定返回 "已存为候选(L1);能否长期保留由巩固决定,不承诺进入 L3"。
- 可见性规则:访客=仅 studio;agent=本 agent+本 member+studio;member 凭证=本 member 全部+studio。
- submit_session 落 _spool/<hash16>.json;同 hash 重提交返回 duplicate(非错误,幂等)。
- frontmatter 补 tags 字段(可选 string[]),FileStore 校验/patch 白名单同步。

### D7. M04 检索实现决策(2026-10-14)
- relevance 确定性计分:tags 精确 +1 / 标题包含 +1 / 正文 +0.5;多词时整串短语再加成;score = relevance × layerPrior × R。
- 屏蔽去重:高层命中把其 source_ids 加入 mask,低层同源条目不进 context;search(下钻)不受 mask 影响。
- 预算装配:配额 L3 20%/L2 30%/L1 50%,用不满让渡给下一层,总预算不可超;超配额的长条目**裁剪正文适配**而不是整条丢弃(首版整条丢弃导致小预算下 L3 消失,已修)。
- 复习闭环:recall-log 立即写;access/S 强化走 ReinforceBatcher 60s 合批(WeakMap 按 store 复用,flush 供测试/退出调用)。
- 无相关命中时回退纯 R 排序(fallback 标记);needs_review/superseded 永不进候选。

### D8. M01 插件契约实现决策(2026-10-14)
- 契约类型在 src/plugin/contract.ts 与 M01 §2 逐字对应;工厂 createBrainPlugin() 由 hub pluginHost 每次加载调一次(loader 持单例)。
- registerRoutes 是 loader 职责、init 不自动调(测试曾因此漏调,已修);v1 只挂 /brain/health,/brain/ingest|query 留给 M06/v2。
- onToolEvent 同步返回:memory.* 排除自身;passiveLog.enabled===false 关闭(缺省开);脱敏键正则 token|password|secret|apikey|authorization|credential;appendLog 异步 fire-and-forget 带 catch 计数。
- resolveIdentity(token) 作为 v1 扩展方法挂在插件实例上(契约可选);TokenRegistry 落 <dataDir>/memory/_identity/tokens.json,_identity 已进 SKIP_DIRS;registry.save 自建目录。
- 工具版本节奏:0.0.7.0 = M01 brain 侧;0.0.7.1 = resolveIdentity 扩展;hub 侧接线在 SimpleMcpServer 仓库以 0.0.12 提交。

### D9. M05 巩固实现决策(2026-10-14)
- 四阶段一 run:摘要(_spool digest→L1 event,kind 映射 digest→event)→ 归并(同 agent 未归并 L1 ≥ minMergeGroup,默认 5)→ 蒸馏(promotionVerdict 达标 L2→原子 L3)→ 衰减(decaySweep 落库归档)。
- 游标:processed_spool(hash16→L1 id)每 session 落盘;启动对账以 L1 source_ids 前 16 位 hex 重建——**条目是唯一真相**,游标只是缓存。
- LLM 只提名不裁定:conflicts 经 resolveConflict、蒸馏候选经 promotionVerdict、幻觉 old_id 忽略、merges 无出处不写;失败按 session 跳过下轮重试,maxSessionsPerRun=20 封顶。
- 蒸馏幂等 = L2 已被任一 L3 引用即跳过;归并幂等 = L1 被 L2 引用即"已归并";L1 永远保留作证据。
- 插件:init 挂 24h 定时器(unref,schedule=off 关);POST /brain/consolidate 手动触发;run 结束 gitCommitIfRepo(data/,消息含 run_id 与计数)。

### D18. 跨会话实测闭环 + 衰减失准(2026-10-16,0.0.13.9)
- 用户两轮新会话实测:第一轮暴露指引缺陷(我写的"访客即可查"误导 + agent 用 Bearer 头而非 _brainToken 参数)→ 修 AGENTS.md + brain 加访客 0 命中 note 提示(0.0.13.8)。第二轮全通过:whoami→token→context→正确复述+自我修正陈旧结论。**跨会话记忆传递闭环。**
- **教训(重要)**:记忆里只有被有意巩固过的东西——"会话里聊过 ≠ 记忆里有"。digest 范围定义=摄入边界,曾漏掉全部 hub 操作知识;已补"SimpleMcpServer运维操作规范"digest,并固化规则:digest 应含与外部系统协作的关键操作事实。
- **衰减失准(严重)**:consolidator 写死 stability=1.0,而 M03 公式 S 单位=小时 → 半衰期 1 小时,20 小时未复习的 0.9 重要度记忆被归档。用户的问题触发巩固 run 才暴露。修复:分层半衰期 L1=72h/L2=720h/L3=8760h(0.0.13.9),12 条存量迁移,4 条误归档恢复。**若未发现,所有记忆一周内无声蒸发。**教训:新系统的默认参数必须对照单位语义核一遍;维护阶段的自动行为要有第一次全量人工复核。
- 口令体系成型(0.0.13.10):存储记忆/获取记忆/查找记忆/记忆体检/登记记忆,权威清单 docs/用户指令.md,执行定义在 AGENTS.md。
- 当前库:L1×8 + L2×4 全 active。

### D17. M05 首跑打磨 + L1→L2 实测(2026-10-15,0.0.13.5)
- 回填 5 条主题 digest(存储/检索/巩固/摄入/身份安全,全部出自本会话真实决策,session_id 如实标 session-b2fe0496)经 /rpc 真实提交。
- 三修:抽取输出加 title(LLM 主题标题,告别 session-id 标题);importance 标尺进 COMMON(0.9-1.0 仅限关键决策——校准生效,新条目 0.9-0.95,不再满 1.0);parseJsonOut 尾逗号修复通道(merge LLM 首跑即产出非法 JSON,实锤需要)。
- hub llm.maxTokens 1024→4096:6 条 L1 的合并 JSON 在 1024 下截断("no JSON object"真因)。
- L1→L2 实测:merged:4(6 L1 → 4 L2,source_ids 引用 member L1 id)。空转 run 全零幂等 ✓。
- **教训:我误读设计**——以为 member L1 被归并后应转 superseded,加了"吸收"逻辑,测试 "L1 evidence kept" 拦下:保持 active 是 M05 既定语义(证据保留,重复归并由 referenced 集合防)。已复原并把设计显式写进 M05 文档。测试在保护设计时,先怀疑自己再怀疑代码。
- 终态:L1 x6(全部 active)+ L2 x4;memory 基站 10 条目。提交 3594a72。

### D16. hub llm 渠道回退链 + 运维教训(2026-10-15,hub 0.0.13.0/1bf45e7)
- 用户定调:callLLM 开放给用户换信任的 LLM(自有 baseUrl/model/apiKey)。实现:config.json llm 段加 fallbacks(≤3,按序尝试);llm.ts 拆为 callLLM(解析链)+ callLLMWithEndpoints(可测执行器)+ attemptLLM(单渠道);渠道失败记 [LLM] 日志,全灭抛聚合错误;启动日志打生效链。对 brain 零改动(契约不变)。
- 测试 3 个(mock HTTP 服务,不碰真配置);hub 套件 27/27;configuration.md 补「llm 渠道链」节;AGENTS.md 已更新。活配置:agnes-3.0-flash 主 + agnes-2.5-flash 回退。
- 运维教训(重要):1) 按 CommandLine 匹配进程会**自匹配**——DSH runner 的命令行嵌入了整段 pwsh 命令文本,数 hub 数出 4 个其实是数到自己;排除 pwsh/runner 或按 WorkingDirectory 判别。2) hub 重启后必须核对**新 banner 时间戳**,否则可能在跟旧 hub 说话(曾因此把旧 dist 的 400 当成新代码问题排查)。3) 疑似adapter 继承监听 socket:杀 listener PID 后端口仍被占,新 hub EADDRINUSE 静默崩溃;稳妥重启应先等端口释放再启动。4) 根目录 hub-*.log 是旧 hub 遗留,已归档 tmp/hub-*.stale-1.log(移动不删除)。
- 误伤自查:曾按正则杀过一个非监听进程(61932),无法完全排除碰到了用户 ignis-agent-cli 的任务 runner——已在其后核对当前 ignis 进程(62408)存活;若用户发现该任务异常,此处是嫌疑。

### D15. 价值管道首跑贯通(2026-10-15,0.0.13.2/0.0.13.3)
- 用户令:读 hub 新工作纪律(docs/Agent工作纪律.md:短句/同名不覆盖/tmp 目录/夜班记录/版本语义),提交本会话数据并跟踪全流程。
- 首跑暴露并修复两个真缺陷:1) M11 强制点缺失——巩固器把 spool 内容未脱敏送 LLM,补 redactText(0.0.13.2);2) LLM 契约错位——hub callLLM 收 {system?,prompt}(内部总把 prompt 作 user 消息),brain 传消息数组,在 brain-plugin 边界做完整适配(0.0.13.3)。
- hub 配置:agnes-2.0-flash 渠道已下架(503),切 agnes-3.0-flash。
- 全链证据:digest 经 /rpc memory.submit_session(真实 token 鉴权)→ spool 811423510171c442 → consolidate summarized:1 → L1 mem_01M4ZGYBN6WTDV4H86S9J6P7YQ(members/local/agents/simpleaibrain/L1/,source_ids 引用 hash16,created_by consolidator)→ memory.context 命中 1 条(matched:1,预算 0.2k/4k,带数据非指令横幅)→ stats L1:1,recall_7d {queries:1,hits:1}。
- 失败语义验证:LLM 503 时巩固器记 skip、游标不动、spool 保留,重试成功——重试设计如设计工作。
- 观察待办:抽取 LLM 把 importance 给到 1.0(偏满),M05 提示词打磨时加校准;LLM 输出偶见个别乱码字符。
- 教训:健康轮询要等 listen 完成(本轮过早放弃误判启动失败);测试全绿≠集成契约正确(87/87 下仍有契约 bug,首跑抓出)。

### D14. 撤回/retraction 实现(2026-10-15,0.0.13.0)
- 用户定调的语义:删会话 → 关联记忆退出;证据共享 → 幸存佐证保留,证据全灭才退出。
- 检测:reconcile 里 manifest src='dsh' 行对照磁盘(会话工件消失=删除);目录不可达(盘未挂载)= 源不可用 → 宁可不撤。POST/hook 会话无文件,不检测。曾加"mass vanish >50% 阈值"——**误伤合法单删,已撤**(与不可用检查重复;false-positive 的 L0 可由文件回归+重登记恢复)。
- 执行(retractor.ts):spool digest 删(防未处理内容再挖矿)→ L0 行物理删(月度 jsonl 原子重写)→ 条目:命中死 hash16 → 剥离 source_ids;全灭 → L1 archived / L2+ 或 pinned/decision/importance≥0.8 → needs_review;skipped = 已 archived/superseded。
- 链路真值:全链 source_ids 引用 digest hash16(spool 文件名=sha256(content).slice(0,16)),spool 记录自带 session_id——撤回不依赖 L0 行归属。
- 已知边界:DSH 大版本迁移改目录名 → 全删误判,迁移前停 hub(开放问题)。测试 79 → 86。
- live:hub 已重启载入 0.0.13;SimpleAIBrain 基站已登记(s1/local/simpleaibrain),首条真实 L0 已入。

### D13. opt-in 登记 + ignore_session_prefix + enroll(2026-10-15)
- 用户定调:**有 .brain.json 才进记忆**——比"目录名推导身份"更好,系统不需要猜,unknown 桶消失;未登记工作区不记 manifest,以后补登记连历史一起补摄。删除文件 = 停止新增,不抹历史(清除走 M11)。
- token 保留在 .brain.json(身份凭证分离:改名不换密码);用户不手搓随机数 → scripts/enroll.mjs(issue 随机 token + 登记 TokenRegistry + 写文件;--force 换发;已登记重跑是 no-op)。md5(身份) 方案被否:身份串非秘密,md5 可枚举,M11 防投毒塌方。
- ignore_session_prefix(默认 no_brain,置空串关):会话标题(末次 session/title)命中前缀 → 永不摄入;无标题会话不忽略。
- ingestOne 身份闸门在 parser 校验之后(unknown harness 错误优先);claude/codex 对账暂无 cwd 查找 → 休眠(M06 开放问题)。
- 实现坑:v3 会话头 cwd 在**行顶层**,不是 data.cwd(真实文件验证抓出);manifest 行新增 identity 字段。干跑验证:真实会话复制(未登记)跳过,登记合成会话按身份摄入。
- 测试 77 → 79;brain 0.0.12.0。hub(PID 38244)仍是 10/13 老进程,需重启才加载 brain 0.0.12.x;用户重启后:health、enroll SimpleAIBrain、验证首轮真实摄入。

### D12. DSH 通道接入决策(2026-10-14,v1 后增补)
- 用户实况:主力 harness = DSH(Codex 也跑在 DSH 内)→ M06 矩阵的 DSH 行才是真正吃到的摄入路径;Claude/Codex CLI hook 样例保留但不急。
- **零补丁**:DSH 会话 = 分帧追加 zstd(session.v3.jsonl.zstd,~/.dsh 即 $DSH_HOME);node:zlib 内置 zstdDecompressSync 解单帧,scanZstdFrames 照 zstd 帧结构走(帧头 descriptor/块头 walk,对齐 dsh-session-persistence-jsonl),torn 尾帧跳过 → brain watcher 直接对账,不改 DSH node_modules(避免重打补丁负担)。
- **空闲闸门** dshIdleMs=10min:DSH session 追加式写入,文件 hash 随新帧变化;只摄 mtime 静默的文件,活跃会话不反复全文重摄;hash 变化 → 静默后重摄(增量以整文件重读,幂等键 session_id+hash)。
- session_id = session 目录名;数据根 dshHome():$DSH_HOME → ~/.dsh;默认开启,首轮回填历史(上限 50/轮,只回填已静默的)。
- Parser.parseBuffer 通道:transcript_path 以 Buffer 进 parser(文本 parser 走 toString,dsh 走解码);真实文件验证:1013 帧/889 万字符全解,v3 行形 {type,seq,time,data}。

### D11. M10/M11 强制项实现决策(2026-10-14)
- M10 基础项:stats 扩至 scopes 分布 + recall_7d(queries/hits,recall-log 聚合,坏行跳过)+ consolidation.last_run;巩固 run 末追加 '[ai-brain] review summary: needs_review=N quarantined=M' 日志行——无出口的队列等于不存在。
- 自指排除靠 M02 的 SKIP_DIRS('recall-log'/'L0-log'/'_spool'/'_quarantine'/'_identity'),测试以"塞伪条目文件 → stats 不变"钉死。
- M11 强制项:FileStore.removeMember(成员退出)= 删 members/<member>/ 子树,个人条目清零、studio 条目与 created_by 归因保留、索引走盘自动一致,退出动作 gitCommitIfRepo 记录;恢复演练 = git clone data/ → 新 FileStore init → stats 一致(data/ 自带 git,M11 §4)。
- 投毒防护四件套(标注/归因/只到 L1/needs_review)在 M03/M04/M05 已有,本轮以联测钉死;脱敏三来源联测归拢到 m10-m11 测试文件。
- 事故预案(吊销→filter 清洗→重扫)与远端 push 策略 = 流程项,不代码化(v1 边界)。

### D10. M06 摄入实现决策(2026-10-14)
- 三态通道落地:hook 毫秒级只投便签(transcript_path,1.4s 硬超时,失败落 ingest-spool 一文件一事件)→ worker drain 重放 POST 语义(成功含重复即删,损坏丢弃不猜)→ reconcile 周期对账 transcript 目录补漏(50/轮上限)。
- **manifest 以文件为准**:reconcile 每轮强制重读,不信内存缓存——人工删行必须被看到(测试抓出缓存坑)。
- parser 钉版本(claude-jsonl/codex-jsonl/digest-md,均 v1);>30% 行坏 → 拒绝告警不猜;新 harness = 新 parser。
- 共享脱敏 redact.ts:密钥前缀(sk-/ghp_/github_pat_/AKIA/eyJ)+ 敏感字段名 + 截断 2048;brain-plugin.redactArgs 改为 re-export(单一实现,三应用点:工具流水 args/会话正文/导入 md)。
- hub POST /brain/* 由 hub 读 body(JSON,受 maxBodyBytes 限制)传 handler——handler 单参契约不变,GET 不读流。
- 会话 L0 记录:{harness, agent_label(身份 id 解析,坏值→unknown), kind:'session', session_id, digest(脱敏后), hash};manifest 幂等键 = session_id + hash。

## 2. 踩坑记录

### B3. 编辑序列中途失败 → 后续编辑全部未执行(2026-10-14)
- 【现象】0.0.7 收尾把 6 个编辑放进一次调用,主文档行匹配失败抛异常,排在后面的 package.json/VERSION/session_memory 编辑全部没跑,而提交已带 0.0.7.0 标签。
- 【教训】(1)关键状态(版本号、状态表)的编辑与提交之间必须**再验证**(grep 实际文件);(2)长编辑链按依赖分多次调用,失败后逐项补齐而不是假设已发生;(3)测试断言版本常量能兜住这类遗漏(本次靠 hub 侧日志 v0.0.6 暴露)。

### B1. harness 报 "Stream ended without finish_reason"(2026-10-14)
- 【现象】设计讨论期间 harness 报模型调用错误。
- 【分析】模型/网关侧流式中断,与本仓库代码无关。
- 【决定】记录观察,不行动;若实现期高频复现再查网关。

### B2. run_code 模板串陷阱(2026-10-14)
- 【现象】run_code 写大文件连续报 ReferenceError(path is not defined)/ "Unterminated template" / "Expected ','"。
- 【根因】run_code 程序体处在模板串求值环境:内容里的 `${...}` 被当插值求值,裸反引号会提前截断模板。
- 【修复】run_code 内禁止裸反引号与 `${`;写文件改用"逐行 push + join + node:fs 直写";用 node:fs 直写过的文件,后续 tools.edit 前必须先 tools.read。

### 0.0.16.18 文档状态同步(2026-10-24)
- 【决定】主设计文档顶部状态改为"v1 完工";修复 M06 状态行断表;package.json 版本同步 0.0.16.18(w 位此前从未写入,与提交标签脱节)。
- 【证据】npm test 104/104 ×2(提交前双重确认)。
- 【补充】版本同步实为三处联动:package.json + src/index.ts VERSION + 提交标签(存在 drift guard 测试)。观察:m08 review_list 测试在全量并发下偶发时序抖动(单文件 ×3 稳定),记录待查。

### 0.0.16.19 读侧钩子双注入修复(2026-10-24)
- 【现象】新开会话出现两次记忆上下文注入;recall-log 铁证:SessionStart 与 3 秒后的 UserPromptSubmit 各调一次 memory.context(q 均为 fallback),节流未生效。
- 【根因】DSH 钩子沙箱中 H:/ai_works 落盘全部静默失败(trace/boot/state 自 10-20 注册日起零写入),节流状态恒空 → st=null 走"无状态"路径 → 双发。钩子环境唯一保证可写的是 temp(runner --temp)。
- 【修复】memory-hook.mjs 状态/trace/boot 主存 os.tmpdir()/simple-brain-hook/,旧目录降级后备;die() 移除未定义引用。注册点:DSH_HOME=D:/Users/Admin/.dsh,注入经 cordis.patch.yml → hooks-claude-code → config/hooks.json(SessionStart+UserPromptSubmit 双挂 scripts/memory-hook.mjs)。
- 【验证】同 session 模拟开场:SessionStart 注入 ✓,3s 后 UserPromptSubmit rate-limited ✓(stdout 空);npm test 104/104 ×2。

### 0.0.16.20 凭证防呆 + 自主任务上手文档(2026-10-24)
- 【功能】enroll.mjs 自动把 .brain.json 写入工作区 .gitignore(存在则追加,缺则创建;幂等;两路径都覆盖——已登记重跑也补)。动机:用户提议"不准入 git 的文件直接写进忽略文件,避免用户犯错"。审计发现 SoundGenPrj/ModelTrainPrj .gitignore 均缺该项(已补);SimpleAIBrain 自身安全(git 未追踪 + 已忽略)。
- 【文档】docs/自主任务上手.md(自主任务/pipeline 三分钟上手:命令、前提、判官/硬闸/断点续跑、plan.json 预置接管拆步、边界);用户指令.md 与 AGENTS.md 登记条目补 gitignore 说明;project-tag-convention.md 示例大小写对齐 SoundGenPrj。
- 【校验】md-版本对应检查:版本链 0.0.16.20 一致;memory-design.md 顶部状态/M06 行与本版事实一致;hook-state 旧路径在 docs 零引用(0.0.16.19 无残留);convention 文档"v1 条目仍 active"描述经 hub 实查仍准确(style v1、双版词 v1 均 L1 active)。
