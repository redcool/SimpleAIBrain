# AGENTS.md — SimpleAIBrain 工作区

> 开始任务前阅读本文件。本仓库是 SimpleAIBrain——一个记忆系统的开发仓库,同时是记忆系统的**测试基站**(已登记身份 s1/local/simpleaibrain)。

## 记忆系统使用(每次会话)

1. **会话开始**:调用 hub 的 `memory.context`(查询与任务相关的关键词),读取已有记忆。不需要 token——访客只读即可查。
2. **会话结束**:读本目录 `.brain.json` 取 token,调用 `memory.submit_session`,参数:
   - `session_id`:当前会话 id
   - `kind`: "digest"
   - `content`: 本会话的关键决定与新知识(400-1200 字,自带出处,不含密钥)
3. **规则**:`content` 只写决定与结论,不抄流水;密钥、口令、个人隐私一律不入记忆。

## 常用工具(hub :45678)

- `memory.context` — 按查询注入记忆上下文(读)
- `memory.stats` — 记忆库统计
- `memory.submit_session` — 提交会话摘要(写,需 token)
- `memory.search` / `memory.save` / `memory.edit` — 检索/保存/修订

## 开发纪律(本仓库)

- 版本号 x.y.z.w;z=大功能,w=小改;提交者 simple-brain。
- 每版完成:审核回顾(功能/方便/稳健/文档)四问。
- 临时文件进 `tmp/`;删除移 `.trash/`;同名不覆盖加版本号。
- 设计文档:docs/memory-design.md(主表)+ docs/modules/;决策日志:session_memory.md(追加,不回写)。
