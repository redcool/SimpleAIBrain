/** M04 §2:relevance v1 简化——tags 命中 + 标题/正文子串;不做向量、不做 FTS */

/**
 * 计分(确定性):
 * - 每个词:tags 精确命中 +1;标题包含 +1;否则正文包含 +0.5
 * - 多词时整串短语:标题包含 +1,正文包含 +0.5
 * 返回 ≥ 0;0 = 无关。
 */
export function relevance(e: { title: string; body: string; tags?: string[] }, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const terms = q.split(/\s+/).filter(Boolean);
  const title = e.title.toLowerCase();
  const body = e.body.toLowerCase();
  const tags = (e.tags ?? []).map((t) => t.toLowerCase());
  let s = 0;
  for (const t of terms) {
    if (tags.indexOf(t) !== -1) s += 1;
    if (title.indexOf(t) !== -1) s += 1;
    else if (body.indexOf(t) !== -1) s += 0.5;
  }
  if (terms.length > 1) {
    if (title.indexOf(q) !== -1) s += 1;
    if (body.indexOf(q) !== -1) s += 0.5;
  }
  return s;
}
