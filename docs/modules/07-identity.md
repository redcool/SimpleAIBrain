> 上游:[memory-design.md](../memory-design.md) · 状态:文档定稿 2026-10-14 · 实现:✅ 0.0.4.0(7 测试)

# M07 · 身份与权限

## 1. 目标与边界

让每次记忆访问都可回答"**谁**在调用",并据此执行权限闸门。责任归属的技术表达:AI 无法负责,用户可以。**边界**:token 的传输安全复用 hub 现有机制;联邦授权细节见 M09。

## 2. 身份 ID 与凭证 token 分离(核心定论)

- **身份 ID(明文,可读,全局唯一)**:`<studio>/<member>/<agent_label>`
  - 字符集 `[a-z0-9-_.]`,统一小写规范化;agent_label 自由命名,harness 名可作其一部分或标签(如 `builder@claude-code`,故 agent_label 额外允许 `@`)。
  - 全局唯一 = 跨工作室不冲突(studio 前缀保证)。
- **凭证 token(随机 32 字节)**:hub 端仅存 **SHA-256 哈希**映射表(ID → hash)。
  - **绝不用字段拼接当 token**——可猜即可伪造。
  - 吊销/轮换:删映射或换 token,ID 不变(记忆归属不受影响)。
- **project 不进身份**:身份答"谁在调用";project 是每次操作的**数据标签**。同一 member 换项目,member 级记忆跟随。

## 3. 身份来源与解析流程

```
每个项目放 .brain.json:
{ "studio": "studio1", "member": "alice", "agent_label": "builder@claude-code", "token": "<随机>" }

连接/请求 → 携带 token(hook 提交、工具调用参数、或 HTTP header)
        → hub 查哈希映射 → Identity{studio, member, agent_label}
        → 查不到/未带 → Identity = null(只读访客)
```

- 映射表维护:hub config 或独立 tokens 文件(hub 侧管理,非 brain 职责);brain 的 callTool/id 参数由 hub 填好传入。
- `memory.whoami`:调试用,返回当前解析出的身份与权限集。

### 3.1 enroll:一条命令完成登记(0.0.12.0)

用户**永远不手搓随机数**——token 由记忆系统生成(crypto.randomBytes(32),等同 agent 的 apikey,由用户妥善保存 .brain.json):

```bash
node H:/ai_works/SimpleAIBrain/scripts/enroll.mjs <工作区目录> [--studio s1] [--member local] [--agent <名>] [--data-dir <hub data>]
```

- 签发随机 token → 登记 TokenRegistry(<data>/memory/_identity/tokens.json,存哈希)→ 写 .brain.json
- 已登记再跑:只打印现况不改任何东西;--force 换发新 token(rotate,身份不变);hub 运行中登记需重启后生效
- 工作区策略字段 "ignore_session_prefix": "no_brain"(M06):会话标题命中前缀 → 永不摄入;置空串关闭
- **opt-in 语义(0.0.12.0)**:有 .brain.json 才进记忆;没有(或删除)= 停止新增,不抹历史(清除走 M11)

## 4. 权限矩阵

| 操作 | agent token | member token | 访客(null) |
|---|---|---|---|
| memory.save / search / context / submit_session | ✅ | ✅ | 只读 search/context |
| memory.stats | ✅ | ✅ | ❌ |
| memory.whoami | ✅ | ✅ | ✅(调试;M08 §2 "全部"裁定,0.0.5.0) |
| memory.review_list(裁决动作) | ❌ | ✅ | ❌ |
| memory.edit(edit/pin/unpin/forget/restore) | ❌ | ✅ | ❌ |
| 需要时为 member 保留"代表用户写 L3"的直写 | ❌ | ✅ | ❌ |

- 闸门执行点:hub 层(工具分发处),不在存储层重复实现。
- agent 的一切写入降级为"候选"(L1 起),与原则 3 一致。

> 实现(0.0.4.0):\`src/identity/\` 四件 —— identity.ts(段校验+规范化建议)、registry.ts(TokenRegistry:内存映射 ID→SHA-256,持久文件只存哈希,issue/register/resolve/rotate/revoke)、brain-json.ts(.brain.json 解析,非法字段报错带建议)、permissions.ts(roleOf/canInvoke/assertCanInvoke + 矩阵表)。角色约定:null=访客;agent_label 非空=agent;空=member 级凭证。

## 5. 验收标准

- [x] 同 token 两次解析 → 同一 ID;改 token → ID 不变,旧 token 失效(含跨实例持久化恢复)。
- [x] 拼接串攻击:ID 串与字段拼接均无法解析;token 为随机 32 字节,明文不落盘。
- [x] 访客权限:search/context 可用,save/stats/edit/whoami 全拒。
- [x] agent token 调 memory.edit → 明确拒绝并提示需 member token。
- [x] .brain.json 字段非法(大写/空格)→ 解析报错并给规范化建议。

## 6. 开放问题

- token 传递方式 v1 用工具参数/提交字段;若未来走 header,随 StreamableHTTP 升级,不影响模型。
