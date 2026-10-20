import { parseClaudeCodeConfig } from 'file:///H:/AI/dsh/node_modules/@deepseek-ai/dsh-hooks-claude-code/lib/index.js';
import fs from 'node:fs';
const raw = JSON.parse(fs.readFileSync('H:/ai_works/SimpleAIBrain/config/hooks.json', 'utf8'));
const r = parseClaudeCodeConfig(raw);
console.log('runnable events:', JSON.stringify(Object.keys(r.config)));
for (const [ev, groups] of Object.entries(r.config)) console.log(ev, '->', groups.length, 'group(s);', JSON.stringify(groups[0]?.hooks?.[0]?.command || groups[0]?.hooks?.map(h=>h.command) || []).slice(0, 120));
console.log('skipped:', JSON.stringify(r.skipped));