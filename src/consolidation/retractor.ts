import fs from 'node:fs/promises';
import path from 'node:path';
import type { MemoryStore } from '../store/types.js';
import { assertTransition } from '../model/lifecycle.js';
import { atomicWriteFile } from '../util/fsutil.js';

/** M06 §9 撤回:会话删除 → 关联记忆按引用链退出。证据共享:幸存佐证保留,证据全灭才退出。 */

export interface DeadScan { dead: string[]; unavailable: boolean; }

/**
 * manifest 中 src='dsh' 的行,对照磁盘现存 session 目录(session.<v>.jsonl.zstd 或 .jsonl 所在目录名)。
 * 目录不可达(盘未挂载)= 源不可用 → 宁可不撤(unavailable);不猜。
 */
export async function deadDshSessions(sessions: Record<string, { src?: string }>, dshDir: string): Promise<DeadScan> {
  const rows = Object.keys(sessions).filter((sid) => sessions[sid] && sessions[sid].src === 'dsh');
  if (rows.length === 0) return { dead: [], unavailable: false };
  let wsEntries;
  try { wsEntries = await fs.readdir(dshDir, { withFileTypes: true }); } catch { return { dead: [], unavailable: true }; }
  const present = new Set<string>();
  for (const ws of wsEntries) {
    if (!ws.isDirectory()) continue;
    const wsPath = path.join(dshDir, ws.name);
    let sessEntries;
    try { sessEntries = await fs.readdir(wsPath, { withFileTypes: true }); } catch { continue; }
    for (const sd of sessEntries) {
      if (!sd.isDirectory()) continue;
      const dir = path.join(wsPath, sd.name);
      let files: string[] = [];
      try { files = await fs.readdir(dir); } catch { continue; }
      if (files.some((f) => /session\..*\.jsonl(\.zstd)?$/i.test(f) || /\.jsonl$/i.test(f))) present.add(sd.name);
    }
  }
  return { dead: rows.filter((sid) => !present.has(sid)), unavailable: false };
}

export interface RetractionReport {
  session_id: string;
  l0_removed: number;      // L0 物理删除行数
  spool_removed: number;   // 该会话的 digest spool 文件删除数
  forgotten: string[];     // L1 证据全灭 → archived(可逆)
  flagged: string[];       // L2/L3 或 pinned/decision/high-importance → needs_review(人工确认)
  stripped: string[];      // 幸存佐证:仅剥离死来源
  skipped: string[];       // 已 archived/superseded 或状态机不允许
}

/**
 * 撤回单个会话:
 * 1) spool:该会话的 digest 文件删除(文件名=hash16,防未处理内容再被挖矿);
 * 2) L0:所有 session_id 命中行物理删除(月度 jsonl 原子重写;损坏行保留);
 * 3) 条目:source_ids 命中死 hash16 → 剥离;全灭 → L1 archived / L2 以上或 pinned/decision/importance≥0.8 → needs_review。
 */
export async function retractSession(root: string, store: MemoryStore, sessionId: string, log?: (m: string) => void): Promise<RetractionReport> {
  const report: RetractionReport = { session_id: sessionId, l0_removed: 0, spool_removed: 0, forgotten: [], flagged: [], stripped: [], skipped: [] };
  // 1) spool
  const spoolDir = path.join(root, '_spool');
  const dead = new Set<string>();
  let spoolFiles: string[] = [];
  try { spoolFiles = (await fs.readdir(spoolDir)).filter((f) => f.endsWith('.json')); } catch { /* 无 spool 目录 */ }
  for (const f of spoolFiles) {
    const p = path.join(spoolDir, f);
    try {
      const rec = JSON.parse(await fs.readFile(p, 'utf8')) as { session_id?: string };
      if (rec && rec.session_id === sessionId) { dead.add(f.replace(/\.json$/, '')); await fs.rm(p); report.spool_removed++; }
    } catch { /* 损坏 spool 不动 */ }
  }
  // 2) L0 物理删除
  const rewrite = async (d: string): Promise<void> => {
    let es;
    try { es = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { await rewrite(p); continue; }
      if (!e.name.endsWith('.jsonl')) continue;
      const text = await fs.readFile(p, 'utf8');
      const kept: string[] = [];
      let removed = 0;
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let rec: { session_id?: string } | null = null;
        try { rec = JSON.parse(line) as { session_id?: string }; } catch { kept.push(line); continue; }
        if (rec && rec.session_id === sessionId) { removed++; continue; }
        kept.push(line);
      }
      if (removed > 0) { await atomicWriteFile(p, kept.length ? kept.join('\n') + '\n' : ''); report.l0_removed += removed; }
    }
  };
  await rewrite(path.join(root, 'L0-log'));
  // 3) 条目链
  const metas = [];
  for await (const m of store.scanMeta()) metas.push(m);
  for (const m of metas) {
    const hits = (m.source_ids || []).filter((s) => dead.has(s));
    if (hits.length === 0) continue;
    if (m.status === 'archived' || m.status === 'superseded') { report.skipped.push(m.id); continue; }
    const surviving = (m.source_ids || []).filter((s) => !dead.has(s));
    if (surviving.length > 0) { await store.patchMeta(m.id, { source_ids: surviving }); report.stripped.push(m.id); continue; }
    const special = m.pinned === true || m.kind === 'decision' || m.importance >= 0.8 || m.layer >= 2;
    const to = special ? 'needs_review' : 'archived';
    try { assertTransition(m.status, to); } catch { report.skipped.push(m.id); continue; }
    await store.patchMeta(m.id, { status: to });
    if (to === 'archived') report.forgotten.push(m.id); else report.flagged.push(m.id);
  }
  log?.('[ai-brain] retraction ' + sessionId + ': L0 -' + report.l0_removed + ', spool -' + report.spool_removed + ', forgotten ' + report.forgotten.length + ', flagged ' + report.flagged.length + ', stripped ' + report.stripped.length);
  return report;
}
