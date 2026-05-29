export interface SrtCue {
  startMs: number;
  endMs: number;
  text: string;
}

const TIME_RE = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

const toMs = (h: string, m: string, s: string, ms: string): number =>
  ((+h * 60 + +m) * 60 + +s) * 1000 + +ms;

/** 解析 SRT 文本为 cue 数组。容错空行/多行文本/逗号或点的毫秒分隔。 */
export function parseSrt(text: string): SrtCue[] {
  const cues: SrtCue[] = [];
  const blocks = (text || '').replace(/\r/g, '').trim().split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const tIdx = lines.findIndex((l) => TIME_RE.test(l));
    if (tIdx < 0) continue;
    const m = lines[tIdx]!.match(TIME_RE)!;
    const startMs = toMs(m[1]!, m[2]!, m[3]!, m[4]!);
    const endMs = toMs(m[5]!, m[6]!, m[7]!, m[8]!);
    const content = lines.slice(tIdx + 1).join('\n').trim();
    if (content) cues.push({ startMs, endMs, text: content });
  }
  return cues;
}
