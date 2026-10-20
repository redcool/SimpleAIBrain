---
schema_version: 1
id: mem_01M4ZKYTWTNSP7JY97D8BT2G6X
layer: 2
scope: member
owner:
  member: local
  agent: ""
title: SimpleAIBrain 巩固管线流程与状态机维护
kind: decision
importance: 0.8
stability: 720
access_count: 3
last_access: 2026-10-16T05:42:14.499Z
status: active
pinned: false
superseded_by: null
source_ids:
  - mem_01M4ZKPK83E5NYV31S5MBXCYJN
tags: []
created_by: consolidator
created_at: 2026-10-15T11:08:03.354Z
updated_at: 2026-10-16T07:04:07.979Z
body: 固化巩固管线流程：从 spool 哈希文件抽取 L0/L1 记忆，LLM 判同归并生成 L2，反复出现的 L2 蒸馏为 L3 原则。管线采用单飞锁防并发，LLM 失败时记录 skip 且游标不动，便于下轮重试，状态由 _consolidation-state.json 维护。来源：mem_01M4ZKPK83E5NYV31S5MBXCYJN
---

固化巩固管线流程：从 spool 哈希文件抽取 L0/L1 记忆，LLM 判同归并生成 L2，反复出现的 L2 蒸馏为 L3 原则。管线采用单飞锁防并发，LLM 失败时记录 skip 且游标不动，便于下轮重试，状态由 _consolidation-state.json 维护。来源：mem_01M4ZKPK83E5NYV31S5MBXCYJN
