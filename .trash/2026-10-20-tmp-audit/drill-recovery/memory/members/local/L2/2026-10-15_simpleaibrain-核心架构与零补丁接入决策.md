---
schema_version: 1
id: mem_01M4ZKYTW55N07Z6TFA0F4V2V8
layer: 2
scope: member
owner:
  member: local
  agent: ""
title: SimpleAIBrain 核心架构与零补丁接入决策
kind: decision
importance: 0.9
stability: 900
access_count: 5
last_access: 2026-10-19T02:49:10.628Z
status: active
pinned: false
superseded_by: null
source_ids:
  - mem_01M4ZGYBN6WTDV4H86S9J6P7YQ
  - mem_01M4ZKQJ0M1DPTKXYFQ6GJ05YS
tags: []
created_by: consolidator
created_at: 2026-10-15T11:08:03.332Z
updated_at: 2026-10-19T02:50:10.657Z
body: 确立 SimpleAIBrain 零补丁 watcher 机制，通过内置 zlib 解码 zstd 分帧实现 DSH 接入，严禁修改 node_modules。系统采用 opt-in 机制，仅当工作区存在 .brain.json 时启用，Hook 便签经 POST /brain/ingest 进 L0，默认 10 分钟超时。来源：mem_01M4ZGYBN6WTDV4H86S9J6P7YQ, mem_01M4ZKQJ0M1DPTKXYFQ6GJ05YS
---

确立 SimpleAIBrain 零补丁 watcher 机制，通过内置 zlib 解码 zstd 分帧实现 DSH 接入，严禁修改 node_modules。系统采用 opt-in 机制，仅当工作区存在 .brain.json 时启用，Hook 便签经 POST /brain/ingest 进 L0，默认 10 分钟超时。来源：mem_01M4ZGYBN6WTDV4H86S9J6P7YQ, mem_01M4ZKQJ0M1DPTKXYFQ6GJ05YS
