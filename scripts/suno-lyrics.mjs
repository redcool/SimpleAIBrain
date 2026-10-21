#!/usr/bin/env node
// M11 配套:歌词双版交付——从歌曲 md 歌词区剥出 Suno 纯净版(.suno.txt)
// 剥离:行号/〔出处〕/【声部】/全半角括注(含混合对)/表演提示/星号残留;段标归一为英文小写紧凑标签
import fs from "node:fs";
import path from "node:path";
const BS = String.fromCharCode(92), NL = String.fromCharCode(10);
const SEC = { '引子': 'intro', '前奏': 'intro', '主歌一': 'verse1', '主歌二': 'verse2', '主歌三': 'verse3', '主歌四': 'verse4', '预副歌': 'prechorus', '副歌': 'chorus', '副歌一': 'chorus1', '副歌二': 'chorus2', '终副歌': 'finalchorus', '桥段': 'bridge', '间奏': 'interlude', '尾声': 'outro', '尾奏': 'outro' };
const NUM = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5' };
const ws = process.argv[2];
if (!ws || !fs.existsSync(ws)) { console.error('usage: node suno-lyrics.mjs <workspace>'); process.exit(1); }
const lyricRe = new RegExp('## 歌词[^' + BS + 'r' + BS + 'n]*' + BS + 'r?' + BS + 'n([' + BS + 's' + BS + 'S]*?)(?=' + BS + 'r?' + BS + 'n## |' + BS + 'r?' + BS + 'n---|$)');
const lineRe = new RegExp(BS + 'r?' + BS + 'n');
const secHalf = new RegExp('^' + BS + '*' + BS + '*' + BS + '[(.+?)' + BS + '](?:·[^*]*)?' + BS + '*' + BS + '*' + '$');
const secFull = new RegExp('^' + BS + '*' + BS + '*' + '【(.+?)】(?:·[^*]*)?' + BS + '*' + BS + '*' + '$');
const asterOnly = new RegExp('^' + BS + '*+$');
function normSection(name) {
  const en = name.toLowerCase().replace(new RegExp(BS + 's+', 'g'), '');
  if (/^verse[0-9]?$/.test(en)) return en;
  if (en === 'prechorus' || en === 'finalchorus' || en === 'bridge' || en === 'intro' || en === 'outro' || en === 'interlude') return en;
  if (/^chorus[0-9]?$/.test(en)) return en;
  if (SEC[name]) return SEC[name];
  const base = name.split('·')[0].split('(')[0].trim();
  if (SEC[base]) return SEC[base];
  const num = NUM[Array.from(name).find((c) => NUM[c]) || ''] || '';
  if (name.includes('终') && name.includes('副歌')) return 'finalchorus';
  if (name.includes('预') && name.includes('副歌')) return 'prechorus';
  if (name.includes('主歌')) return 'verse' + (num || '');
  if (name.includes('副歌')) return num ? 'chorus' + num : 'chorus';
  if (name.includes('桥')) return 'bridge';
  if (name.includes('间奏')) return 'interlude';
  if (name.includes('引') || name.includes('前奏')) return 'intro';
  if (name.includes('尾')) return 'outro';
  return 'chorus';
}
function tagOf(name) { return '[' + normSection(name) + ']'; }
function clean(l) {
  return l.replace(new RegExp('^' + BS + 'd+' + BS + '.' + BS + 's*'), '')
    .replace(new RegExp('〔[^〕]*〕', 'g'), '')
    .replace(new RegExp('【[^】]*】', 'g'), '')
    .replace(new RegExp('（[^）]*）|' + BS + '[^' + BS + ')]*' + BS + ')|（[^)]*', 'g'), '')
    .replace(new RegExp('[（(][^)）]*[)）]', 'g'), '')
    .replace(new RegExp('^[(（][^)）]*[)）]' + BS + 's*'), '')
    .replace(new RegExp(BS + 's+', 'g'), ' ').trim();
}
let made = 0;
for (const f of fs.readdirSync(ws).filter((x) => x.endsWith('-姬重耳.md'))) {
  const md = fs.readFileSync(path.join(ws, f), 'utf8');
  const m = md.match(lyricRe);
  if (!m) { console.error('skip(无歌词区): ' + f); continue; }
  const out = [];
  for (const raw of m[1].split(lineRe)) {
    let l = raw.trim();
    if (!l || asterOnly.test(l)) continue;
    const sec = l.match(secHalf) || l.match(secFull);
    if (sec) { if (out.length && out[out.length - 1] !== '') out.push(''); out.push(tagOf(sec[1])); continue; }
    l = clean(l);
    if (!l || asterOnly.test(l)) continue;
    const bare = l.match(new RegExp('^' + BS + '[(.+?)' + BS + ']$'));
    if (bare) { if (out.length && out[out.length - 1] !== '') out.push(''); out.push(tagOf(bare[1])); continue; }
    if (out.length && out[out.length - 1] === '' && out[out.length - 2] === l) continue;
    out.push(l);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  const txt = out.join(NL) + NL;
  const of = f.replace(new RegExp(BS + '.md$'), '.suno.txt');
  fs.writeFileSync(path.join(ws, of), txt, 'utf8');
  made++;
  console.log(of + '  ' + txt.split(NL).filter((x) => x && !x.startsWith('[')).length + ' 行');
}
console.log('done: ' + made + ' files');