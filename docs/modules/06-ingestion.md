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

## 9. 开放问题

- Codex transcript 落盘路径装机核实;Cursor stop payload 字段;DSH 补丁的挂点选择(session-end 事件)。

> 实现(0.0.9.0):\`src/ingest/\` 三件 —— redact.ts(**共享脱敏**:密钥前缀形态 sk-/ghp_/AKIA/JWT + 敏感字段名 + 截断;工具流水 args/会话正文/导入 md 三应用点统一走它)、worker.ts(parser 钉版本 claude-jsonl/codex-jsonl/digest-md,漂移 >30% 拒绝不猜;ingestOne = POST 语义 → L0 + manifest;drain 排空 ingest-spool;reconcile 周期对账 transcript 目录)、hooks/brain-hook.mjs(通用 hook:读 .brain.json → POST 1.4s 硬超时 → 失败落 spool;附 claude/codex 样例配置)。manifest **以文件为准**(reconcile 每轮强制重读,人工删行会被看到);hub 侧 POST /brain/* 由 hub 读 body 传 handler(0.0.12.2)。
>
> DSH 通道(0.0.11.0,**零补丁**):DSH 的会话落盘是分帧追加 zstd(\`session.v3.jsonl.zstd\`,数据根 \`$DSH_HOME\` → \`~/.dsh\`)。node:zlib 内置 zstd 即可解单帧,scanZstdFrames 按 zstd 帧头/块头结构走(对齐 @deepseek-ai/dsh-session-persistence-jsonl 的实现),torn 尾帧跳过 —— watcher 把 \`$DSH_HOME/sessions\` 作为第三对账源,不碰 node_modules。**空闲闸门**(默认 10min,\`ingest.dshIdleMs\`):追加中的活跃 session 不摄,静默才提交;hash 变化(有新帧)→ 静默后重摄。session_id = session 目录名。parser v1 只取 user/assistant 的 text(reasoning 跳过)。watch.dsh 可覆盖路径或置 null 关闭。
