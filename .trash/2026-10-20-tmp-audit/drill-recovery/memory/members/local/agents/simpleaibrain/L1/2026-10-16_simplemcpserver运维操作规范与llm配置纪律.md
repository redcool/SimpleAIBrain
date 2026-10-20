---
schema_version: 1
id: mem_01M51R03EEQ01THDZV8EVPRXJV
layer: 1
scope: agent
owner:
  member: local
  agent: simpleaibrain
title: SimpleMcpServer运维操作规范与LLM配置纪律
kind: event
importance: 0.9
stability: 90
access_count: 1
last_access: 2026-10-19T02:49:10.628Z
status: active
pinned: false
superseded_by: null
source_ids:
  - f4b66326b3218be3
tags: []
created_by: consolidator
created_at: 2026-10-16T06:57:08.046Z
updated_at: 2026-10-19T02:50:10.670Z
body: |-
  在会话 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中，明���了 SimpleMcpServer(hub) 的关键运维要点。确立了端口 45678 的固定配置及 /rpc、/sse 等接口规范；制定了严格的重启流程，强调必须核对新进程 banner 时间戳以防止误操作，并规定实时观测需使用可见 cmd 窗口。确定了 LLM 配置原则，包括主备渠道回退机制及 maxTokens 必须 ≥4096 的硬性要求。同时，明确了《Agent工作纪律.md》中的编码与文档规范，如版本号规则及 AGENTS.md 的同步更新要求。最后，澄清了 brain 插件的优雅降级机制，即插件加载失败时 hub 仍可正常运行。

  要点:
  1. SimpleMcpServer(hub) 固定使用端口 45678，agent 直连入口为 POST /rpc，MCP 接口为 /sse 和 /mcp-stream
  2. 重启 hub 后必须核对新 banner 时间戳，若使用不可见后台运行易导致操作旧进程，实时观测须用可见 cmd 窗口且不重定向日志
  3. LLM 配置中 maxTokens 必须设置为 4096 及以上，1024 会导致巩固输出被截断
  4. web.search 功能失效时的标准解决方案是重启 hub
  5. 工作纪律规定版本号格式为 x.y.z.w，其中 z 代表大功能，w 代表小改；同名文件需加版本号而非覆盖
  6. AGENTS.md 作为项目知识库，任何功能变更后必须同步更新文档内容并修改“最后更新”时间
  7. brain 插件加载失败时系统采用优雅降级策略，hub 主体保持运行，仅缺失 memory.* 工具功能
---

在会话 session-b2fe0496-b231-4996-90b2-e7d45fa674cd 中，明���了 SimpleMcpServer(hub) 的关键运维要点。确立了端口 45678 的固定配置及 /rpc、/sse 等接口规范；制定了严格的重启流程，强调必须核对新进程 banner 时间戳以防止误操作，并规定实时观测需使用可见 cmd 窗口。确定了 LLM 配置原则，包括主备渠道回退机制及 maxTokens 必须 ≥4096 的硬性要求。同时，明确了《Agent工作纪律.md》中的编码与文档规范，如版本号规则及 AGENTS.md 的同步更新要求。最后，澄清了 brain 插件的优雅降级机制，即插件加载失败时 hub 仍可正常运行。

要点:
1. SimpleMcpServer(hub) 固定使用端口 45678，agent 直连入口为 POST /rpc，MCP 接口为 /sse 和 /mcp-stream
2. 重启 hub 后必须核对新 banner 时间戳，若使用不可见后台运行易导致操作旧进程，实时观测须用可见 cmd 窗口且不重定向日志
3. LLM 配置中 maxTokens 必须设置为 4096 及以上，1024 会导致巩固输出被截断
4. web.search 功能失效时的标准解决方案是重启 hub
5. 工作纪律规定版本号格式为 x.y.z.w，其中 z 代表大功能，w 代表小改；同名文件需加版本号而非覆盖
6. AGENTS.md 作为项目知识库，任何功能变更后必须同步更新文档内容并修改“最后更新”时间
7. brain 插件加载失败时系统采用优雅降级策略，hub 主体保持运行，仅缺失 memory.* 工具功能
