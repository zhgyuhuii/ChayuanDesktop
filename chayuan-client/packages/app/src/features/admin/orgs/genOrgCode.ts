/**
 * 由组织名称生成「拼音首字母」编码(新建组织表单自动填充用)。
 *
 * 规则(与设计 docs/superpowers/specs/2026-06-30-org-form-redesign-design.md 对齐):
 *  - 中文逐字取拼音首字母;英文按单词取词首字母;数字段原样保留;其余(标点/空格)忽略。
 *  - 全部小写拼接。
 *  - 与已有编码去重(大小写不敏感),撞则加 -2 / -3 …
 *  - 名称为空或无可用字符时回退 'org'。
 *
 * 例:华东研发中心 -> hdyfzx;East Lab -> el;华东A区2 -> hdaq2。
 * 编码可被用户手动改写,最终唯一性仍由后端兜底(重复返 400)。
 */
import { pinyin } from 'pinyin-pro';

function baseCode(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '';
  // token 切分:连续 ASCII 字母为一个英文词、连续数字为一段、中文逐字、其余单字符。
  const tokens = trimmed.match(/[a-zA-Z]+|[0-9]+|[一-鿿]|[\s\S]/g) || [];
  const out: string[] = [];
  for (const t of tokens) {
    if (/^[a-zA-Z]+$/.test(t)) {
      out.push(t.charAt(0).toLowerCase());
    } else if (/^[0-9]+$/.test(t)) {
      out.push(t);
    } else if (/^[一-鿿]$/.test(t)) {
      const first = pinyin(t, { pattern: 'first', toneType: 'none', type: 'array' })[0] || '';
      if (first) out.push(first.toLowerCase());
    }
    // 其余字符忽略
  }
  return out.join('');
}

export function genOrgCode(name: string, existing: Iterable<string> = []): string {
  const base = baseCode(name) || 'org';
  const taken = new Set<string>();
  for (const c of existing) taken.add((c || '').trim().toLowerCase());
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const cand = `${base}-${i}`;
    if (!taken.has(cand)) return cand;
  }
}
