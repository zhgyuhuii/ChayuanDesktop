/**
 * 识别 KB 会话里的「整篇总结某文件」意图(M3,方案A 的对话 NL 轨)。
 *
 * 规则:必须同时满足 ① 命中总结类关键词 ② 在问题里能**唯一**匹配到本 KB 的某个文件名,
 * 才返回该文件名;否则返回 null(交给普通会话处理,绝不瞎猜/误劫持)。
 * 文件名匹配:整名或去扩展名后的主名,作为子串出现在 query 里(大小写不敏感)。
 */

const INTENT_KEYWORDS = [
  '总结', '概括', '归纳', '摘要', '大意', '主要内容', '全文',
  '写的是什么', '写了什么', '讲了什么', '讲的什么', '说了什么', '是关于什么',
];

function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export interface SummarizeIntentHit {
  fileName: string;
}

export function detectSummarizeIntent(
  query: string,
  fileNames: string[],
): SummarizeIntentHit | null {
  const q = (query || '').trim();
  if (!q) return null;
  const hasIntent = INTENT_KEYWORDS.some((k) => q.includes(k));
  if (!hasIntent) return null;

  const ql = q.toLowerCase();
  // 候选:整名或主名作为子串命中。取「命中且最长名」以避免短名误命中;
  // 若有多个不同文件都命中 → 视为歧义,返回 null 不劫持。
  const matched = fileNames.filter((f) => {
    if (!f) return false;
    const full = f.toLowerCase();
    const base = stripExt(f).toLowerCase();
    return (full.length >= 2 && ql.includes(full)) || (base.length >= 2 && ql.includes(base));
  });
  const uniq = Array.from(new Set(matched));
  if (uniq.length !== 1) return null;
  return { fileName: uniq[0]! };
}
