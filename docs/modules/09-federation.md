> 上游:[memory-design.md](../memory-design.md) · 状态:文档定稿 2026-10-14 · 实现:⬜(v2 起)

# M09 · 部署拓扑与联邦

## 1. 目标与边界

定义从单人到大团队的部署阶梯,以及跨工作室的读写规则。**v1 只需保证契约不排除本模块**(registerRoutes 已预留);实现从 v2 开始。

## 2. 部署阶梯

| Tier | 形态 | 适用 |
|---|---|---|
| 0 | session_memory.md | 单人/单仓,零设施 |
| 1 | hub + aiBrain(本地图) | 一个工作室全员接入 |
| 2 | 多 hub 各写本地 + 读联邦 | 跨工作室协作 |
| 3 | PgStore | 真多机多写者才需要 |

## 3. 跨工作室规则(定论)

- **只读联邦,不共享写**:跨写会击穿单写者不变量(主文档原则 1)。
- 读:hub 暴露 `/brain/query`;策略裁决在**数据所有方**(hub1 决定给 studio2 看什么,默认仅 scope=studio)。
- 写:显式发布流(PR 式)——studio2 打包候选条目 → studio1 侧确认 → 以 `created_by=import:studio2` 入库;git sync 可做镜像兜底。
- 远程身份:`studio2/alice/builder` 出现在 hub1 → 按联邦 token + 服务方策略裁决;本工作室身份走常规权限。

## 4. /brain/query API 草案(v2)

```
POST /brain/query   (联邦 token)
{ "query": "...", "scope": "studio", "project"?: "...", "limit"?: n }
→ { "results": [{ id, layer, title, body(截断), created_by, updated_at }], "policy": "studio-only" }
```

- hub2 侧插件配置 `remote: { url, token }` → store 换 **RemoteStore**(实现 M02 七操作中的读子集;写操作一律拒绝并提示走发布流)。

## 5. 验收标准(v2 届时)

- [ ] hub2 的 memory.context 能返回 hub1 的 studio 级条目。
- [ ] hub1 对未授权 scope 返回空而非错误(不泄露存在性)。
- [ ] RemoteStore 的写操作全部拒绝。
- [ ] 发布流:打包 → 确认 → 入库,created_by 可追溯。

## 6. 开放问题

- 联邦授权粒度(按 scope?按 project?按 member 白名单)到 Tier 2 实际出现时再定。

---

## 设计稿(M09 第一刀,实现未开始):Tier 1 公共记忆——共识上层,不全员裸读

> 定位:本模块实现的第一片(Tier 1,单工作室多成员)。跨工作室联邦(Tier 2+)不受影响、仍属 v2。动机:多 agent/多人各自演化"我们怎么做"会漂移;会议式共识是最强知识形态(多人佐证、显式确认),值得一个专门的层。

### 1. 原则:共识上浮,不裸读

个人记忆保持作用域隔离;进入公共层的唯一通道是**共识产物**(kind: decision,scope: studio)。不做全员裸读——噪音、越界、检索预算三输。

### 2. 流程(会议纪要的系统翻译)

1. **提案**:会议/讨论后,记录者(agent 或人)提交 digest,`scope: "studio"`、`kind: "decision"`,正文 = 共识 + 已知分歧 + 出处。agent 只有提案权。
2. **冲突检测**:与各成员现有 active 条目矛盾(同题不同结论)→ 全部进 `needs_review`。
3. **人拍板**:member 级身份逐条确认——同意则旧条目 `superseded`(证据链保留,引用链指向共识条目);有理分歧可保留,标 competing。
4. **生效**:共识条目在检索中享受置顶先验(kind: decision × studio 作用域)。**不自动 pin**——过期的共识靠 needs_review 人工推翻,避免"一次开会定终身"。

### 3. 权限与红线

- studio 作用域写入:仅 **member 级身份**(agent 提案 → member 确认,即升层确认动作,扩展现成 review 队列)。
- 个人记忆上浮的唯一途径:本人/本 agent 显式提交提案。
- 覆盖 = supersede + provenance,永不删除。

### 4. 验收标准

模拟三方(两个 agent + 一个 member):A、B 各有同题但结论相反的条目 → 提交 studio 共识提案 → 冲突检测把 A、B 旧条目送 needs_review → member 确认 → 旧条目 superseded 且 source 引用链完整 → 此后 A、B 的 agent 获取记忆时共识条目置顶;guest 不可见 member/agent 层但可见 studio 层(现规则不变)。

### 5. 四问预答

功能:补齐多成员协作的知识共识通道。方便:开会即入账,一句口令/一次提交。稳健:人拍板、证据保留、不自动 pin、提案权与确认权分离。文档:本节 + 主表 M09 行 + 用户指令表加"共识提案"说明。
