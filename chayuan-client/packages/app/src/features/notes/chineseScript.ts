/**
 * 笔记编辑器的"简体 ↔ 繁体"切换工具。
 *
 * 用 opencc-js(OpenCC 数据,词组级转换,准确度远高于 zhconv 字级转换):
 *   - 'cn' → 'tw': 简体 → 台湾繁体(常见词组替换,如 软件→軟體 / 项目→項目)
 *   - 'tw' → 'cn': 台湾繁体 → 简体
 *
 * Converter 首次调用时才加载词典(~ 几十 KB),延迟初始化避免开屏 + 单测开销。
 */
import { Converter } from 'opencc-js';

export type ChineseScript = 'cn' | 'tw';

type ConvFn = (s: string) => string;

let _toSimplified: ConvFn | null = null;
let _toTraditional: ConvFn | null = null;

const toSimplified = (): ConvFn => {
  if (!_toSimplified) _toSimplified = Converter({ from: 'tw', to: 'cn' });
  return _toSimplified;
};
const toTraditional = (): ConvFn => {
  if (!_toTraditional) _toTraditional = Converter({ from: 'cn', to: 'tw' });
  return _toTraditional;
};

/** 走遍 ProseMirror JSON 树,把所有 type==='text' 节点的 text 字段过 fn。
 *  保留 marks / 嵌套结构 / 非文本节点(image / hardBreak / 段落属性等)。 */
function transformTextNodes(node: unknown, fn: ConvFn): unknown {
  if (!node || typeof node !== 'object') return node;
  const obj = node as Record<string, unknown>;
  if (obj.type === 'text' && typeof obj.text === 'string') {
    return { ...obj, text: fn(obj.text) };
  }
  if (Array.isArray(obj.content)) {
    return { ...obj, content: obj.content.map((c) => transformTextNodes(c, fn)) };
  }
  return obj;
}

/** Tiptap editor JSON 整体转 cn/tw。caller 负责拿到 editor 然后 setContent。
 *  返回新的 JSON,不直接 mutate editor — 调用方决定怎么提交(setContent / dispatch)。 */
export function convertEditorChinese(json: unknown, target: ChineseScript): unknown {
  const fn = target === 'cn' ? toSimplified() : toTraditional();
  return transformTextNodes(json, fn);
}

/** 短字符串便捷转换(测试 / 状态栏提示 / 文件名前缀等用)。 */
export function convertText(text: string, target: ChineseScript): string {
  if (!text) return text;
  const fn = target === 'cn' ? toSimplified() : toTraditional();
  return fn(text);
}
