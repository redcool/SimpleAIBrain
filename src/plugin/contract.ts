/** M01 §2:插件契约(v1,contractVersion = 1)。brain 与 hub 共同遵守的唯一接口。 */
import type { Identity } from '../types.js';

export interface PassiveLogConfig {
  enabled?: boolean;             // 缺省 true(全局开关)
  tools?: string[];              // 通配模式,如 'blender.*';缺省内置清单
  maxParamChars?: number;        // args 摘要截断,缺省 2048
}

export interface BrainConfig {
  path?: string;
  passiveLog?: PassiveLogConfig;
  consolidation?: { schedule?: string; maxSessionsPerRun?: number };
  ingest?: {
    enabled?: boolean;
    drainIntervalMs?: number;
    reconcileIntervalMs?: number;
    dshIdleMs?: number;
    watch?: { claude?: string | null; codex?: string | null; dsh?: string | null };
  };
}

export interface RouteRegistrar {
  addRoute(method: string, path: string, handler: (req: unknown) => unknown | Promise<unknown>): void;
}

export interface BrainCtx {
  brainConfig: BrainConfig;      // config.json 的 aiBrain 段
  dataDir: string;               // <brainPath>/data
  logger: (msg: string) => void;
  callLLM: (msgs: unknown, opts?: unknown) => Promise<string>;   // 复用 hub src/llm.ts
  httpApp: RouteRegistrar;
  serverVersion: string;
}

export interface ToolEvent {
  tool: string;
  args: Record<string, unknown>; // 原始 args;脱敏由 brain 侧做
  ok: boolean;
  ms: number;
  transport: 'mcp' | 'rpc';
  identity: Identity | null;     // hub 解析后传入(M07);解析失败为 null
}

export interface ToolDesc { name: string; description: string; inputSchema: Record<string, unknown>; }

export interface ToolResult { content: unknown; isError: boolean; }

export interface BrainPlugin {
  contractVersion: 1;
  name: 'ai-brain';
  init(ctx: BrainCtx): Promise<void>;
  getTools(): ToolDesc[];
  callTool(name: string, args: Record<string, unknown>, id: Identity | null): Promise<ToolResult>;
  onToolEvent(evt: ToolEvent): void;             // fire-and-forget;禁止抛错
  registerRoutes?(app: RouteRegistrar): void;    // /brain/ingest、/brain/query(v1 预留)
  shutdown(): Promise<void>;                     // 停定时器、flush、关存储
  /** v1 扩展:hub 侧 token → 身份(M07);缺失时 hub 一律按 null(访客)处理 */
  resolveIdentity?(token: string): Identity | null;
}
