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
  // 从问题里抽「核心指代词」:去掉意图关键词 + 文件/文档/这个/请/帮我/的/了/吗 等脚手架,
  // 余下连续的中英数字片段(长度>=2)就是用户对文件的称呼(往往是文件名的一部分,
  // 如「答辩状」之于「民事答辩状最终版.docx」)。
  const coreTokens = extractCoreTokens(q);
  const matched = fileNames.filter((f) => {
    if (!f) return false;
    const full = f.toLowerCase();
    const base = stripExt(f).toLowerCase();
    if (base.length < 2) return false;
    // 双向匹配:① 用户打了完整/部分文件名(整名/主名出现在问题里);
    //          ② 用户只给了简称(核心词是文件名主名的子串,或反之)。
    if (ql.includes(full) || ql.includes(base)) return true;
    return coreTokens.some((t) => base.includes(t) || t.includes(base));
  });
  const uniq = Array.from(new Set(matched));
  if (uniq.length !== 1) return null;
  return { fileName: uniq[0]! };
}

/** 抽取问题里对文件的「核心指代」片段(去意图词 + 脚手架),返回长度>=2 的连续中英数字串。 */
function extractCoreTokens(query: string): string[] {
  let c = query;
  for (const k of INTENT_KEYWORDS) c = c.split(k).join(' ');
  // 去掉常见脚手架词与标点(不含文件名常见字符)
  c = c.replace(
    /(这个|那个|这份|那份|该|本|文件|文档|内容|一下|帮我|麻烦|请问|请|大概|简单|的|了|是|吗|呢|啊|把|对|看看|说说|讲讲)/g,
    ' ',
  );
  return c
    .toLowerCase()
    .split(/[^0-9a-z\u4e00-\u9fa5._-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}
