---
schema_version: 1
id: mem_01M4ZKYTWDW2H54VPJJXMZ7G2J
layer: 2
scope: member
owner:
  member: local
  agent: ""
title: SimpleAIBrain 检索预算、注入顺序与脱敏规范
kind: decision
importance: 0.9
stability: 720
access_count: 3
last_access: 2026-10-16T05:42:14.499Z
status: active
pinned: false
superseded_by: null
source_ids:
  - mem_01M4ZKQ96HBCCQ7927EGHATNNS
  - mem_01M4ZKR3E92Q60E0Z1TKN60741
tags: []
created_by: consolidator
created_at: 2026-10-15T11:08:03.341Z
updated_at: 2026-10-16T07:04:07.982Z
body: 检索层以 4000 字符为默认预算切块注入，遵循 L3 原则优先、L2 知识、L1 近事排序，综合考量重要性（importance）与近期访问。强制脱敏覆盖工具参数、会话正文、导入 md 三环节，LLM 巩固前必须调用 redactText；身份采用 SHA-256 存入 registry，拒绝 MD5 防暴力枚举。来源：mem_01M4ZKQ96HBCCQ7927EGHATNNS, mem_01M4ZKR3E92Q60E0Z1TKN60741
---

检索层以 4000 字符为默认预算切块注入，遵循 L3 原则优先、L2 知识、L1 近事排序，综合考量重要性（importance）与近期访问。强制脱敏覆盖工具参数、会话正文、导入 md 三环节，LLM 巩固前必须调用 redactText；身份采用 SHA-256 存入 registry，拒绝 MD5 防暴力枚举。来源：mem_01M4ZKQ96HBCCQ7927EGHATNNS, mem_01M4ZKR3E92Q60E0Z1TKN60741
