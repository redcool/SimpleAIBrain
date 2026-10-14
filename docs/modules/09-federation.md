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
