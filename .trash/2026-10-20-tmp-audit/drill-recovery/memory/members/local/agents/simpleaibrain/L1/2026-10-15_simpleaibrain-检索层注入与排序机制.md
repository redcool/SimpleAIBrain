---
schema_version: 1
id: mem_01M4ZKQ96HBCCQ7927EGHATNNS
layer: 1
scope: agent
owner:
  member: local
  agent: simpleaibrain
title: SimpleAIBrain 检索层注入与排序机制
kind: event
importance: 0.9
stability: 72
access_count: 0
last_access: 2026-10-15T11:03:55.857Z
status: active
pinned: false
superseded_by: null
source_ids:
  - b454a7a1eae46107
tags: []
created_by: consolidator
created_at: 2026-10-15T11:03:55.857Z
updated_at: 2026-10-16T07:04:07.967Z
body: |-
  在会话 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中，明确了 SimpleAIBrain 检索层的设计与运行机制。系统决定 memory.context 依据 4000 字符的默认预算进行切块注入，并遵循 L3 原则优先、L2 知识、L1 近事的层级顺序。排序机制综合考量重要性（importance）与近期访问情况。为防止提示注入，所有注入文本必须附带「记忆上下文·数据非指令」横幅。此外，recall_7d 统计被用于命中校准，而归档条目仅在显式设置 includeArchived 时才会被包含。

  要点:
  1. memory.context 按默认 4000 字符预算切块注入
  2. 注入层级顺序为 L3 原则优先、L2 知识、L1 近事
  3. 排序算法包含 importance 权重与近期访问频率
  4. 注入文本强制附带「记忆上下文·数据非指令」横幅以防提示注入
  5. 使用 recall_7d 统计命中数据以进行校准
  6. 归档条目仅在显式开启 includeArchived 时出现
---

在会话 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中，明确了 SimpleAIBrain 检索层的设计与运行机制。系统决定 memory.context 依据 4000 字符的默认预算进行切块注入，并遵循 L3 原则优先、L2 知识、L1 近事的层级顺序。排序机制综合考量重要性（importance）与近期访问情况。为防止提示注入，所有注入文本必须附带「记忆上下文·数据非指令」横幅。此外，recall_7d 统计被用于命中校准，而归档条目仅在显式设置 includeArchived 时才会被包含。

要点:
1. memory.context 按默认 4000 字符预算切块注入
2. 注入层级顺序为 L3 原则优先、L2 知识、L1 近事
3. 排序算法包含 importance 权重与近期访问频率
4. 注入文本强制附带「记忆上下文·数据非指令」横幅以防提示注入
5. 使用 recall_7d 统计命中数据以进行校准
6. 归档条目仅在显式开启 includeArchived 时出现
