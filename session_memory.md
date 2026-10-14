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

## 2. 踩坑记录

### B1. harness 报 "Stream ended without finish_reason"(2026-10-14)
- 【现象】设计讨论期间 harness 报模型调用错误。
- 【分析】模型/网关侧流式中断,与本仓库代码无关。
- 【决定】记录观察,不行动;若实现期高频复现再查网关。

### B2. run_code 模板串陷阱(2026-10-14)
- 【现象】run_code 写大文件连续报 ReferenceError(path is not defined)/ "Unterminated template" / "Expected ','"。
- 【根因】run_code 程序体处在模板串求值环境:内容里的 `${...}` 被当插值求值,裸反引号会提前截断模板。
- 【修复】run_code 内禁止裸反引号与 `${`;写文件改用"逐行 push + join + node:fs 直写";用 node:fs 直写过的文件,后续 tools.edit 前必须先 tools.read。
