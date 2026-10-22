#!/usr/bin/env node
// M11 配套:歌词双版交付——从歌曲 md 歌词区剥出 Suno 纯净版(.suno.txt)
// 0.0.16.17:泛化过滤(<workspace> [人名]);兼容:行首[NN|韵]/裸行号/行尾[注]/——注/>引用/###小节/**粗体**小节/子弹-
import fs from "node:fs";
import path from "node:path";
const BS = String.fromCharCode(92), NL = String.fromCharCode(10), RB = String.fromCharCode(93);
const SEC = { '引子': 'intro', '前奏': 'intro', '主歌一': 'verse1', '主歌二': 'verse2', '主歌三': 'verse3', '主歌四': 'verse4', '主歌A': 'verse1', '主歌B': 'verse2', '主歌C': 'verse3', '主歌D': 'verse4', '预副歌': 'prechorus', '副歌': 'chorus', '副歌一': 'chorus1', '副歌二': 'chorus2', '副歌A': 'chorus1', '副歌B': 'chorus2', '终副歌': 'finalchorus', '桥段': 'bridge', '间奏': 'interlude', '尾声': 'outro', '尾奏': 'outro' };
const NUM = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5' };
const ws = process.argv[2];
if (!ws || !fs.existsSync(ws)) { console.error('usage: node suno-lyrics.mjs <workspace> [人名]'); process.exit(1); }
const lyricRe = new RegExp('## [^' + BS + 'r' + BS + 'n]*歌词[^' + BS + 'r' + BS + 'n]*' + BS + 'r?' + BS + 'n([' + BS + 's' + BS + 'S]*?)(?=' + BS + 'r?' + BS + 'n## |$)');
const lineRe = new RegExp(BS + 'r?' + BS + 'n');
const secHalf = new RegExp('^' + BS + 's*' + '(?:' + BS + '*' + ')*' + BS + '[(.+?)' + BS + '](?:·[^*]*)?' + BS + 's*' + '(' + BS + '*' + ')?' + '$');
const secFull = new RegExp('^' + BS + 's*' + '(?:' + BS + '*' + ')*【([^】]+)】');
const asterOnly = new RegExp('^' + BS + '*+$');
function splitSub(name) { const p = name.split('|')[0].trim(); return p && p !== name ? p : name; }
function normSection(name) { name = splitSub(name);
  const en = name.toLowerCase().replace(new RegExp(BS + 's+', 'g'), '');
  if (/^verse[0-9]?$/.test(en)) return en;
  if (en === 'prechorus' || en === 'finalchorus' || en === 'bridge' || en === 'intro' || en === 'outro' || en === 'interlude') return en;
  if (/^chorus[0-9]?$/.test(en)) return en;
  if (SEC[name]) return SEC[name];
  const base = name.split('·')[0].split('(')[0].trim();
  if (SEC[base]) return SEC[base];
  const num = NUM[base.slice(-1)];
  if (base.startsWith('主歌') && num) return 'verse' + num;
  if ((base.startsWith('副歌') || base.startsWith('合')) && num) return 'chorus' + num;
  return null;
}
function tagOf(name) { const t = normSection(name); return t ? '[' + t + ']' : null; }
function stripTrailingTag(l) {
  if (!l.endsWith(']')) return l;
  let depth = 0;
  for (let i = l.length - 1; i >= 0; i--) {
    const ch = l[i];
    if (ch === ']') depth++;
    else if (ch === '[') { depth--; if (depth === 0) { const inner = l.slice(i + 1, l.length - 1); return inner.includes('|') ? l.slice(0, i).trimEnd() : l; } }
  }
  return l;
}
function clean(l) {
  l = l.replace(new RegExp('^' + BS + '-+' + BS + 's*'), '');
  l = l.replace(new RegExp('^[0-9]+' + BS + 's+'), '');
  l = l.replace(new RegExp('^#{1,6}' + BS + 's*'), '');
  const mi = l.indexOf(']');
  if (l.startsWith('[') && mi > 0 && l.slice(1, mi).includes('|')) l = l.slice(mi + 1).trim();
  l = stripTrailingTag(l);
  l = l.replace(new RegExp('——.*$'), '');
  return l.replace(new RegExp('^' + BS + 'd+' + BS + '.' + BS + 's*'), '')
    .replace(new RegExp('〔[^〕]*〕', 'g'), '')
    .replace(new RegExp('【[^】]*】', 'g'), '')
    .replace(new RegExp('[（(][^)）]*[)）]', 'g'), '')
    .replace(new RegExp(BS + 's+', 'g'), ' ').trim();
}
let made = 0;
const nameArg = process.argv[3];
for (const f of fs.readdirSync(ws).filter((x) => x.endsWith('.md') && (!nameArg || x.endsWith('-' + nameArg + '.md')))) {
  const md = fs.readFileSync(path.join(ws, f), "utf8");
  const m = md.match(lyricRe);
  if (!m) { console.error('skip(无歌词区): ' + f); continue; }
  const out = [];
  for (const raw of m[1].split(lineRe)) {
    let l = raw.trim();
    if (!l || asterOnly.test(l)) continue;
    if (l.startsWith('>')) continue;
    if (/^#{1,6}/.test(l)) { const hh = l.replace(/^#+/, '').trim(); const tg = hh && tagOf(hh); if (tg) { if (out.length && out[out.length - 1] !== '') out.push(''); out.push(tg); } continue; }
    if (/^\*\*.+\*\*$/.test(l)) { const hh = l.replace(/^\*\*/, '').replace(/\*\*$/, '').replace(/[0-9]+[  ]*$/, '').trim(); const tg = hh && tagOf(hh); if (tg) { if (out.length && out[out.length - 1] !== '') out.push(''); out.push(tg); } continue; }
    const sec = l.match(secHalf) || l.match(secFull); if (sec) sec[1] = splitSub(sec[1]);
    if (sec) { const tg = tagOf(sec[1]); if (tg) { if (out.length && out[out.length - 1] !== '') out.push(''); out.push(tg); } continue; }
    l = clean(l);
    if (!l || asterOnly.test(l)) continue;
    const bare = l.match(new RegExp('^' + BS + '[(.+?)' + BS + ']$'));
    if (bare) { const tg = tagOf(bare[1]); if (tg) { if (out.length && out[out.length - 1] !== '') out.push(''); out.push(tg); continue; } }
    if (out.length && out[out.length - 1] === '' && out[out.length - 2] === l) continue;
    out.push(l);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  const txt = out.join(NL) + NL;
  const of = f.replace(new RegExp(BS + '.md$'), '.suno.txt');
  fs.writeFileSync(path.join(ws, of), txt, "utf8");
  made++;
  console.log(of + '  ' + txt.split(NL).filter((x) => x && !x.startsWith('[')).length + ' 行');
}
console.log('done: ' + made + ' files');