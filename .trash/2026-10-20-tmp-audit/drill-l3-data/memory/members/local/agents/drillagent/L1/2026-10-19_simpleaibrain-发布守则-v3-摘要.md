---
schema_version: 1
id: mem_01M592TGD2535243J5AQSHGZQW
layer: 1
scope: agent
owner:
  member: local
  agent: drillagent
title: SimpleAIBrain 发布守则 v3 摘要
kind: event
importance: 0.9
stability: 72
access_count: 0
last_access: 2026-10-19T03:21:00.066Z
status: active
pinned: false
superseded_by: null
source_ids:
  - baec5cd2e3e0e1e0
tags: []
created_by: consolidator
created_at: 2026-10-19T03:21:00.066Z
updated_at: 2026-10-19T03:21:00.066Z
body: |-
  在演练会话 drill-s3 中，针对 SimpleAIBrain 确立了发布守则版本 v3。核心规定包括：发布前必须完整运行 90 项测试；主版本号仅在跨模块行为变更时递增；docs 主表与 modules 必须在同一 commit 中更新；tmp 目录禁止入库；发布后 24 小时内需观察一次 hub 日志。此外明确发布检查清单由 M03 主表生成，健康检查端点为 /brain/health。

  要点:
  1. 发布前必须跑满 90 项测试
  2. 主版本号只在跨模块行为变更时递增
  3. docs 主表与 modules 必须同 commit 更新
  4. tmp 目录不入库
  5. 发布后 24 小时内观察 hub 日志一次
  6. 发布检查清单由 M03 主表生成
  7. 健康检查端点是 /brain/health
---

在演练会话 drill-s3 中，针对 SimpleAIBrain 确立了发布守则版本 v3。核心规定包括：发布前必须完整运行 90 项测试；主版本号仅在跨模块行为变更时递增；docs 主表与 modules 必须在同一 commit 中更新；tmp 目录禁止入库；发布后 24 小时内需观察一次 hub 日志。此外明确发布检查清单由 M03 主表生成，健康检查端点为 /brain/health。

要点:
1. 发布前必须跑满 90 项测试
2. 主版本号只在跨模块行为变更时递增
3. docs 主表与 modules 必须同 commit 更新
4. tmp 目录不入库
5. 发布后 24 小时内观察 hub 日志一次
6. 发布检查清单由 M03 主表生成
7. 健康检查端点是 /brain/health
