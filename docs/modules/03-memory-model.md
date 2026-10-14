> 上游:[memory-design.md](../memory-design.md) · 状态:文档定稿 2026-10-14 · 实现:✅ 0.0.3.0(9 测试)

# M03 · 记忆模型(分层 · 存活 · 升层 · 冲突)

## 1. 目标与边界

定义记忆条目的**生命周期规则**:分层含义、存活评分、升层证据、冲突消解。**边界**:不管数据怎么存(M02)、怎么被检索(M04)、什么时候跑(M05)。本模块是纯规则层,应可独立单测。

## 2. 分层定义

| 层 | 内容 | 来源 | 写权限 |
|---|---|---|---|
| L0 | 工具流水 + 完整会话日志(JSONL) | 摄入/被动记录 | 系统自动 |
| L1 | 会话摘要,每会话一份 | 巩固自 L0 / 提交的 digest(agent 亦可直接 save 为 L1) | **自由**(agent token 即可) |
| L2 | 主题/项目级归并 + 抽取事实 | 巩固自 L1 | **受限**(证据门槛) |
| L3 | 原子化单事实 | L2 升层 / 人工写入 / 导入 | **受限**(证据或人工) |

**写入自由(短期),升层受限(长期)**——原则 3 的落地。

## 3. 存活评分(艾宾浩斯)

```
R = importance · e^(−Δt / S)      Δt = now − last_access(小时)
访问增强:S ← S · (1 + k)          k = 0.25(默认,可配)
地板值:R < 0.15(默认)→ status = archived
衰减扫描:随每日巩固 run 执行;不单独起任务
```

- 检索命中即复习:命中注入的条目 access_count+1、last_access=now、S 增强(M04 触发,本模块提供纯函数)。
- **archived 可逆**:显式搜索(带 `includeArchived`)可命中;恢复 = patchMeta 回 active。
- pinned 条目:跳过衰减扫描,不被自动 supersede(只能人工解除)。

> 实现(0.0.3.0):`src/model/scoring.ts`(recallScore/strengthen/decaySweep 纯函数)+ `src/model/lifecycle.ts`(状态机表/证据判定/冲突判定/溯源继承)。pin 落地为 frontmatter 字段 `pinned: boolean`(缺省 false,patchMeta 可改)——已回写 M02 §4 表。默认参数 k=0.25、地板 0.15 以 `DEFAULTS` 常量暴露,待校准。

## 4. 升层证据(时间只用于衰减,不用于升层)

| 目标层 | 证据门槛(满足其一) |
|---|---|
| L1→L2 | 同主题 L1 归并;或单条 L1:跨 ≥2 会话被命中且 access_count ≥ 3 |
| L2→L3 | 跨 ≥3 会话命中;或 importance ≥ 0.8 且被 ≥2 个不同会话引用;或 pin |

- 证据是**输入**,巩固任务(M05)是**决策者**:证据达标者进入候选集,由 LLM 提炼 + 规则复核后写入。
- 人工写入 L3 永远合法(跳过证据门槛,created_by 记人工)。

## 5. 冲突消解(supersede 与 needs_review)

| 新信息 vs 旧条目 | 规则 |
|---|---|
| 旧条目为普通 L2/L3(importance < 0.8 且未 pin) | 自动 supersede:旧条目 `status=superseded, superseded_by=<新id>`;新条目 source_ids 继承旧条目的溯源链 |
| 旧条目 importance ≥ 0.8、pinned、或 kind=decision | **不自动覆盖** → 新条目暂存 `needs_review`,等用户裁决(裁决结果:接受新/保留旧/改写) |
| 同主题两 agent 各写一条矛盾条目 | 巩固时发现 → 后到者进 needs_review |

supersede **不删除**:旧条目保留原文与 frontmatter,仅状态变化——遗忘靠 archived,更替靠 superseded,两者都不毁证据。

## 6. 条目状态机

```
active ──(巩固/人工)──▶ superseded ──▶ (终态,只读)
   ├──(R<地板)──▶ archived ──(显式恢复)──▶ active
   ├──(冲突高优)──▶ needs_review ──(裁决)──▶ active | superseded | archived
   └──(pin)──▶ 跳过衰减与自动覆盖
```

## 7. 验收标准

- [x] 评分纯函数单测:Δt/S/k 各维度边界(Δt=0、S→∞、k=0)。
- [x] 状态机:每个转移一条单测;非法转移(如 superseded → active)被拒绝。
- [x] 证据门槛:构造访问统计,验证达标/不达标判定(L1→L2 两路径、L2→L3 三路径、L3 拒绝)。
- [x] 冲突:低优自动 supersede、高优进 needs_review,两条路径各一测。
- [x] pin 生效:衰减扫描跳过 pinned(含 FileStore 集成测试)。

## 8. 开放问题

- k、地板值、importance 阈值的默认值是拍的,开跑两周后按 stats 校准。
