> 上游:[memory-design.md](../memory-design.md) · 状态:文档定稿 2026-10-14 · 实现:✅ 0.0.8.0(10 测试,累计 57/57)

# M05 · 巩固(Consolidation)

## 1. 目标与边界

把 L0 的原料提炼成 L1/L2/L3,并执行衰减。**这是记忆质量的作者**:分层、评分、检索都只是搬运工。**边界**:提示词的打磨是实现期第一优先(开放项);本模块定义流程、触发、幂等与失败语义。

## 2. 运行模型

- **单飞锁**:同一时刻至多一个 run(进程内互斥,天然成立)。
- **幂等游标**:每次 run 记 `{run_id, started_at, 阶段游标(处理到哪个 session/文件), 计数}` 于 data/ 下;崩溃重启后从游标续跑,不重复摘要。
- **启动对账**:init 时扫一遍已完成 run 的产物,修复孤儿(如 L2 已写但 L1 状态未标),不依赖 run 是否优雅结束。
- run 结束 → data/ 自动 git commit(消息含 run_id 与计数)。

## 3. 四个转换

| 转换 | 触发(默认) | 输入 | 输出 |
|---|---|---|---|
| 摘要 L0→L1 | 会话结束事件 / 每日定时 | 单个 session 的 jsonl(+可用的提交 digest) | 该会话的 L1 摘要条目 + 候选事实清单 |
| 归并 L1→L2 | 每日定时;同 agent 的未归并 L1 ≥ 5 条 | 同 agent 同主题的 L1 群 | L2 归并条目 / 抽取事实;证据达标的进 L3 候选 |
| 蒸馏 L2→L3 | 随每日 run | 证据达标候选(M03 §4) | 原子 L3 条目(一条一事) |
| 衰减 | 随每日 run | 全量 active 索引 | R 重算;低于地板 → archived |

- 摘要阶段优先消费"提交的 digest"(agent 已给),jsonl 只用来补充细节;两者都无的会话跳过。
- **LLM 失败语义**:callLLM 失败/超时 → 该 session 标记跳过,游标前移,下轮重试;**不阻塞、不重复消费**。每 run 上限 `maxSessionsPerRun`(默认 20)。

## 4. 四段提示词的职责定义(骨架,细节实现期打磨)

1. **抽取**:从会话中提取"发生了什么/决定了什么/学会什么",输出候选事实(原子、带建议 importance、带会话引用)。
2. **去重合并**:输入候选 + 该 scope 现有 L2/L3,输出:合并/新增/无操作;相似条目必须合并并继承 source_ids。
3. **矛盾消解**:按 M03 §5 规则输出 supersede 或 needs_review 动作,并给一句理由。
4. **蒸馏**:把候选压缩为 L3 原子句(一句一事,可独立失效),标注 kind 与建议 importance。

通用约束(写进每段提示词):输出 JSON;事实必须带出处(会话/条目 id);不确定就标注低 importance,宁缺毋滥。

## 5. 与其它模块的接口

- 读:M02(iterateByScope、readBody)、M03(评分/门槛纯函数)。
- 写:M02(upsertEntry/moveEntry/patchMeta)。
- LLM:hub ctx.callLLM(模型/密钥复用 hub 配置)。

## 6. 验收标准

- [x] 构造 3 个 session → run 后产生 3 条 L1,内容含出处引用。
- [x] 幂等:同输入跑两遍,第二遍零新增(游标生效)。
- [x] 崩溃续跑:游标切分两 run 与一次跑完等价;游标文件丢失后由启动对账从条目重建,零重复。
- [x] LLM 失败注入:callLLM 抛错 → session 跳过、run 正常结束、下轮重试成功。
- [x] 矛盾:decision/高优进 needs_review,低优被 supersede(引擎裁定,新条目继承溯源链)。
- [x] run 结束后 data/ 有 git commit(消息含 run_id 与计数)。

## 7. 开放问题

- 提示词的具体措辞与 few-shot;用 stats + 命中日志盲调是禁忌,实现后每周人工抽查(见 M10)。
- "同主题"判定 v1 用标签+人工复核,后续再上聚类。

> 实现(0.0.8.0):\`src/consolidation/\` 两件 —— prompts.ts(四段提示词骨架 + 宽松 JSON 提取,剥围栏取首尾大括号)、consolidator.ts(Consolidator.run:摘要→归并→蒸馏→衰减)。单飞锁(实例布尔);幂等游标 = \`<dataDir>/consolidation-state.json\` 的 processed_spool(hash16→L1 id),**每 session 落盘**;启动对账以 L1 条目 source_ids(前 16 位 hex)为准重建游标——条目是唯一真相。LLM 只提名:conflicts 由引擎 resolveConflict 裁定、蒸馏候选由 promotionVerdict 判定、幻觉 old_id 忽略、无出处不写;LLM 失败按 session 跳过下轮重试,maxSessionsPerRun 封顶。插件接线:init 挂 24h 定时器(unref,schedule=off 关闭)+ POST /brain/consolidate 手动触发;hub /brain/* 路由补 IP 白名单。未做:会话结束事件触发(hub v1 无此钩子)、jsonl 原始日志补充细节(v1 只消费提交的 digest)、提示词打磨(开放项,每周人工抽查)。
