---
schema_version: 1
id: mem_01M592TBW3NBK9MKP6SEK0NVK5
layer: 1
scope: agent
owner:
  member: local
  agent: drillagent
title: SimpleAIBrain 发布守则 v2 关键规则
kind: event
importance: 0.9
stability: 72
access_count: 0
last_access: 2026-10-19T03:20:55.427Z
status: active
pinned: false
superseded_by: null
source_ids:
  - 9ea46277899cfd62
tags: []
created_by: consolidator
created_at: 2026-10-19T03:20:55.427Z
updated_at: 2026-10-19T03:20:55.427Z
body: |-
  会话 drill-s2 记录了 SimpleAIBrain 发布守则 v2 的核心内容。该守则明确了发布前的质量门禁（90项测试）和版本控制策略（主版本号仅限跨模块变更）。特别强调了文档与代码的原子性更新（docs 与 modules 同 commit），以及发布后的观察窗口（24小时内检查 hub 日志）。此外，细节中补充了回滚具体操作为 git revert 后重建，且公告需写入 AGENTS.md 的最后更新行，tmp 目录被禁止入库。

  要点:
  1. 发布前必须跑满 90 项测试 (drill-s2)
  2. 主版本号仅在跨模块行为变更时递增 (drill-s2)
  3. docs 主表与 modules 必须同 commit 更新 (drill-s2)
  4. tmp 目录不入库 (drill-s2)
  5. 发布后 24 小时内观察 hub 日志一次 (drill-s2)
  6. 回滚流程为 git revert 后重新构建 (drill-s2)
  7. 发布公告写进 AGENTS.md 最后更新行 (drill-s2)
---

会话 drill-s2 记录了 SimpleAIBrain 发布守则 v2 的核心内容。该守则明确了发布前的质量门禁（90项测试）和版本控制策略（主版本号仅限跨模块变更）。特别强调了文档与代码的原子性更新（docs 与 modules 同 commit），以及发布后的观察窗口（24小时内检查 hub 日志）。此外，细节中补充了回滚具体操作为 git revert 后重建，且公告需写入 AGENTS.md 的最后更新行，tmp 目录被禁止入库。

要点:
1. 发布前必须跑满 90 项测试 (drill-s2)
2. 主版本号仅在跨模块行为变更时递增 (drill-s2)
3. docs 主表与 modules 必须同 commit 更新 (drill-s2)
4. tmp 目录不入库 (drill-s2)
5. 发布后 24 小时内观察 hub 日志一次 (drill-s2)
6. 回滚流程为 git revert 后重新构建 (drill-s2)
7. 发布公告写进 AGENTS.md 最后更新行 (drill-s2)
