/** M08 §2:v1 工具全量 = 8,数量红线(每个名称+描述都进 agent 上下文) */

const KINDS = ['fact', 'preference', 'event', 'procedure', 'decision'];

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'memory.save',
    description: '保存一条候选记忆(自动归入 L1)。能否长期保留由巩固决定,不承诺进入 L3。',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '记忆正文' },
        kind: { type: 'string', enum: KINDS },
        importance: { type: 'number', description: '0~1,缺省 0.5' },
        tags: { type: 'array', items: { type: 'string' } },
        project: { type: 'string', description: '数据标签,不进身份' },
        scope: { type: 'string', enum: ['agent', 'member', 'studio'], description: '缺省 agent' },
      },
      required: ['content', 'kind'],
    },
  },
  {
    name: 'memory.search',
    description: '检索记忆条目,程序化下钻用(含 source_ids);日常优先用 memory.context。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        scope: { type: 'string', enum: ['session', 'agent', 'member', 'studio'] },
        project: { type: 'string' },
        includeArchived: { type: 'boolean', description: '显式搜索可命中 archived' },
        limit: { type: 'number', description: '缺省 10,上限 50' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory.context',
    description: '返回按预算组装好的记忆上下文块。日常首选入口。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        project: { type: 'string' },
        budget: { type: 'number', description: 'token 预算,缺省 4000' },
        tocOnly: { type: 'boolean', description: 'true=只返回纯标题目录(领航灯/快速盘点用),忽略 query' }
      },
      required: ['query'],
    },
  },
  {
    name: 'memory.submit_session',
    description: '提交会话摘要或完整日志供巩固。同 hash 重复提交幂等忽略。',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        kind: { type: 'string', enum: ['digest', 'full'] },
        path: { type: 'string', description: '与 content 二选一' },
        content: { type: 'string', description: '与 path 二选一' },
        hash: { type: 'string', description: '缺省自动计算' },
      },
      required: ['session_id', 'kind'],
    },
  },
  {
    name: 'memory.stats',
    description: '记忆库统计:各层条数、状态分布、隔离区数量。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'memory.whoami',
    description: '返回当前身份与可用权限(调试用)。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'memory.review_list',
    description: '(member)列出待裁决条目,或对一条执行裁决。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'resolve'] },
        id: { type: 'string', description: 'resolve 时必填' },
        verdict: { type: 'string', enum: ['active', 'superseded', 'archived'], description: 'resolve 时必填' },
      },
      required: ['action'],
    },
  },
  {
    name: 'memory.edit',
    description: '(member)修改/钉住/遗忘/恢复/取代条目——大脑手术,谨慎使用;supersede 需 ref 指向共识条目。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        action: { type: 'string', enum: ['edit', 'pin', 'unpin', 'forget', 'restore', 'supersede'] },
        content: { type: 'string', description: 'action=edit 时必填' },
        reason: { type: 'string' },
      },
      required: ['id', 'action'],
    },
  },
];

export function toolNames(): string[] { return TOOL_DEFS.map((d) => d.name); }

/** 描述总字符数(回归基线,防描述悄悄膨胀;M08 §4) */
export function totalDescriptionChars(): number {
  return TOOL_DEFS.reduce((n, d) => n + d.description.length, 0);
}
