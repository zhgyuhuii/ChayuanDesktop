import type { SrtCue } from './srtParse';

const MIN_CUE_MS = 200;

/** 改 cue 起止时间;夹正(start≥0,end≥start+200ms)。 */
export function editCueTime(cues: SrtCue[], i: number, startMs: number, endMs: number): SrtCue[] {
  const s = Math.max(0, Math.round(startMs));
  const e = Math.max(s + MIN_CUE_MS, Math.round(endMs));
  return cues.map((c, idx) => (idx === i ? { ...c, startMs: s, endMs: e } : c));
}

/** 改 cue 文字,保留时间。 */
export function editCueText(cues: SrtCue[], i: number, text: string): SrtCue[] {
  return cues.map((c, idx) => (idx === i ? { ...c, text } : c));
}

const ts = (ms: number): string => {
  const v = Math.max(0, Math.round(ms));
  const h = Math.floor(v / 3600000);
  const m = Math.floor((v % 3600000) / 60000);
  const s = Math.floor((v % 60000) / 1000);
  const milli = v % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(milli, 3)}`;
};

/** cue 数组 → SRT 文本(回传 compose 渲染)。 */
export function cuesToSrt(cues: SrtCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${ts(c.startMs)} --> ${ts(c.endMs)}\n${(c.text ?? '').trim()}\n`).join('\n');
}

/** 用整体编辑的文本行重建 cues:行数与原 cue 数相同→保留各自时间只换文字;
 *  不同→在 [0,totalMs] 均匀分配。空行忽略。 */
export function rebuildCuesFromLines(cues: SrtCue[], lines: string[], totalMs: number): SrtCue[] {
  const texts = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (texts.length === cues.length) {
    return cues.map((c, i) => ({ ...c, text: texts[i]! }));
  }
  const n = texts.length;
  if (n === 0) return [];
  const span = Math.max(1000, totalMs) / n;
  return texts.map((t, i) => ({ startMs: Math.round(i * span), endMs: Math.round((i + 1) * span), text: t }));
}
