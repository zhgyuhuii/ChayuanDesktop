/**
 * 流式回答的句切器 —— 把 LLM 流式 token 切成"完整句",供逐句 TTS。
 * 句界 = 句末/分隔标点(。！？!?；;:、,，)或换行。纯函数,便于单测。
 */
const SENTENCE_END = /[。！？!?；;：:、,，\n]/;

/** 把文本切成段:每遇句界收一段(含句界字符);尾部无句界的残段也单独成段(未完成)。 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (SENTENCE_END.test(ch)) { out.push(buf); buf = ''; }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * 从 fromChar 起,取出"已完成"的句(以句界结尾);遇到第一个未完成残段即停。
 * 返回 { sentences, consumed=新的已消费字符数 }。流式里反复调:把 consumed 喂回 fromChar。
 */
export function takeCompleteSentences(
  text: string, fromChar: number,
): { sentences: string[]; consumed: number } {
  const rest = text.slice(fromChar);
  const segs = splitSentences(rest);
  const sentences: string[] = [];
  let consumed = fromChar;
  for (const s of segs) {
    const last = s[s.length - 1] ?? '';
    if (SENTENCE_END.test(last)) { sentences.push(s); consumed += s.length; }
    else break;
  }
  return { sentences, consumed };
}
