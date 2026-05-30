/**
 * 轨道音频试听:按 track_start 调度若干 <audio>,从指定起点播放。
 * 旁白轨 = 单条从 0 起播;插入音频轨 = 各 clip 按 startMs 调度。
 * 返回 stop():停止并清理所有 audio + timer。
 */
export interface AudioPreviewItem {
  url: string;
  startMs: number;
}

export function playAudioTimeline(items: AudioPreviewItem[], onEnd?: () => void, offsetMs = 0): () => void {
  const audios: HTMLAudioElement[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  let stopped = false;

  for (const it of items) {
    const a = new Audio(it.url);
    a.preload = 'auto';
    audios.push(a);
    const delay = it.startMs - offsetMs;
    if (delay <= 0) {
      // 起播点已过(从时间轴中段播放):立即播,并 seek 到已流逝的位置
      const seekS = Math.max(0, (offsetMs - it.startMs) / 1000);
      const playSeeked = () => {
        try { if (seekS > 0) a.currentTime = seekS; } catch { /* not seekable yet */ }
        if (!stopped) void a.play().catch(() => undefined);
      };
      if (a.readyState >= 1) playSeeked(); else a.addEventListener('loadedmetadata', playSeeked, { once: true });
    } else {
      const t = setTimeout(() => { if (!stopped) void a.play().catch(() => undefined); }, delay);
      timers.push(t);
    }
  }

  // 最后一条结束后回调(粗略:用最大 startMs + 监听最后一个 audio 的 ended)
  const last = audios[audios.length - 1];
  if (last && onEnd) last.addEventListener('ended', () => { if (!stopped) onEnd(); });

  return () => {
    stopped = true;
    for (const t of timers) clearTimeout(t);
    for (const a of audios) { a.pause(); a.src = ''; }
  };
}
