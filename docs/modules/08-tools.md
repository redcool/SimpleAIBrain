> 上游:[memory-design.md](../memory-design.md) · 状态:文档定稿 2026-10-14 · 实现:✅ 0.0.5.0(7 测试,累计 34/34)

# M08 · 工具面(memory.* MCP 契约)

## 1. 目标与边界

定义 agent 与人实际看到的全部工具。**数量红线 ≤ 8**(每个工具的名称+描述都会进所有 agent 的上下文);描述必须短、准确、可执行。

## 2. 工具清单(v1 全量 = 8)

| 工具 | 身份 | 作用(给 agent 的描述基调) | 关键参数 |
|---|---|---|---|
| memory.save | agent+ | 保存一条候选记忆(自动归入 L1) | content, kind, importance?, tags?, project?, scope?(默认 agent) |
| memory.search | 全部 | 检索记忆条目(程序化用,含 source_ids 可下钻) | query, scope?, project?, includeArchived?, limit? |
| memory.context | 全部 | 返回按预算组装好的记忆上下文块(日常首选) | query, project?, budget? |
| memory.submit_session | agent+ | 提交会话摘要或完整日志(路径或内容) | session_id, kind: digest\|full, path?\|content?, hash? |
| memory.stats | agent+ | 记忆库统计(各层条数/命中率/队列长度) | — |
| memory.whoami | 全部 | 返回当前身份与权限 | — |
| memory.review_list | member | 列出待裁决条目并执行裁决 | action: list\|resolve, id?, verdict? |
| memory.edit | member | 修改/钉住/遗忘/恢复条目("大脑手术") | id, action: edit\|pin\|unpin\|forget\|restore, content?, reason? |

- v2 追加 memory.import(导入既有 session_memory.md,created_by=import)。
- edit/pin/forget 合一(用 action 参数)是为守住 ≤8 红线;member 身份校验在工具入口统一做。

## 3. 行为规范

- **错误语义**:统一 `{ error: string }` + isError;权限拒绝写明"需要 member token";身份缺失写明"未识别连接"。
- **save 的诚实性**:save 返回"已存为候选,能否长期保留由巩固决定"——不向 agent 承诺进入 L3。
- **context 是日常入口**:描述里引导 agent 优先用它,search 供下钻。
- **submit_session 的幂等**:重复提交同 hash → 返回"duplicate,已忽略",非错误。
- 所有工具在身份为 null 时按 §2 表降级或拒绝。

> 实现(0.0.5.0):\`src/tools/definitions.ts\`(8 个 ToolDef:name/描述/inputSchema)+ \`src/tools/dispatch.ts\`(callTool:权限闸门 → 分发 → 统一 {error}+isError)。可见性:访客=仅 studio;agent=本 agent+本 member+studio;member 凭证=本 member 全部+studio。submit_session 落 \`_spool/<hash16>.json\`,同 hash 幂等返回 duplicate。context 为 v1 简版(分层配额 20/30/50 + 相关性过滤 + 无命中回退),M04 接管精化。**描述总字符基线 = 239**(测试回归,上限 1500)。

## 4. 验收标准

- [x] 每个工具:合法参数成功、缺参报错、错误信息可读(三例各一测)。
- [x] 权限:§2 表逐行验证(含访客 whoami 放行裁定)。
- [x] save → 索引可见新条目,layer=1,created_by=agent:<id>。
- [x] edit(forget) → status=archived;restore → active(另 pin/unpin、review resolve 走状态机)。
- [x] 工具描述总计字符数记录在案:239 字符(基线,回归上限 1500)。

## 5. 开放问题

- review_list 的 resolve 动作在 v1 用最简交互(list + resolve 两参);GUI 化是 v3 的事。
