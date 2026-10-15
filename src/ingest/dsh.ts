import zlib from 'node:zlib';

/** M06 §2 DSH 行:session 持久化是分帧追加的 zstd(jsonl 在帧内)。帧扫描按 zstd 规范走帧头/块头,不猜 magic 偏移。 */

const ZSTD_MAGIC = 0xfd2fb528;

export interface ZstdFrameRange { start: number; end: number; }

/**
 * 扫出全部完整 zstd 帧区间;末尾不完整帧返回 tornStart(活跃 session 正在追加,跳过不报错)。
 * 逻辑对齐 @deepseek-ai/dsh-session-persistence-jsonl 的 scanZstdFrames(Node 24 内置 zlib 即可解)。
 */
export function scanZstdFrames(buffer: Buffer, maxFrames = Number.POSITIVE_INFINITY): { frames: ZstdFrameRange[]; tornStart?: number } {
  const frames: ZstdFrameRange[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error('corrupt DSH session log: invalid frame magic at byte ' + offset);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error('corrupt DSH session log: reserved frame-header bit');
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : (1 << contentSizeFlag);
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error('corrupt DSH session log: reserved block type');
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
    if (frames.length >= maxFrames) return { frames };
  }
  return { frames };
}

/** 解整个 artifact(多帧;末尾 torn 帧跳过)= 完整 jsonl 文本 */
export function decodeDshArtifact(buffer: Buffer): string {
  const { frames } = scanZstdFrames(buffer);
  let text = '';
  for (const fr of frames) {
    text += zlib.zstdDecompressSync(buffer.subarray(fr.start, fr.end)).toString('utf8');
  }
  return text;
}

/** 从 v3 jsonl 文本提取对话:user/assistant 的 message.content(只取 text 部分,reasoning 跳过) */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && (c as { type?: unknown }).type === 'text' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export interface DshMeta { cwd?: string; title?: string; }

/** 会话头(唯一的 type=session 行,含 cwd)+ 最后一次 session/title(标题会更新,取末次) */
export function extractDshMeta(raw: string): DshMeta {
  const meta: DshMeta = {};
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    if (line.indexOf('"type":"session"') === -1 && line.indexOf('"type": "session"') === -1 && line.indexOf('"type":"session/title"') === -1 && line.indexOf('"type": "session/title"') === -1) continue;
    let obj: { type?: string; cwd?: unknown; data?: { title?: unknown } };
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === 'session' && typeof obj.cwd === 'string') meta.cwd = obj.cwd;   // v3 头:cwd 在行顶层
    if (obj.type === 'session/title' && typeof obj.data?.title === 'string') meta.title = obj.data.title;
  }
  return meta;
}

/** DSH session.v3 jsonl → 对话文本('user: '/'assistant: ' 行);钉版本 1(对 v3 行形) */
export function parseDshJsonlText(raw: string): string {
  const out: string[] = [];
  let malformed = 0;
  const lines = raw.split('\n').filter((l) => l.trim());
  for (const line of lines) {
    let obj: { type?: string; data?: { message?: { role?: string; content?: unknown } } };
    try { obj = JSON.parse(line); } catch { malformed++; continue; }
    if (obj.type !== 'user/message' && obj.type !== 'assistant/message') continue;
    const role = obj.type === 'user/message' ? 'user' : 'assistant';
    const text = extractText(obj.data?.message?.content).trim();
    if (text) out.push(role + ': ' + text);
  }
  if (out.length === 0 && lines.length > 0 && malformed / lines.length > 0.3) {
    throw new Error('dsh-jsonl: format drift suspected (' + malformed + '/' + lines.length + ' malformed lines), refusing to guess');
  }
  return out.join('\n');
}
