> 上游:[memory-design.md](../memory-design.md) · 状态:文档定稿 2026-10-14 · 实现:✅ 0.0.9.0(7 测试,累计 64/64)

# M06 · 会话摄入(被动采集 · hook · spool · watcher)

## 1. 目标与边界

让记忆系统**不依赖 agent 自觉**地拿到会话原料。**边界**:解析后的入库走 M02/M05;身份解析在 M07。

前提事实:hub 只看得见工具流量,看不见 agent 与其模型间的对话文本(发生在客户端)。因此两条腿:**hook 提交**(主动推)+ **被动工具流水**(hub 自采)。

## 2. harness 集成矩阵(2026-10 已核验,官方文档)

| Harness | 触发 | 会话数据 | SessionEnd 时限 | v1 适配 |
|---|---|---|---|---|
| Claude Code | 10 事件;[hooks 参考](https://code.claude.com/docs/en/hooks) | stdin JSON 含 session_id + **transcript_path** | 1.5s | ✅ SessionEnd/Stop hook |
| Codex | 12 事件(对齐 Claude);[hooks 文档](https://learn.chatgpt.com/docs/hooks);配置 ~/.codex/hooks.json 或 config.toml [hooks] | stdin JSON 含 session_id;transcript 于 ~/.codex/sessions/(装机核实) | 默认 1s / 上限 3s;支持后台 hook | ✅ |
| opencode | 插件 event 总线 session.idle;[插件文档](https://opencode.ai/docs/plugins/) | client SDK 可拉全文 | — | v2 |
| Cursor | hooks.json:stop 等;[hooks 文档](https://cursor.com/docs/agent/hooks) | 全文不外露(内部 SQLite) | — | v2,降级用工具流水 |
| DSH | 内部 session-end 轨迹事件,无对外 API | transcript 自持(session.v\*.jsonl.zstd,分帧 zstd) | — | ✅ 0.0.11.0(**零补丁**:watcher 对账 + dsh-jsonl parser v1) |

通用 hook 脚本(Claude/Codex 共用,事件模型几乎一致)+ 各家几行配置;差异留在 parser 层。

## 3. 提交物与去向

| 提交物 | 提交方 | 去向 | 待遇 |
|---|---|---|---|
| 会话摘要 digest | agent 工具调用 / hook | **L1 候选**(created_by=agent:<id>) | 照常过巩固评分,永不通往 L3 直通车 |
| 完整会话 jsonl | hook / watcher | L0(JSONL 原始层) | 只给巩固挖,永不注入上下文 |
| 工具流水 | hub onToolEvent | L0 | 同上 |

## 4. 三态通道(SessionEnd 是限时的:1.5s/3s)

```
hook 脚本(毫秒级,只投便签不搬内容):
  1. 读 .brain.json 得身份
  2. POST /brain/ingest { identity, harness, session_id, kind, transcript_path?, content?, hash }
     —— 同机只传路径;远程(agent 在别机)带内容分片
  3. 失败(断网/hub 挂)→ 写 spool 一行 JSON(同字段)→ 退出
worker(hub 侧):
  4. 排空 spool(重放 POST 语义)
  5. 周期对账 transcript 目录(~/.claude/projects、~/.codex/sessions)——补交崩溃/断网漏掉的会话
  6. 幂等:session_id + 内容哈希去重,提交 manifest 记游标
```

## 5. parser 层

- 每 harness 一个 parser(claude-jsonl / codex-jsonl / opencode-json / dsh / digest-md),**钉版本**:格式漂移时旧 parser 拒绝新文件并告警,不猜。
- parser 输出统一中间格式 → 进 L0 / 生成 L1 候选。
- 新 harness = 新 parser,采集矩阵自动扩展。

## 6. 脱敏(共享模块,强制点)

- 规则:按 `key/token/secret/password` 字段名与常见密钥形态(前缀模式)打码;参数/正文截断(maxParamChars 默认 2048)。
- **应用点**:①被动工具流水的 args;②**会话正文**(用户会在聊天里贴密钥——已有真实事故);③导入的 md。
- 位置:parser 内统一调用;脱敏后的内容才允许落 L0。

## 7. 被动工具流水

- 开关:aiBrain.passiveLog.enabled,**默认开**;tools 白名单(blender.*/bridge.call/unreal.*/web.search);maxParamChars。
- 埋点:**MCP CallToolRequestSchema 与 /rpc 双入口**(M01);onToolEvent fire-and-forget。
- **排除 memory.* 自身调用**。

## 8. 验收标准

- [x] transcript_path 机制生效:hook 提交路径 → worker 读文件 → parser → L0 解析记录(真实会话 60s 内触发为装机核实项,hook 样例已交付)。
- [x] 断网模拟:hook 落 spool;drain 补交,hash 幂等无重复。
- [x] watcher:手工删掉 manifest 一行 → 下轮对账补交(manifest 以文件为准)。
- [x] 脱敏:sk-/ghp_ 假密钥的会话/参数 → L0 中已打码;敏感字段名打码。
- [ ] Codex hook 配置样例在真实 codex CLI 上触发一次成功(装机核实项,样例已交付)。
- [x] memory.search 调用不产生工具流水记录(M01 排除逻辑已有测试)。

> **已知取舍:L0 快照重复**——会话每次静默后增长,重摄是整文件新快照(manifest 只存最新 hash),L0 按快照累积;当前 L0 无下游消费者,纯存储噪声;v2 方向:增量帧摄取(新文本严格前缀延伸旧文本)。另:SUBMIT_CAP 早退会顺延撤回段到下轮(良性)。
>
> **撤回/retraction(0.0.13.0)**:会话删除 → 关联记忆按引用链退出(\`src/consolidation/retractor.ts\`)。检测:reconcile 对 manifest 中 \`src:'dsh'\` 的行对照磁盘,会话工件消失 = 删除(目录不可达 = 源不可用 → 宁可不撤);POST/hook 提交的会话无文件可查,不检测。执行:该会话 spool digest 删除(防未处理内容再挖矿)→ L0 行物理删除(月度 jsonl 原子重写,损坏行保留)→ 条目链:source_ids 命中死 hash16 → 剥离;**全灭** → L1 archived(可逆)/ L2 以上或 pinned/decision/importance≥0.8 → needs_review(人工确认);部分幸存 → 保留(证据共享)。false-positive 可恢复:L0 由文件回归重摄,L1 不可自动恢复 → 检测保守。已知边界:DSH 大版本迁移改目录名会被当全删——迁移前先停 hub(开放问题)。

## 9. 开放问题

- claude/codex 对账的 cwd→.brain.json 登记查找(现被身份闸门拒,休眠中)
- DSH 大版本迁移(会话目录改名)会被撤回检测当全删——迁移前先停 hub 或手工清 manifest

- Codex transcript 落盘路径装机核实;Cursor stop payload 字段;DSH 补丁的挂点选择(session-end 事件)。

> 实现(0.0.9.0):\`src/ingest/\` 三件 —— redact.ts(**共享脱敏**:密钥前缀形态 sk-/ghp_/AKIA/JWT + 敏感字段名 + 截断;工具流水 args/会话正文/导入 md 三应用点统一走它)、worker.ts(parser 钉版本 claude-jsonl/codex-jsonl/digest-md,漂移 >30% 拒绝不猜;ingestOne = POST 语义 → L0 + manifest;drain 排空 ingest-spool;reconcile 周期对账 transcript 目录)、hooks/brain-hook.mjs(通用 hook:读 .brain.json → POST 1.4s 硬超时 → 失败落 spool;附 claude/codex 样例配置)。manifest **以文件为准**(reconcile 每轮强制重读,人工删行会被看到);hub 侧 POST /brain/* 由 hub 读 body 传 handler(0.0.12.2)。
>
> DSH 通道(0.0.11.0,**零补丁**):DSH 的会话落盘是分帧追加 zstd(\`session.v3.jsonl.zstd\`,数据根 \`$DSH_HOME\` → \`~/.dsh\`)。node:zlib 内置 zstd 即可解单帧,scanZstdFrames 按 zstd 帧头/块头结构走(对齐 @deepseek-ai/dsh-session-persistence-jsonl 的实现),torn 尾帧跳过 —— watcher 把 \`$DSH_HOME/sessions\` 作为第三对账源,不碰 node_modules。**空闲闸门**(默认 10min,\`ingest.dshIdleMs\`):追加中的活跃 session 不摄,静默才提交;hash 变化(有新帧)→ 静默后重摄。session_id = session 目录名。parser v1 只取 user/assistant 的 text(reasoning 跳过)。watch.dsh 可覆盖路径或置 null 关闭。
>
> **opt-in 登记(0.0.12.0)**:身份是摄入的前提——ingestOne 无 identity 直接拒收;DSH 对账先解出会话头 \`cwd\`(行顶层,勿写成 data.cwd)与末次 \`session/title\`,到 \`<cwd>/.brain.json\` 读登记:无文件/损坏 → 跳过且**不记 manifest**(以后补登记连历史一起补摄)。\`ignore_session_prefix\`(默认 no_brain,置空串关闭)命中标题 → 跳过。manifest 行新增 identity 字段。claude/codex 对账暂无 cwd→登记查找,被身份闸门拒(休眠,开放问题)。enroll 命令见 M07 §3.1。

---

## 设计稿(0.0.14 主题,实现未开始):L0 自动摘要——零介入闭环的最后一段

> 动机:现在 digest 靠 agent 收尾自觉提交;若它忘了,原始记录躺在 L0 永远不变 L1。本设计让"忘说存储记忆"不再造成知识流失,同时不破坏"人的判断优先"。

### 1. 触发条件(全部满足才摘)

1. watcher 对账发现会话有新增帧,空闲闸门(10 分钟)已过;
2. manifest 中该会话**无已提交 digest**——agent/人主动提交的摘要永远优先,自动摘要只补位;
3. 该会话尚未被自动摘要过(manifest 记 `autoDigested: true`,每会话至多一次;后续增长留给主动提交)。

### 2. 流程

取 L0(全量,v1 不做增量)→ `redactText`(强制)→ 生成 spool 文件:`kind: "digest"`,`content` 头部标注 `[自动摘要 | 会话空闲无提交]` → 走既有巩固管线抽取为 L1。撤回语义天然兼容:会话删除 → spool/L1 撤回路径不变。

### 3. 权重纪律

自动摘要产出的 L1:`importance ≤ 0.6`(写死上限),`created_by: "watcher:auto"`——自动来的东西不自动获得高权重;主动提交(人/agent 判断)才可 ≥0.8。

### 4. 成本与失败

每会话一次 LLM 调用;复用 `maxSessionsPerRun`(20)上限;LLM 失败按现成语义记 skip、游标不动、下轮重试。配置 `autoDigest: "on" | "off"`,**首发默认 off**(成本敏感,由用户显式开启)。

### 5. 验收标准

模拟会话:新增帧 + 无 digest → 对账后 spool 出现自动摘要 → 巩固出 L1(`importance ≤ 0.6`,`created_by: watcher:auto`)→ 随后 agent 补交 digest → 两条独立成条、互不冲突;agent 已提交过的会话对账不产生自动摘要;autoDigest=off 时完全不摘。

### 6. 四问预答

功能:补齐"忘提交"缺口,不抢人的判断。方便:用户真正零介入。稳健:redaction 强制、上限 1 次/会话、默认关闭、撤回兼容。文档:本节 + 主表 M06 行 + AGENTS.md 不变(纪律层无需感知)。
