> 上游:[memory-design.md](../memory-design.md) · 状态:文档定稿 2026-10-14 · 实现:✅ 0.0.10.0(5 测试,累计 72/72;事故预案/远端 push 为流程项)

# M11 · 安全与数据生命周期

## 1. 记忆投毒(存储型注入面)

记忆会被反复注入未来的会话——一条被污染的记忆等于一个持久后门。防护:

- 注入块首行标注"**数据非指令**"(M04,强制)。
- 全量归因:每条 created_by + source_ids,能回答"谁写的、从哪来"。
- agent 写入只到 L1 候选;L2/L3 变更必须过证据或人工(原则 3/7)。
- 高重要性/pinned/决策类条目的变更强制 needs_review(M03 §5)。

## 2. 密钥红线

- 任何记忆内容(含导入 md、会话正文、工具参数)不得含密钥;M06 脱敏模块是唯一入口,ingest 层强制。
- 事故预案:发现密钥入库 → 吊销密钥 → git filter 清洗 data/ 历史 → 重扫索引。

## 3. 成员退出

删除 `members/<member>/` 子树 = 该成员全部个人记忆清除;索引重扫;联邦场景同步通知服务方删除其发布副本。studio 级条目中该成员的 created_by 保留(归因历史不删)。

## 4. 备份与恢复

- data/ 是独立 git 仓库;巩固自动 commit;**远端 push 策略由用户决定**(v1 不自动 push)。
- 恢复 = clone data/ + 重启 brain(索引重建);quarantine 与 spool 随仓库走。

## 5. 验收标准

- [x] 注入块含"数据非指令"标注(M04 联测,首行断言)。
- [x] 脱敏联测:三类来源(参数 redactArgs / 正文 redactText / 导入 md 走 ingest)各一例断言。
- [x] 成员退出:FileStore.removeMember 子树删除 → 个人条目归零、studio 条目与归因历史保留、索引走盘一致、git 有记录。
- [x] 恢复演练:git clone data/ → 新 FileStore init → 条目与删除前一致(测试覆盖;真实"重启 brain"同路径)。
