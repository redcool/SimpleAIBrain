import crypto from 'node:crypto';
import { join } from 'node:path';
import type { Identity } from '../types.js';
import { FileStore } from '../store/file-store.js';
import { TokenRegistry } from '../identity/registry.js';
import { TOOL_DEFS } from '../tools/definitions.js';
import { callTool as dispatchCallTool } from '../tools/dispatch.js';
import { getBatcher } from '../retrieval/engine.js';
import { Consolidator } from '../consolidation/consolidator.js';
import { nowISO } from '../util/fsutil.js';
import { VERSION } from '../index.js';
import type { BrainCtx, BrainPlugin, ToolEvent } from './contract.js';

interface PluginState {
  ctx?: BrainCtx;
  store?: FileStore;
  registry?: TokenRegistry;
  consolidator?: Consolidator;
  consolTimer?: ReturnType<typeof setTimeout>;
  logged: number;
  errors: number;
}

const SECRET_KEY_RE = /token|password|secret|apikey|api_key|authorization|credential/i;

/** args 摘要:敏感键打码 + 截断(M01 §4;脱敏在 brain 侧) */
export function redactArgs(args: Record<string, unknown> | undefined | null, maxChars: number): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    out[k] = SECRET_KEY_RE.test(k) ? '[REDACTED]' : v;
  }
  let s = JSON.stringify(out);
  if (s === undefined || s === null) s = '{}';
  if (s.length > maxChars) s = s.slice(0, maxChars) + '…(truncated)';
  return s;
}

/** 工具通配:'blender.*' 前缀匹配;精确名全等 */
export function matchesPattern(tool: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (p === tool) return true;
    if (p.endsWith('.*') && tool.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}

/** 创建插件实例(hub pluginHost 每次加载调用一次) */
export function createBrainPlugin(): BrainPlugin {
  const state: PluginState = { logged: 0, errors: 0 };

  return {
    contractVersion: 1,
    name: 'ai-brain',

    async init(ctx: BrainCtx): Promise<void> {
      state.ctx = ctx;
      state.store = new FileStore(ctx.dataDir + '/memory');
      await state.store.init();
      state.registry = new TokenRegistry(join(ctx.dataDir, 'memory', '_identity', 'tokens.json'));
      await state.registry.load();
      // M05:巩固器 + 每日定时(schedule=off 关闭;LLM 失败由巩固器按 session 跳过)
      const consolidCfg = (ctx.brainConfig.consolidation || {}) as { schedule?: string; maxSessionsPerRun?: number };
      if (consolidCfg.schedule !== 'off') {
        state.consolidator = new Consolidator(state.store, {
          dataDir: ctx.dataDir,
          callLLM: ctx.callLLM,
          logger: ctx.logger,
          maxSessionsPerRun: consolidCfg.maxSessionsPerRun,
        });
        state.consolTimer = setInterval(() => {
          void state.consolidator?.run().catch(() => { /* 下轮重试 */ });
        }, 24 * 60 * 60 * 1000);
        if (typeof state.consolTimer.unref === 'function') state.consolTimer.unref();
      }
      ctx.logger('[ai-brain] ready v' + VERSION + ', entries=' + state.store.size + ', identities=' + state.registry.list().length + ', quarantined=' + state.store.getQuarantined().length);
    },

    /** v1 扩展(非契约必需):hub 用 token 解析身份;解析失败 → null(访客) */
    resolveIdentity(token: string): Identity | null {
      return state.registry ? state.registry.resolve(token) : null;
    },

    getTools() {
      return TOOL_DEFS.map((d) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema }));
    },

    async callTool(name: string, args: Record<string, unknown>, id: Identity | null) {
      if (!state.store) throw new Error('ai-brain not initialized (init() first)');
      return dispatchCallTool({ identity: id, store: state.store }, name, args ?? {});
    },

    onToolEvent(evt: ToolEvent): void {
      try {
        if (!evt || typeof evt.tool !== 'string') return;
        if (evt.tool.startsWith('memory.')) return;            // 排除自身(M01 §4)
        const cfg = state.ctx?.brainConfig?.passiveLog;
        if (cfg?.enabled === false) return;                     // 全局开关(缺省开)
        const patterns = cfg?.tools ?? ['blender.*', 'bridge.call', 'unreal.*', 'web.search'];
        if (!matchesPattern(evt.tool, patterns)) return;
        const maxChars = cfg?.maxParamChars ?? 2048;
        const digest = redactArgs(evt.args, maxChars);
        const store = state.store;
        if (!store) return;
        const agentLabel = evt.identity ? (evt.identity.agent_label || evt.identity.member) : 'unknown';
        void store.appendLog({
          ts: nowISO(),
          harness: 'hub',
          agent_label: agentLabel,
          kind: 'toolflow',
          tool: evt.tool,
          digest,
          hash: crypto.createHash('sha256').update(digest).digest('hex').slice(0, 16),
        }).catch(() => { state.errors++; });
        state.logged++;
      } catch {
        state.errors++;                                        // 永不抛错(M01 §4)
      }
    },

    registerRoutes(app) {
      app.addRoute('GET', '/brain/health', () => ({
        ok: true,
        name: 'ai-brain',
        version: VERSION,
        entries: state.store ? state.store.size : 0,
        passiveLogged: state.logged,
        passiveErrors: state.errors,
      }));
      // M05:手动触发一次巩固(调试/补跑;单飞锁防并发)
      app.addRoute('POST', '/brain/consolidate', () => {
        if (!state.consolidator) return { ok: false, error: 'consolidation disabled (schedule=off)' };
        return state.consolidator.run();
      });
    },

    async shutdown(): Promise<void> {
      if (state.consolTimer) { clearInterval(state.consolTimer); state.consolTimer = undefined; }
      if (state.store) {
        const n = await getBatcher(state.store).flush();
        state.ctx?.logger('[ai-brain] shutdown, reinforced ' + n + ' entries');
      }
      state.store = undefined;
      state.ctx = undefined;
    },
  };
}
