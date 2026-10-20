---
schema_version: 1
id: mem_01M4ZKQJ0M1DPTKXYFQ6GJ05YS
layer: 1
scope: agent
owner:
  member: local
  agent: simpleaibrain
title: SimpleAIBrain 摄入层与 DSH 通道架构决策
kind: event
importance: 0.9
stability: 72
access_count: 0
last_access: 2026-10-15T11:04:04.884Z
status: active
pinned: false
superseded_by: null
source_ids:
  - db0dbb67c1a17148
tags: []
created_by: consolidator
created_at: 2026-10-15T11:04:04.884Z
updated_at: 2026-10-16T07:04:07.965Z
body: |-
  会话 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 确定了 SimpleAIBrain ��摄入机制。Hook 便签通过 POST /brain/ingest 直接进入 L0 层。DSH 会话采用零补丁 watcher 方案，通过 zstd 分帧追加和 node:zlib 解码实现数据摄入，且不修改 node_modules。系统设置了默认 10 分钟的空闲闸门以防止摄入活跃会话，并通过文件字节 hash 确保 manifest 幂等性。摄入策略为 opt-in 模式，仅当工作区存在 .brain.json 时生效，且默认忽略 no_brain 前缀的会话。撤回机制规定：会话删除将触发 spool 清理及 L0 物理删除；对于引用链失效的条目，L1 层直接归档，而 L2 及以上或高重要度条目需标记为 needs_review 以人工复核；若源目录不可达，系统选择不执行撤回操作。

  要点:
  1. Hook 便签经 POST /brain/ingest 直接进 L0 层
  2. DSH 会话使用零补丁 watcher，通过 zstd 分帧追加并用 node:zlib 内置解码，不修改 node_modules
  3. 设置默认 10 分钟空闲闸门，防止摄入活跃会话
  4. Manifest 按文件字节 hash 实现幂等性
  5. 摄入采用 opt-in 模式，仅当工作区存在 .brain.json 时生效，且 ignore_session_prefix 默认为 no_brain
  6. 会话删除时执行 spool 清理及 L0 物理删除
  7. 引用链全灭的条目中，L1 层直接归档，L2+ 或 pinned/decision/高重要度条目标记为 needs_review
  8. 若源目录不可达，系统选择不执行撤回操作
---

会话 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 确定了 SimpleAIBrain ��摄入机制。Hook 便签通过 POST /brain/ingest 直接进入 L0 层。DSH 会话采用零补丁 watcher 方案，通过 zstd 分帧追加和 node:zlib 解码实现数据摄入，且不修改 node_modules。系统设置了默认 10 分钟的空闲闸门以防止摄入活跃会话，并通过文件字节 hash 确保 manifest 幂等性。摄入策略为 opt-in 模式，仅当工作区存在 .brain.json 时生效，且默认忽略 no_brain 前缀的会话。撤回机制规定：会话删除将触发 spool 清理及 L0 物理删除；对于引用链失效的条目，L1 层直接归档，而 L2 及以上或高重要度条目需标记为 needs_review 以人工复核；若源目录不可达，系统选择不执行撤回操作。

要点:
1. Hook 便签经 POST /brain/ingest 直接进 L0 层
2. DSH 会话使用零补丁 watcher，通过 zstd 分帧追加并用 node:zlib 内置解码，不修改 node_modules
3. 设置默认 10 分钟空闲闸门，防止摄入活跃会话
4. Manifest 按文件字节 hash 实现幂等性
5. 摄入采用 opt-in 模式，仅当工作区存在 .brain.json 时生效，且 ignore_session_prefix 默认为 no_brain
6. 会话删除时执行 spool 清理及 L0 物理删除
7. 引用链全灭的条目中，L1 层直接归档，L2+ 或 pinned/decision/高重要度条目标记为 needs_review
8. 若源目录不可达，系统选择不执行撤回操作
