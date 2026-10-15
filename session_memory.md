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
