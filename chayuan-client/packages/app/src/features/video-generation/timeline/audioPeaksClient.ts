/**
 * 客户端解码音频波形 —— 给"插入音频轨"上的任意音频素材画波形(后端没有按素材
 * 取 peaks 的端点,这里用 Web Audio 在浏览器/Tauri webview 本地解码)。
 *
 * decodeAudioPeaks(url, n):fetch → decodeAudioData → 每桶取绝对值峰值 → 归一到 0~1。
 * 失败(跨域/格式/解码不支持)返 [],调用方降级显示纯块即可。
 */
const _cache = new Map<string, number[]>();

export async function decodeAudioPeaks(url: string, n = 240): Promise<number[]> {
  if (!url) return [];
  const hit = _cache.get(url);
  if (hit) return hit;
  try {
    const resp = await fetch(url);
    const buf = await resp.arrayBuffer();
    // webkit 前缀兜底(部分 WebKitGTK)
    const Ctx: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    try {
      const audio = await ctx.decodeAudioData(buf.slice(0));
      const ch = audio.getChannelData(0);
      const bucket = Math.max(1, Math.floor(ch.length / n));
      const peaks: number[] = [];
      let max = 0;
      for (let i = 0; i < n; i++) {
        let peak = 0;
        const start = i * bucket;
        for (let j = 0; j < bucket && start + j < ch.length; j++) {
          const v = Math.abs(ch[start + j]!);
          if (v > peak) peak = v;
        }
        peaks.push(peak);
        if (peak > max) max = peak;
      }
      const norm = max > 0 ? peaks.map((p) => p / max) : peaks;
      _cache.set(url, norm);
      return norm;
    } finally {
      void ctx.close();
    }
  } catch {
    return [];
  }
}
