export const BASE_CPS = 4.5; // 中文 TTS 基准 字/秒
export function estimateDurationMs(text: string, voiceRate = 1): number {
  const chars = (text || '').replace(/\s/g, '').length;
  const rate = voiceRate && voiceRate > 0 ? voiceRate : 1;
  return Math.round((chars / (BASE_CPS * rate)) * 1000);
}
export function fmtSec(ms: number): string {
  return `${(ms / 1000).toFixed(1)}秒`;
}
