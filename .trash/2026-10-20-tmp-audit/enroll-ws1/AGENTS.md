

## 记忆系统使用(由 enroll.mjs 生成,0.0.13.11)



> 开始任务前:读本目录 `.brain.json` 取 token → 调用 hub(127.0.0.1:45678)的 `memory.context`,**token 作为工具参数 `_brainToken` 传入**(不是 HTTP Bearer 头)。可先 `memory.whoami` 验证身份。不带 token = 访客,只看 studio 作用域,0 命中不代表没记忆。

> 会话结束(或用户说"存储记忆"):调 `memory.submit_session`,`session_id`=当前会话 id,`kind`="digest",`content`=本会话关键决定与新知识(400-1200 字,带出处,不含密钥)。

> 用户口令全表(存储记忆/获取记忆/查找记忆/记忆体检/登记记忆):H:/ai_works/SimpleAIBrain/docs/用户指令.md。

> 不要直接读记忆库数据文件当记忆来源——只有走工具才有正确的可见性与脱敏。

