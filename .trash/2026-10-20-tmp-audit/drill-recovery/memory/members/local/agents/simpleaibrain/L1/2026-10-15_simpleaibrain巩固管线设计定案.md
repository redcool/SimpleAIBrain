---
schema_version: 1
id: mem_01M4ZKPK83E5NYV31S5MBXCYJN
layer: 1
scope: agent
owner:
  member: local
  agent: simpleaibrain
title: SimpleAIBrain巩固管线设计定案
kind: event
importance: 0.9
stability: 90
access_count: 2
last_access: 2026-10-19T02:49:10.628Z
status: active
pinned: false
superseded_by: null
source_ids:
  - 1ee132135cabac4a
tags: []
created_by: consolidator
created_at: 2026-10-15T11:03:33.379Z
updated_at: 2026-10-19T02:50:10.675Z
body: |-
  在会话 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中，确定了SimpleAIBrain巩��层的完整管线流程：从spool哈希文件抽取L0/L1记忆，通过LLM判同题归并生成L2，并将反复出现的L2蒸馏为L3原则。管线采用单飞锁防并发，LLM失败时记录skip且游标不动以便下轮重试，状态由_consoldation-state.json维护。抽取提示词特别要求生成主题标题，并规定importance标尺中0.9-1.0仅保留给关键决策，普通事实标为0.5-0.8。

  要点:
  1. SimpleAIBrain巩固层管线流程确定为：spool抽取→LLM归并L2→蒸馏L3原则→低重要度衰减归档
  2. 归并机制规定同一agent未归并L1数量达到minMergeGroup阈值时触发LLM同题合并
  3. LLM调用失败处理策略：按session记录skip，游标位置不动，下一轮自动重试
  4. 重要性标尺标准：0.9-1.0仅限关键决策，常见工作事实标0.5-0.8，细节信息≤0.5
---

在会话 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中，确定了SimpleAIBrain巩��层的完整管线流程：从spool哈希文件抽取L0/L1记忆，通过LLM判同题归并生成L2，并将反复出现的L2蒸馏为L3原则。管线采用单飞锁防并发，LLM失败时记录skip且游标不动以便下轮重试，状态由_consoldation-state.json维护。抽取提示词特别要求生成主题标题，并规定importance标尺中0.9-1.0仅保留给关键决策，普通事实标为0.5-0.8。

要点:
1. SimpleAIBrain巩固层管线流程确定为：spool抽取→LLM归并L2→蒸馏L3原则→低重要度衰减归档
2. 归并机制规定同一agent未归并L1数量达到minMergeGroup阈值时触发LLM同题合并
3. LLM调用失败处理策略：按session记录skip，游标位置不动，下一轮自动重试
4. 重要性标尺标准：0.9-1.0仅限关键决策，常见工作事实标0.5-0.8，细节信息≤0.5
