---
schema_version: 1
id: mem_01M592SYGNZ675F0MHD5HD03P8
layer: 1
scope: agent
owner:
  member: local
  agent: drillagent
title: SimpleAIBrain 发布守则 v1 定版
kind: event
importance: 0.8
stability: 72
access_count: 0
last_access: 2026-10-19T03:20:41.748Z
status: active
pinned: false
superseded_by: null
source_ids:
  - 78af90f2c71c7e7f
tags: []
created_by: consolidator
created_at: 2026-10-19T03:20:41.748Z
updated_at: 2026-10-19T03:20:41.748Z
body: |-
  在演练会话 drill-s1 中，确立了 SimpleAIBrain 项目的发布守则 v1 版本。核心规定包括：发布前必须跑满 90 项测试；主版本号仅在跨模块行为变更时递增；文档主表与模块需同 commit 更新；tmp 目录禁止入库；发布后 24 小时内需观察 hub 日志一次。技术细节明确构建命令为 npm run build，测试命令为 node --test，发布标签打在主分支。

  要点:
  1. drill-s1 确定发布前必须跑满 90 项测试
  2. drill-s1 规定主版本号只在跨模块行为变更时递增
  3. drill-s1 要求 docs 主表与 modules 必须同 commit 更新
  4. drill-s1 明确构建命令为 npm run build
  5. drill-s1 明确测试命令为 node --test
  6. drill-s1 规定发布标签打在 main 分支
  7. drill-s1 规定 tmp 目录不入库
  8. drill-s1 要求发布后 24 小时内观察 hub 日志一次
---

在演练会话 drill-s1 中，确立了 SimpleAIBrain 项目的发布守则 v1 版本。核心规定包括：发布前必须跑满 90 项测试；主版本号仅在跨模块行为变更时递增；文档主表与模块需同 commit 更新；tmp 目录禁止入库；发布后 24 小时内需观察 hub 日志一次。技术细节明确构建命令为 npm run build，测试命令为 node --test，发布标签打在主分支。

要点:
1. drill-s1 确定发布前必须跑满 90 项测试
2. drill-s1 规定主版本号只在跨模块行为变更时递增
3. drill-s1 要求 docs 主表与 modules 必须同 commit 更新
4. drill-s1 明确构建命令为 npm run build
5. drill-s1 明确测试命令为 node --test
6. drill-s1 规定发布标签打在 main 分支
7. drill-s1 规定 tmp 目录不入库
8. drill-s1 要求发布后 24 小时内观察 hub 日志一次
