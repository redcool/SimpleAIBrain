/** M05 §4:四段提示词(骨架;措辞细节实现期打磨)。统一约束:只输出 JSON、事实带出处、不确定标低 importance。 */

const COMMON = '通用约束:只输出 JSON(不要 markdown 代码块);每条事实必须带出处(会话 id 或条目 id);不确定的内容 importance 标 ≤0.3,宁缺毋滥;中文输出。';

export interface ExtractOut {
  summary: string;
  facts: { text: string; importance: number; kind?: string }[];
}

export interface MergeOut {
  merges: { title: string; body: string; importance: number; kind?: string; from: number[] }[];
  conflicts: { old_id: string; reason: string }[];
}

export interface DistillOut {
  facts: { text: string; kind?: string; importance: number }[];
}

const FENCE = String.fromCharCode(96).repeat(3);   // markdown 代码围栏(避免源码里出现字面反引号)

/** 1) 抽取:会话原料 → 摘要 + 候选事实(摘要必须引用会话 id) */
export function extractPrompt(input: { sessionId: string; kind: string; content: string }): string {
  return '[任务:抽取]\n' +
    '从下面的会话记录中提取:发生了什么、决定了什么、学会了什么。\n' +
    '输出 JSON:{"summary": "≤300字摘要,必须引用会话 id ' + input.sessionId + '", "facts": [{"text": "一句一事", "importance": 0-1, "kind": "fact|decision|preference"}]}\n' +
    '会话 id: ' + input.sessionId + '\n' +
    '类型: ' + input.kind + '\n' +
    '--- 会话记录开始 ---\n' + input.content.slice(0, 16000) + '\n--- 会话记录结束 ---\n' + COMMON;
}

/** 2+3) 去重合并 + 矛盾提名:候选 + 现有 L2/L3 → merges/conflicts;裁定由引擎执行(M03 §5) */
export function mergePrompt(input: { agentId: string; candidates: { idx: number; id: string; title: string; body: string }[]; existing: { id: string; title: string; layer: number; body: string }[] }): string {
  return '[任务:去重合并与矛盾消解]\n' +
    'agent: ' + input.agentId + '\n' +
    '候选(未归并的 L1,编号即 from 下标):\n' +
    input.candidates.map((c) => '#' + c.idx + ' [' + c.id + '] ' + c.title + ': ' + c.body.slice(0, 200)).join('\n') + '\n' +
    '现有知识(L2/L3,去重对照):\n' +
    (input.existing.length ? input.existing.map((e) => '[' + e.id + '] L' + e.layer + ' ' + e.title + ': ' + e.body.slice(0, 120)).join('\n') : '(无)') + '\n' +
    '输出 JSON:{"merges": [{"title": "≤30字", "body": "归并后的知识,引用来源 L1 的 id", "importance": 0-1, "kind": "fact|decision|preference", "from": [候选下标]}], "conflicts": [{"old_id": "与候选矛盾或重复的现有条目 id", "reason": "一句话"}]}\n' +
    '相似条目必须合并;与新会话矛盾的旧条目放进 conflicts(引擎按 pinned/decision/高重要度规则裁定 supersede 或 needs_review)。\n' + COMMON;
}

/** 4) 蒸馏:候选压缩为 L3 原子句(一句一事,可独立失效) */
export function distillPrompt(input: { id: string; title: string; body: string }): string {
  return '[任务:蒸馏]\n' +
    '把下面的 L2 条目压缩为原子事实(一句一事,可独立失效),保留可验证细节,去掉修饰。\n' +
    '[' + input.id + '] ' + input.title + ': ' + input.body.slice(0, 800) + '\n' +
    '输出 JSON:{"facts": [{"text": "一句一事,引用 ' + input.id + '", "kind": "fact|decision|preference", "importance": 0-1}]}\n' + COMMON;
}

/** 宽松 JSON 提取:剥代码围栏,取首尾大括号;失败抛错(调用方按 LLM 失败语义处理) */
export function parseJsonOut<T>(raw: string, task: string): T {
  let s = String(raw ?? '').replace(new RegExp(FENCE + '(?:json)?', 'gi'), '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error(task + ': LLM output has no JSON object');
  s = s.slice(start, end + 1);
  let parsed: unknown;
  try { parsed = JSON.parse(s); } catch (e) {
    throw new Error(task + ': LLM output is not valid JSON (' + (e instanceof Error ? e.message : String(e)) + ')');
  }
  if (parsed === null || typeof parsed !== 'object') throw new Error(task + ': LLM output is not an object');
  return parsed as T;
}
