> 上游:[memory-design.md](../memory-design.md) · 状态:文档定稿 2026-10-14 · 实现:✅ 0.0.7.1(brain 侧 7 测试,累计 47/47;hub 侧 0.0.12 已接线,4 测试)

# M01 · 插件契约与宿主集成

## 1. 目标与边界

SimpleAIBrain 以**进程内插件**形态运行于 hub(SimpleMcpServer)。本模块定义:插件契约(六钩子)、hub 侧加载器(pluginHost)、hub 的对接落点。**边界**:不含记忆业务逻辑;本模块通过后,brain 的工具应出现在 hub 工具列表并可路由(哪怕返回"未实现")。

不做子进程 MCP(定论):被动钩子需要进程内直调;单写者依赖同进程;省一跳协议。

## 2. 插件契约(v1,contractVersion = 1)

```ts
export interface BrainPlugin {
  contractVersion: 1;
  name: 'ai-brain';
  init(ctx: BrainCtx): Promise<void>;
  getTools(): ToolDesc[];                     // { name:'memory.x', description, inputSchema }
  callTool(name: string, args: Record<string, unknown>, id: Identity | null): Promise<ToolResult>;
  onToolEvent(evt: ToolEvent): void;          // 被动流水;fire-and-forget;禁止抛错
  registerRoutes?(app: RouteRegistrar): void; // /brain/ingest、/brain/query(v1 预留,v2 实现)
  shutdown(): Promise<void>;                  // 停定时器、flush、关存储
}

export interface BrainCtx {
  brainConfig: BrainConfig;      // config.json 的 aiBrain 段
  dataDir: string;               // <brainPath>/data
  logger: (msg: string) => void; // 复用 hub logger
  callLLM: (msgs: unknown, opts?: unknown) => Promise<string>; // 复用 hub src/llm.ts
  httpApp: RouteRegistrar;       // hub http server 的 addRoute(method, path, handler)
  serverVersion: string;
}

export interface ToolEvent {
  tool: string; args: Record<string, unknown>;  // 原始 args,脱敏由 brain 侧做
  ok: boolean; ms: number;
  transport: 'mcp' | 'rpc';
  identity: Identity | null;     // hub 解析后传入(M07);解析失败为 null
}
```

## 3. hub 侧对接落点(实现时的完整改动清单)

| # | 位置 | 改动 |
|---|---|---|
| 1 | `src/pluginHost.ts`(新增,约 60 行) | 读 `aiBrain.path` → `import(pathToFileURL(join(path,'dist','index.js')))` → 校验 contractVersion → init(ctx) → 暴露单例 |
| 2 | `src/tools.ts` getMergedTools | brain.getTools() 合并(走现有 allowedTools 门控) |
| 3 | `server.ts` CallToolRequestSchema | 链首插入 isBrainTool 分支;**调用前后各触发一次 onToolEvent**(成败都要) |
| 4 | /rpc 独立入口 | 同样的分支与埋点(只埋 MCP 入口会漏一半流量) |
| 5 | config.json | 增 `aiBrain` 段(§5) |

## 4. 行为规范

- **加载失败 = 优雅降级**:路径不存在 / import 抛错 / contractVersion 不符 → log 警告,hub 照常启动,无 memory.* 工具。hub 不得因 brain 挂掉。
- **onToolEvent 永不阻塞主流程**:同步返回;内部异常吞掉并计数。
- **排除自身**:memory.* 的调用不进被动流水(防自我指涉噪音)。
- 热插拔语义:删配置/停服 = 拔出;数据在 data/ 原地不动;重插不丢。
- 工具数量约束:memory.* 全家 ≤ 8 个(工具列表进入每个 agent 的上下文)。

> 实现(0.0.7.0):\`src/plugin/contract.ts\`(契约类型,与 §2 逐字对应)+ \`src/plugin/brain-plugin.ts\`(createBrainPlugin 工厂)。init 建 FileStore(\`<dataDir>/memory\`)并报 entries/quarantined;callTool 直通 M08 分发;onToolEvent 脱敏(敏感键 [REDACTED])+ 截断(maxParamChars)+ 通配匹配 + memory.* 排除,异常吞掉计数;registerRoutes 提供 /brain/health;shutdown flush 强化批。passiveLog 缺省清单:blender.* / bridge.call / unreal.* / web.search。

## 5. 配置(config.json 增量)

```json
"aiBrain": {
  "path": "H:/ai_works/SimpleAIBrain",
  "passiveLog": { "enabled": true, "tools": ["blender.*", "bridge.call", "unreal.*", "web.search"], "maxParamChars": 2048 },
  "consolidation": { "schedule": "daily", "maxSessionsPerRun": 20 }
}
```

## 6. 验收标准

- [x] 契约:contractVersion=1、name、8 个 memory.* 工具描述(brain 侧,0.0.7.0)。
- [x] init→callTool 路由(save 通、guest 拒、未知工具报错);shutdown flush 落盘。
- [x] onToolEvent:匹配进 L0、memory.*/未匹配排除、开关关闭、截断、脱敏、null 事件不抛。
- [x] registerRoutes:/brain/health 报告 entries。
- [x] config 无 aiBrain 段 → hub 正常启动,日志一条警告。(hub 侧,hub 测试 #1)
- [x] path 指向未构建目录 → 同上,不崩。(hub 侧,hub 测试 #2)
- [x] contractVersion=99 → 拒载并报明确错误。(hub 侧,hub 测试 #3,fixture 插件)
- [x] 加载成功 → tools/list 含 memory.*;tools/call 可路由;内部错误返回 isError。(hub 侧,hub 测试 #4;whoami 通、stats 访客拒)
- [x] /rpc 与 MCP 两条路径的 onToolEvent 都触发。(rpc 已测落盘;MCP 由 CallTool 外壳 wrapper 接线保证,未起 SDK server 单测)
- [x] brain 内部抛错不影响 hub 其它工具。(brain 分支与外壳双层 try/catch,异常一律转 isError)

## 7. 开放问题

- RouteRegistrar 具体形态:hub 的 http server 是原生 Node,给 brain `addRoute(method, path, handler)` 即可,不引框架。
