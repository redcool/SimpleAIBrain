> 上游:[memory-design.md](../memory-design.md) · 状态:文档定稿 2026-10-14 · 实现:✅ 0.0.2.0(11/11 测试)

# M02 · 存储层(MemoryStore + 文件后端)

## 1. 目标与边界

定义记忆的**唯一持久化接口**与 v1 文件后端。上层(模型/检索/巩固)只认接口,不认文件。**边界**:不含评分与升层逻辑(那在 M03);不含摄入格式解析(在 M06)。

## 2. MemoryStore 接口(七操作,由用点推导)

```ts
interface MemoryStore {
  scanMeta(): AsyncIterable<EntryMeta>;                    // 启动建索引(只读 frontmatter)
  readBody(id: string): Promise<string>;                   // 命中后读正文
  upsertEntry(entry: Entry): Promise<string>;              // 写/更新条目,返回 id
  moveEntry(id: string, toLayer: 1 | 2 | 3): Promise<void>;// 升层 = git mv
  patchMeta(id: string, patch: Partial<EntryMeta>): Promise<void>; // status/access_count/...
  appendLog(rec: L0Record): Promise<void>;                 // L0 JSONL 追加
  iterateByScope(q: ScopeQuery): AsyncIterable<Entry>;     // 巩固任务按 scope 批量迭代
}
```

v3 的 PgStore 实现同一签名。**接口双后端,实现单后端。**

> 实现(0.0.2.0):`src/store/file-store.ts` FileStore。接口之外补充:`init()`(建目录+清 tmp+全量重扫)、`rescan()`、`getQuarantined()`;生命周期约定:启动 init,fs.watch 增量失效,每 5 分钟 rescan 兜底。moveEntry 以"写新+删旧"实现,git 依内容相似度识别 rename,历史不丢。运行时依赖仅 `yaml`。

## 3. 目录布局(owner 优先;frontmatter 是事实源,目录可重组)

```
data/memory/
  studio/L3/                                  # 全组共享
  members/<member>/
    L3/
    agents/<agent_label>/
      L1/  2026-10-14_s47-digest.md
      L2/
      L3/
  L0-log/2026-10/<agent_label>.jsonl          # 被动流水+会话日志,按天滚动
  _spool/                                     # hook 便签(M06)
  _quarantine/                                # frontmatter 解析失败隔离区
  recall-log/                                 # 检索命中日志(M10)
```

文件命名:`YYYY-MM-DD_<slug>.md`,slug 取标题小写连字符;id 冲突时追加短随机后缀。

## 4. frontmatter 规范(schema_version: 1)

| 字段 | 类型 | 约束/默认 |
|---|---|---|
| schema_version | int | 1 |
| id | string | `mem_<ULID>`,全局唯一 |
| title | string | 条目标题;缺省取正文首行(≤60 字符);决定文件 slug(实现期补充) |
| layer | 1\|2\|3 | 与目录一致,目录为准 |
| scope | enum | session\|agent\|member\|studio |
| owner | object | { member, agent? };studio 级可空 |
| project | string | 数据标签,可空;**不进身份** |
| kind | enum | fact\|preference\|event\|procedure\|decision |
| importance | float | 0~1,默认 0.5 |
| stability | float | S,默认 1.0,随访问增强 |
| access_count | int | 默认 0 |
| last_access | ISO8601 | 默认 = created_at |
| status | enum | active\|superseded\|archived\|needs_review |
| superseded_by | string\|null | |
| source_ids | string[] | 溯源链(mem_/sess_/log_ 前缀) |
| created_by | string | consolidation\|<member_id>\|agent:<id>\|import |
| created_at / updated_at | ISO8601 | UTC |

正文:条目内容。L3 **一条一事**,不写叙事。

## 5. 文件操作规范

- **原子写**:一律 temp 文件 + rename;禁止就地覆写。
- **升层**:`git mv` 保历史;move 后 patchMeta.layer。
- **patchMeta**:读-改-原子写;access_count 这类高频更新**防抖合批**(每 60s 或 shutdown 时落盘)。
- **索引**:启动全量 scanMeta;fs.watch 增量失效;**每 5 分钟全量重扫**兜底(Windows fs.watch 会丢事件);每次巩固 run 前强制重扫。
- **隔离区**:frontmatter 解析失败(多为手改损坏)→ 原文件移入 _quarantine/,在 review 汇总中报告;不静默丢弃,不改写用户文件。
- **L0Record**(JSONL 一行):`{ ts, harness, agent_label, kind: toolflow|session|digest, session_id?, tool?, digest?(截断), hash }`。
- **保留策略**:L0 月度包被巩固消化后压缩归档,90 天可删;L1-L3 archived 条目不删,历史归 git。
- **git**:`data/` 是**独立 git 仓库**(不入 SimpleAIBrain 主仓库);每次巩固 run 结束自动 commit(消息含 run_id 与计数);人工直改产生的 diff 天然可审。

## 6. Windows 注意

长路径(>260 字符)避免——目录浅、slug 短;不信任 mtime;rename 原子性依赖同卷 temp 文件。

## 7. 验收标准

- [x] 七操作单测全绿(临时 data 目录;11/11:含 CJK、scope 路径、同名不覆盖、L0 追加、patch 白名单)。
- [x] 崩溃模拟:temp 残留被扫描忽略、init 清理,索引无半截文件(temp+rename 结构保证)。
- [x] 手工放一个坏 YAML 文件 → 进 _quarantine,索引数量正确,服务不崩。
- [x] fs.watch 被禁用(模拟)→ rescan() 捕获外部新增文件;周期重扫调度随 M05 巩固接线。
- [ ] 巩固 run 结束 → data/ 自动出现一个 commit。(gitCommitIfRepo 已单测;自动 commit 随 M05 验证)
- [x] 同一 id upsert 两次 → 不产生重复文件。
