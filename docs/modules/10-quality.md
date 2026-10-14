> 上游:[memory-design.md](../memory-design.md) · 状态:文档定稿 2026-10-14 · 实现:✅ 0.0.10.0(4 测试,累计 72/72)

# M10 · 质量与观测

## 1. 目标与边界

回答一个问题:**"简单有效"的"有效"如何被证明?** 没有度量,巩固提示词就是盲调。**边界**:只做记录与汇总,不做自动调参。

## 2. 三个度量出口

1. **memory.stats**(工具,M08):各层条数、scope 分布、archived/superseded/needs_review 计数、近 7 天检索命中率、巩固 run 历史摘要。
2. **recall-log**(M04 写,M02 存):每次检索命中的 id 清单 + query 摘要 + 身份。是人工抽查"注入质量"的原料。
3. **review 每日汇总**:每次巩固 run 结束,把 needs_review 队列与 _quarantine 事件汇总输出到 hub 可见日志(无出口的队列等于不存在;GUI 化是 v3)。

## 3. 建议的例行流程(人肉,但固定)

- 每周一次:抽 10 条最近命中的 L1/L2 注入 → 读原文对照 → 记"该命中/不该命中/缺了什么"。
- 每月一次:stats 趋势(L3 增速、archived 比例、命中率)→ 校准 M03 的 k/地板/阈值与 M05 预算。

## 4. 验收标准

- [x] stats 在空库/满库都返回合法 JSON(v0.0.10 起:L1-3 + status + scopes + quarantined + recall_7d + consolidation.last_run)。
- [x] recall-log 每行可回放:拿 id 能在索引里找到条目(含 superseded 历任)。
- [x] 巩固 run 结束 → 日志出现 review 汇总段('[ai-brain] review summary …: needs_review=N quarantined=M')。
- [x] 命中日志本身不进记忆:recall-log 在 SKIP_DIRS,自指排除(测试:塞伪条目文件 → stats 不变)。
