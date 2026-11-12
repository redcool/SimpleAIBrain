#!/usr/bin/env node
/** 0.0.16.24 "备份记忆库" 口令实现:data/ 全量快照 → backups/memory-snap-<时间戳>.zip,按 --keep 保留最近 N 份。
 *  零依赖(压缩走系统 powershell Compress-Archive);幂等;本脚本不碰 hub,随时可跑。 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const args = process.argv.slice(2);
function argOf(name, def) { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : def; }
const KEEP = Math.max(1, parseInt(argOf('keep', '20'), 10) || 20);
const OUT = path.resolve(argOf('out', path.join(ROOT, 'backups')));

if (!fs.existsSync(path.join(DATA, 'memory'))) { console.error('[backup] 未找到 ' + DATA + ' — 请在 SimpleAIBrain 仓库根运行'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-').replace(/^/, '');
const zip = path.join(OUT, 'memory-snap-' + ts + '.zip');
const tarCmd = 'tar -a -c -f ' + zip + ' -C ' + JSON.stringify(ROOT) + ' data';
execSync(tarCmd, { stdio: 'pipe' });
const size = fs.existsSync(zip) ? fs.statSync(zip).size : 0;
if (!size) { console.error('[backup] 压缩失败: ' + zip); process.exit(1); }

// 保留最近 KEEP 份(同名不覆盖:时间戳精确到秒)
const all = fs.readdirSync(OUT).filter((f) => /^memory-snap-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$/.test(f)).sort();
let pruned = 0;
while (all.length > KEEP) { const victim = all.shift(); fs.unlinkSync(path.join(OUT, victim)); pruned++; }

console.log('[backup] ' + zip.replace(ROOT + path.sep, '') + ' (' + Math.round(size / 1024) + ' KB)');
console.log('[backup] 保留 ' + (all.length + 1) + ' / 删除 ' + pruned + ' (上限 ' + KEEP + ')');
