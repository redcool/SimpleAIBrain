---
schema_version: 1
id: mem_01M4ZKQ0YSP82HSRFXQAQV87NF
layer: 1
scope: agent
owner:
  member: local
  agent: simpleaibrain
title: SimpleAIBrain存储接口、生命周期与冲突消解规则确立
kind: event
importance: 0.95
stability: 90
access_count: 2
last_access: 2026-10-19T02:49:10.628Z
status: active
pinned: false
superseded_by: null
source_ids:
  - ac90c0c0d8f0b26c
tags: []
created_by: consolidator
created_at: 2026-10-15T11:03:47.417Z
updated_at: 2026-10-19T02:50:10.665Z
body: |-
  在 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中，团��完成了 SimpleAIBrain 存储层的设计决策。核心确立了以目录为地址、Frontmatter 为事实源的 FileStore 架构，主要键值采用 mem_<ULID> 格式，数据落盘至 L1/L2/L3 子目录。存储层暴露统一操作接口，涵盖初始化、扫描、读写、移动及追加日志等 9 项核心操作。生命周期管理定义了 active、superseded、archived、needs_review 及 pinned 五种状态；其中 archived 状态支持可逆访问，需显式标记方可查看；pinned 状态可豁免自动衰减与覆盖策略。在冲突处理上，确立了人工优先原则：当冲突涉及 pinned 条目、关键决策记录或重要性评分 ≥0.8 的数据时，系统不执行自动覆盖，而是标记为 needs_review 强制触发人工确认。

  要点:
  1. 在 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中决定 SimpleAIBrain 采用 FileStore 存储层，以目录为地址、Frontmatter 为事实源，主键使用 mem_<ULID> 格式
  2. 在 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中定义存储层包含 init/rescan/scanMeta/readBody/upsertEntry/moveEntry/patchMeta/appendLog/iterateByScope 等 9 项操作接口
  3. 在 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中确立生命周期五态模型：active/superseded/archived/needs_review/pinned，其中 archived 需显式参数方可访问
  4. 在 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中决定 pinned 状态条目跳过自动衰减与覆盖策略，保障关键数据持久性
  5. 在 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中确立冲突消解规则：涉及 pinned、决策记录或 importance≥0.8 的条目禁止自动覆盖，必须转为 needs_review 人工确认
  6. 在 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中明确 md 文件物理落盘结构为 L1/L2/L3 层级子目录
---

在 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中，团��完成了 SimpleAIBrain 存储层的设计决策。核心确立了以目录为地址、Frontmatter 为事实源的 FileStore 架构，主要键值采用 mem_<ULID> 格式，数据落盘至 L1/L2/L3 子目录。存储层暴露统一操作接口，涵盖初始化、扫描、读写、移动及追加日志等 9 项核心操作。生命周期管理定义了 active、superseded、archived、needs_review 及 pinned 五种状态；其中 archived 状态支持可逆访问，需显式标记方可查看；pinned 状态可豁免自动衰减与覆盖策略。在冲突处理上，确立了人工优先原则：当冲突涉及 pinned 条目、关键决策记录或重要性评分 ≥0.8 的数据时，系统不执行自动覆盖，而是标记为 needs_review 强制触发人工确认。

要点:
1. 在 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中决定 SimpleAIBrain 采用 FileStore 存储层，以目录为地址、Frontmatter 为事实源，主键使用 mem_<ULID> 格式
2. 在 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中定义存储层包含 init/rescan/scanMeta/readBody/upsertEntry/moveEntry/patchMeta/appendLog/iterateByScope 等 9 项操作接口
3. 在 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中确立生命周期五态模型：active/superseded/archived/needs_review/pinned，其中 archived 需显式参数方可访问
4. 在 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中决定 pinned 状态条目跳过自动衰减与覆盖策略，保障关键数据持久性
5. 在 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中确立冲突消解规则：涉及 pinned、决策记录或 importance≥0.8 的条目禁止自动覆盖，必须转为 needs_review 人工确认
6. 在 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中明确 md 文件物理落盘结构为 L1/L2/L3 层级子目录
