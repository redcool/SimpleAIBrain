---
schema_version: 1
id: mem_01M592TZZ1HX2FZKFXRMZV5JNQ
layer: 2
scope: member
owner:
  member: local
  agent: ""
title: SimpleAIBrain发布守则V3定版
kind: decision
importance: 0.8
stability: 720
access_count: 0
last_access: 2026-10-19T03:21:16.001Z
status: active
pinned: false
superseded_by: null
source_ids:
  - mem_01M592SYGNZ675F0MHD5HD03P8
  - mem_01M592TBW3NBK9MKP6SEK0NVK5
  - mem_01M592TGD2535243J5AQSHGZQW
tags: []
created_by: consolidator
created_at: 2026-10-19T03:21:16.001Z
updated_at: 2026-10-19T03:21:16.001Z
body: 在演练会话drill-s3中确立SimpleAIBrain发布守则V3定版。核心规定：发布前必须完整运行90项测试；主版本号仅在跨模块行为变更时递增；文档主表（docs）与模块（modules）必须在同一commit中原子性更新；tmp目录禁止入库；发布后24小时内需观察hub日志一次。补充细节：发布检查清单由M03主表生成；健康检查端点为/brain/health；回滚操作为git revert后重建，且公告需写入AGENTS。此前v1和v2版本中的对应规则（如测试数、版本策略、原子更新等）已被v3包含或迭代。来源：[mem_01M592SYGNZ675F0MHD5HD03P8], [mem_01M592TBW3NBK9MKP6SEK0NVK5], [mem_01M592TGD2535243J5AQSHGZQW]。
---

在演练会话drill-s3中确立SimpleAIBrain发布守则V3定版。核心规定：发布前必须完整运行90项测试；主版本号仅在跨模块行为变更时递增；文档主表（docs）与模块（modules）必须在同一commit中原子性更新；tmp目录禁止入库；发布后24小时内需观察hub日志一次。补充细节：发布检查清单由M03主表生成；健康检查端点为/brain/health；回滚操作为git revert后重建，且公告需写入AGENTS。此前v1和v2版本中的对应规则（如测试数、版本策略、原子更新等）已被v3包含或迭代。来源：[mem_01M592SYGNZ675F0MHD5HD03P8], [mem_01M592TBW3NBK9MKP6SEK0NVK5], [mem_01M592TGD2535243J5AQSHGZQW]。
