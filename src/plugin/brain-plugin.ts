import crypto from 'node:crypto';
import { join } from 'node:path';
import fs from 'node:fs/promises';
import type { Identity } from '../types.js';
import { FileStore } from '../store/file-store.js';
import { TokenRegistry } from '../identity/registry.js';
import { TOOL_DEFS } from '../tools/definitions.js';
import { callTool as dispatchCallTool } from '../tools/dispatch.js';
import { getBatcher } from '../retrieval/engine.js';
import { Consolidator, nextDailyDelayMs } from '../consolidation/consolidator.js';
import { IngestWorker } from '../ingest/worker.js';
import { redactArgs } from '../ingest/redact.js';
import { nowISO } from '../util/fsutil.js';
import { VERSION } from '../index.js';
import type { BrainCtx, BrainPlugin, ToolEvent } from './contract.js';

interface PluginState {
  ctx?: BrainCtx;
  store?: FileStore;
  registry?: TokenRegistry;
  consolidator?: Consolidator;
  consolTimer?: ReturnType<typeof setTimeout>;
  ingestWorker?: IngestWorker;
  logged: number;
  errors: number;
}

export { redactArgs };   // M06 §6:共享脱敏,来源 ingest/redact

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
      // 0.0.16.15 用户建议:member 凭证自动保障(失败不阻塞插件启动)
      try {
        const { ensureMemberCredential } = await import('./member-credential.js');
        const mc = await ensureMemberCredential(state.registry, ctx.dataDir);
        if (mc.action !== 'exists') state.ctx && console.log('[ai-brain] member credential ' + mc.action + ': ' + mc.file);
      } catch (e) { console.log('[ai-brain] member credential ensure skipped: ' + String(e && (e as Error).message).slice(0, 80)); }
      // M05:巩固器 + 每日定时(schedule=off 关闭;LLM 失败由巩固器按 session 跳过)
      const isLocalStore = state.store instanceof FileStore;   // M09:联邦只读模式不跑巩固(写会被拒)
      const consolidCfg = (ctx.brainConfig.consolidation || {}) as { schedule?: string; maxSessionsPerRun?: number; dailyAt?: string };
      if (consolidCfg.schedule !== 'off' && isLocalStore) {   // M09:RemoteStore 写会被拒,联邦端不巩固
        state.consolidator = new Consolidator(state.store, {
          dataDir: ctx.dataDir,
          // hub callLLM 契约 = 请求对象 {system?, prompt, context?, messages?}(内部总是把 prompt 作为 user 消息);
          // brain 契约 = OpenAI 风格消息数组。边界适配:提取 system/末条 user/其余轮次。
          callLLM: (msgs) => {
            const arr = Array.isArray(msgs) ? (msgs as Array<{ role?: string; content?: string }>) : [];
            const sys = arr.find((m) => m && m.role === 'system');
            const userIdx = arr.map((m) => m && m.role === 'user').lastIndexOf(true);
            const user = userIdx >= 0 ? arr[userIdx] : undefined;
            const rest = arr.filter((m, i) => m && m.role !== 'system' && i !== userIdx);
            const req: Record<string, unknown> = { prompt: user && typeof user.content === 'string' ? user.content : '' };
            if (sys && typeof sys.content === 'string') req.system = sys.content;
            if (rest.length > 0) req.messages = rest;
            return ctx.callLLM(req as never);
          },
          logger: ctx.logger,
          maxSessionsPerRun: consolidCfg.maxSessionsPerRun,
        });
        // 0.0.15.1:对齐每日固定时刻(默认 04:30,config consolidation.dailyAt 可改);替代"自启动 24h"——hub 重启不再无限顺延巩固
        const dailyAt = typeof consolidCfg.dailyAt === 'string' && /^\d{1,2}:\d{2}$/.test(consolidCfg.dailyAt) ? consolidCfg.dailyAt : '04:30';
        const scheduleNext = (): void => {
          const delay = nextDailyDelayMs(new Date(), dailyAt);
          const t = setTimeout(() => {
            void state.consolidator?.run('schedule').catch(() => { /* 下轮重试 */ });
            scheduleNext();
          }, delay);
          if (typeof t.unref === 'function') t.unref();
          state.consolTimer = t;
          ctx.logger('[ai-brain] consolidation daily at ' + dailyAt + ' (next in ' + Math.round(delay / 60000) + ' min)');
        };
        scheduleNext();
        // 启动追赶:spool 有未消化条目 → 90s 后先跑一轮,积压不再等整点
        try {
          const stateRaw = await fs.readFile(join(ctx.dataDir, 'consolidation-state.json'), 'utf8').then((x) => JSON.parse(x)).catch(() => null);
          const proc = (stateRaw && stateRaw.processed_spool) || {};
          const spoolFiles = await fs.readdir(join(ctx.dataDir, 'memory', '_spool')).catch(() => [] as string[]);
          const pending = spoolFiles.filter((f) => f.endsWith('.json') && !proc[String(f).replace(/\.json$/, '')]);
          if (pending.length > 0) {
            const ct = setTimeout(() => { void state.consolidator?.run('schedule').catch(() => { /* 下轮重试 */ }); }, 90_000);
            if (typeof ct.unref === 'function') ct.unref();
            ctx.logger('[ai-brain] consolidation catch-up: ' + pending.length + ' pending spool entries, running in 90s');
          }
        } catch { /* 结构异常 → 跳过追赶 */ }
      }
      // M06:摄入 worker(POST 语义 + spool 排空 + transcript 对账;ingest.enabled=false 关闭)
      const ingestCfg = (ctx.brainConfig.ingest || {}) as {
        enabled?: boolean; drainIntervalMs?: number; reconcileIntervalMs?: number; dshIdleMs?: number; autoDigest?: boolean;
        watch?: { claude?: string | null; codex?: string | null; dsh?: string | null };
      };
      if (ingestCfg.enabled !== false) {
        state.ingestWorker = new IngestWorker({
          dataDir: ctx.dataDir,
          store: state.store,
          logger: ctx.logger,
          maxParamChars: ctx.brainConfig.passiveLog?.maxParamChars,
          watch: ingestCfg.watch,
          drainIntervalMs: ingestCfg.drainIntervalMs,
          reconcileIntervalMs: ingestCfg.reconcileIntervalMs,
          dshIdleMs: ingestCfg.dshIdleMs,
          autoDigest: ingestCfg.autoDigest !== false,  // 0.0.14.1 默认开:登记即全管道;显式 false 关闭
        });
        state.ingestWorker.start();
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
      return dispatchCallTool({ identity: id, store: state.store, dataDir: state.ctx?.dataDir }, name, args ?? {});
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
        return state.consolidator.run('manual');
      });
      // M06:hook 提交入口(hub 已读 body;同机传 transcript_path,远程带 content)
      app.addRoute('POST', '/brain/ingest', (body: unknown) => {
        if (!state.ingestWorker) return Promise.resolve({ ok: false, error: 'ingest disabled' });
        return state.ingestWorker.ingestOne(body as Parameters<IngestWorker['ingestOne']>[0]);
      });
      // M09 §4:联邦只读查询(Tier 2)。联邦 token 见 brainConfig.federation.tokens;策略=studio-only;未授权→空结果不报错(不泄露存在性)。
      app.addRoute('POST', '/brain/query', (body: unknown) => {
        const b = (body || {}) as { query?: string; project?: string; limit?: number; token?: string };
        const fed = ((state.ctx?.brainConfig?.federation || {}) as { tokens?: string[] }).tokens || [];
        const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
        const authorized = typeof b.token === 'string' && b.token.length > 0 && fed.some((t) => sha(t) === sha(b.token as string));
        if (!authorized) return { results: [], policy: 'denied' };   // 空而非错误(M09 §5 验收 2)
        const results: Array<{ id: string; layer: number; title: string; body: string; created_by: string; updated_at: string; importance: number }> = [];
        const tokens = String(b.query || '').toLowerCase().split(/\s+/).filter(Boolean);
        const rows: Array<{ e: { id: string; layer: number; title: string; body: string; created_by: string; updated_at: string; importance: number; project?: string } }> = [];
        const store = state.store;
        if (!store) return { results: [], policy: 'studio-only' };
        void rows;
        return (async () => {
          for await (const e of store.iterateByScope({ includeArchived: false })) {
            if (e.scope !== 'studio') continue;                       // 服务方策略:默认仅 studio(M09 §3)
            if (b.project && e.project !== b.project) continue;
            const hay = (e.title + '\n' + e.body).toLowerCase();
            if (tokens.length && !tokens.every((t) => hay.includes(t))) continue;
            results.push({ id: e.id, layer: e.layer, title: e.title, body: String(e.body || '').slice(0, 1200), created_by: e.created_by, updated_at: e.updated_at, importance: e.importance });
          }
          results.sort((x, y) => y.importance - x.importance || (y.updated_at < x.updated_at ? -1 : 1));
          const limit = Math.max(1, Math.min(50, Number(b.limit) || 10));
          return { results: results.slice(0, limit), policy: 'studio-only' };
        })();
      });
    },

    async shutdown(): Promise<void> {
      if (state.consolTimer) { clearInterval(state.consolTimer); state.consolTimer = undefined; }
      state.ingestWorker?.stop();
      if (state.store) {
        const n = await getBatcher(state.store).flush();
        state.ctx?.logger('[ai-brain] shutdown, reinforced ' + n + ' entries');
      }
      state.store = undefined;
      state.ctx = undefined;
    },
  };
}
