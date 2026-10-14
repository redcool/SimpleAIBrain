/** 标题 → 文件 slug:空白折叠为 '-',白名单(a-z0-9/汉字/连字符)外全部剔除,限长 */
export function slugify(s: string, max = 40): string {
  const out = (s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return out;
}
