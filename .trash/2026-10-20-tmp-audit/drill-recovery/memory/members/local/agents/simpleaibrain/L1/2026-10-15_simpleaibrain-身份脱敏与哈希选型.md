---
schema_version: 1
id: mem_01M4ZKR3E92Q60E0Z1TKN60741
layer: 1
scope: agent
owner:
  member: local
  agent: simpleaibrain
title: SimpleAIBrain 身份脱敏与哈希选型
kind: event
importance: 0.9
stability: 72
access_count: 0
last_access: 2026-10-15T11:04:22.729Z
status: active
pinned: false
superseded_by: null
source_ids:
  - ea9847a0de7d4a7c
tags: []
created_by: consolidator
created_at: 2026-10-15T11:04:22.729Z
updated_at: 2026-10-16T07:04:07.969Z
body: |-
  在 SimpleAIBrain 系统中，团队明确了持久身份及脱敏��范。身份采用持久 Token 模式，.brain.json 生成 SHA-256 存入 registry，拒绝 MD5 防止暴力枚举；hub 侧缺失凭据则降为只读。强制脱敏范围延伸至“工具参数、会话正文、导入 md”的 3 个环节，其中 LLM 巩固前须调用 redactText。

  要点:
  1. Agent 定义为按工作区持久化的实体，Token 即作为其密码。
  2. .brain.json 自带 32+ 位随机 token，Registry 仅存储 SHA-256 哈希值。
  3. 废弃 MD5 方案：身份串可枚举会导致防投毒机制失效。
  4. 脱敏必须在“工具流水参数、会话正文、导入 md”这三类点强制执行。
  5. 会话正文送 LLM 巩固前，强制调用 redactText 函���完成脱敏。
  6. 危险工具调用仍沿用 hub 既有的配置级门控。
---

在 SimpleAIBrain 系统中，团队明确了持久身份及脱敏��范。身份采用持久 Token 模式，.brain.json 生成 SHA-256 存入 registry，拒绝 MD5 防止暴力枚举；hub 侧缺失凭据则降为只读。强制脱敏范围延伸至“工具参数、会话正文、导入 md”的 3 个环节，其中 LLM 巩固前须调用 redactText。

要点:
1. Agent 定义为按工作区持久化的实体，Token 即作为其密码。
2. .brain.json 自带 32+ 位随机 token，Registry 仅存储 SHA-256 哈希值。
3. 废弃 MD5 方案：身份串可枚举会导致防投毒机制失效。
4. 脱敏必须在“工具流水参数、会话正文、导入 md”这三类点强制执行。
5. 会话正文送 LLM 巩固前，强制调用 redactText 函���完成脱敏。
6. 危险工具调用仍沿用 hub 既有的配置级门控。
