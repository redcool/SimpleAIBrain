# AGENTS.md — SimpleAIBrain 工作区

> 开始任务前阅读本文件。本仓库是 SimpleAIBrain——一个记忆系统的开发仓库,同时是记忆系统的**测试基站**(已登记身份 s1/local/simpleaibrain)。

## 记忆系统使用(每次会话)

1. **会话开始**:从本目录 `.brain.json` 取 token → 调用 hub 的 `memory.context`,**token 作为工具参数 `_brainToken` 传入**(不是 HTTP Bearer 头!)→ 读取已有记忆。可先调 `memory.whoami` 验证身份。注意:不带 token 的访客只能看到 studio 作用域(本基站通常为空)——0 命中不代表没记忆。**不要直接读 `data/memory/` 下的文件当记忆来源**——那是内部存储格式,只有走工具才有正确的可见性与脱敏。
2. **会话结束**:读本目录 `.brain.json` 取 token,调用 `memory.submit_session`,参数:
   - `session_id`:当前会话 id
   - `kind`: "digest"
   - `content`: 本会话的关键决定与新知识(400-1200 字,自带出处,不含密钥)
3. **规则**:`content` 只写决定与结论,不抄流水;密钥、口令、个人隐私一律不入记忆。

## 记忆操作口令(用户手动指令,见到即执行,不要反问)

- 用户说 **"存储记忆"**:立即执行一次会话记忆存储。步骤:读本目录 `.brain.json` 取 token(若无此文件,回答"该工作区未登记,无法存储"并停止)→ 调 `memory.submit_session`,`session_id`=当前会话 id,`kind`="digest",`content`=截至当前的关键决定与新知识(400-1200 字,带出处,不含密钥)。重复执行会生成多个快照,巩固层会归并,属正常。
- 用户说 **"获取记忆"**:立即读取一次工作区记忆。步骤:读 `.brain.json` 取 token → 调 `memory.context`,**token 作为工具参数 `_brainToken` 传入**(查询词=当前任务主题;无明确主题时用"核心架构 决策 规则")→ 把返回的记忆上下文作为已知前提继续任务。若响应带 `note`(访客提示),说明没带对身份,按 note 指引重来。可选附加 `memory.search` 深挖单条。

- 用户说 **"查找记忆"** 或 **"查找记忆 <关键词>"**:立即调 `memory.search`(带 `_brainToken` 参数),逐条列出标题、正文、id、来源;不打断,列完即止。
- 用户说 **"记忆体检"**:立即调 `memory.whoami` + `memory.stats`(带 `_brainToken` 参数),一段话汇报:当前身份、L1/L2/L3 计数、近 7 天检索与命中、上次巩固 run、needs_review 条数。
- 用户说 **"登记记忆"**:检查本目录 `.brain.json`;若已存在,运行 `node H:/ai_works/SimpleAIBrain/scripts/enroll.mjs` 打印现状;若不存在,同命令执行登记(幂等,自动铸造 token)。完成后提示用户"新工作区先获取记忆验证一次"。

> 用户指令全表见 `docs/用户指令.md`(含注意事项与内置自动化说明)。

## 常用工具(hub :45678)

- `memory.context` — 按查询注入记忆上下文(读;agent/member 作用域需 `_brainToken` 参数)
- `memory.whoami` — 验证当前身份与可用工具(读)
- `memory.stats` — 记忆库统计
- `memory.submit_session` — 提交会话摘要(写,需 token)
- `memory.search` / `memory.save` / `memory.edit` — 检索/保存/修订

## 开发纪律(本仓库)

- 版本号 x.y.z.w;z=大功能,w=小改;提交者 simple-brain。
- 每版完成:审核回顾(功能/方便/稳健/文档)四问。
- 临时文件进 `tmp/`;删除移 `.trash/`;同名不覆盖加版本号。
- 设计文档:docs/memory-design.md(主表)+ docs/modules/;决策日志:session_memory.md(追加,不回写)。
