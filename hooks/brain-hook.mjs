#!/usr/bin/env node
// SimpleAIBrain 会话摄入 hook(Claude Code SessionEnd / Codex stop 共用)
// stdin: {session_id, transcript_path, ...};读 .brain.json 得身份;
// POST /brain/ingest(同机只传 transcript_path);失败 → 写 ingest-spool 便签后退出。
// 时限:SessionEnd hook 须在 ~1.5s 内返回,故 fetch 硬超时 1400ms,失败立即落 spool。
import fs from 'node:fs';
import path from 'node:path';

const HUB = process.env.BRAIN_HUB_URL || 'http://127.0.0.1:45678';
const BRAIN_PATH = process.env.BRAIN_PATH || 'H:/ai_works/SimpleAIBrain';
const HARNESS = process.env.BRAIN_HARNESS || 'claude-jsonl';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', async () => {
  let evt = {};
  try { evt = JSON.parse(input || '{}'); } catch { evt = {}; }
  const sessionId = evt.session_id || 'unknown-' + Date.now().toString(36);
  const payload = {
    harness: HARNESS,
    session_id: sessionId,
    kind: 'transcript',
    transcript_path: evt.transcript_path || '',
  };
  try {
    const brainJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.brain.json'), 'utf8'));
    if (brainJson && brainJson.identity) payload.identity = brainJson.identity;
  } catch { /* 无 .brain.json → guest,worker 仍收 */ }
  try {
    const res = await fetch(HUB + '/brain/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1400),
    });
    if (res.ok) return;                       // 交付成功,直接退出
  } catch { /* 断网/hub 未起 → 落 spool */ }
  try {
    const dir = path.join(BRAIN_PATH, 'data', 'ingest-spool');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, Date.now().toString(36) + '-' + String(sessionId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) + '.json');
    fs.writeFileSync(file, JSON.stringify({ ...payload, spooled_at: new Date().toISOString() }));
  } catch { /* 最后一道也失败 → 放弃(worker 的对账会补) */ }
});
