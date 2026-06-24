/**
 * 识别 KB 会话里的「整篇总结某文件」意图(M3,方案A 的对话 NL 轨)。
 *
 * 规则:必须同时满足 ① 命中总结类关键词 ② 在问题里能**唯一**匹配到本 KB 的某个文件名,
 * 才返回该文件名;否则返回 null(交给普通会话处理,绝不瞎猜/误劫持)。
 * 文件名匹配:整名或去扩展名后的主名,作为子串出现在 query 里(大小写不敏感)。
 */

const INTENT_KEYWORDS = [
  // 概括/摘要类
  '总结', '概括', '归纳', '摘要', '概要', '梗概', '大意', '大致', '主旨', '要点', '重点',
  '主要内容', '核心内容', '整体内容', '主要讲', '主要说',
  '全文', '通篇', '整篇', '整份', '全篇',
  // 「内容是什么」类
  '内容是什么', '内容是啥', '什么内容', '啥内容', '主题是什么', '重点是什么',
  // 「写/讲/说……是什么」类(覆盖 的/了/些/啥 各种说法)
  '写的是什么', '写的什么', '写了什么', '写了些什么', '写了啥', '写的啥',
  '讲的是什么', '讲的什么', '讲了什么', '讲了些什么', '讲了啥', '讲的啥', '讲什么', '在讲什么', '讲述了什么', '讲述什么',
  '说的是什么', '说的什么', '说了什么', '说了些什么', '说了啥', '说的啥', '说什么', '在说什么',
  '阐述了什么', '介绍了什么', '描述了什么',
  // 「关于什么」类
  '是关于什么', '关于什么', '关于啥', '是关于啥', '是讲什么', '是说什么',
  // 祈使/口语类
  '介绍一下', '简述', '简要介绍', '简单介绍', '大概讲', '大概说', '讲讲', '说说这', '这份文件是什么', '这个文件是什么',
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
