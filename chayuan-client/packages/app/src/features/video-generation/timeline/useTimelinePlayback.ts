import * as React from 'react';
import { videoGeneration, type VgTimeline, type VgVideoParams } from '@chayuan/api';
import { type VgTimelineDraft } from '../store/vgComposer';
import { playAudioTimeline } from './audioPreview';

export function useTimelinePlayback(args: {
  timeline: VgTimeline;
  contentMs: number;
  draft: VgTimelineDraft;
  params: VgVideoParams;
}) {
  const { timeline, contentMs, draft, params } = args;

  const [playheadMs, setPlayheadMs] = React.useState(0);
  const [seekMs, setSeekMs] = React.useState(0);
  const [seekNonce, setSeekNonce] = React.useState(0); // 播放中拖播放头 → 防抖后重启引擎从新位置续播
  const seekDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [previewMode, setPreviewMode] = React.useState<'live' | 'proxy'>('live');

  const playheadRef = React.useRef(playheadMs);
  React.useEffect(() => { playheadRef.current = playheadMs; }, [playheadMs]);

  // #17 实时播放引擎:实时画布模式下,播放键用 rAF 推进播放头 + 同步起播旁白/音频轨
  // (无需先「精确预览」proxy)。proxy 模式由 proxy <video> 自己驱动,这里不跑。
  React.useEffect(() => {
    if (!playing || previewMode !== 'live') return;
    let start = playheadRef.current;
    if (start >= contentMs - 20) start = 0; // 到末尾再按播放 = 从头
    playheadRef.current = start; // 同步,避免首帧读到旧值
    setPlayheadMs(start);
    // 音频:旁白(从 0)+ 各音频轨 clip(按 track_start)+ 背景音乐(从 0,循环,bgm_volume)
    const items: { url: string; startMs: number; volume?: number; loop?: boolean }[] = [];
    if (draft.taskId && draft.audioFileName) items.push({ url: videoGeneration.taskFileUrl(draft.taskId, draft.audioFileName), startMs: 0 });
    for (const tr of (timeline.tracks ?? [])) {
      if (tr.kind !== 'audio') continue;
      for (const c of (tr.clips ?? [])) {
        const url = c.source.material_id ? videoGeneration.materialFileUrl(c.source.material_id) : (c.source.url ?? '');
        if (url) items.push({ url, startMs: c.track_start_ms });
      }
    }
    if (params.bgm_type === 'file' && params.bgm_file) {
      const base = params.bgm_file.split(/[\\/]/).pop() || '';
      if (base) items.push({ url: videoGeneration.bgmFileUrl(base), startMs: 0, volume: params.bgm_volume, loop: true });
    }
    const stopAudio = items.length ? playAudioTimeline(items, undefined, start) : null;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const dt = now - last; last = now;
      const np = playheadRef.current + dt;
      if (np >= contentMs) { setPlayheadMs(contentMs); setPlaying(false); return; }
      setPlayheadMs(np);
      raf = requestAnimationFrame(tick);
    });
    return () => { cancelAnimationFrame(raf); stopAudio?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, previewMode, seekNonce]);

  return {
    playheadMs, setPlayheadMs,
    seekMs, setSeekMs,
    seekNonce, setSeekNonce,
    seekDebounceRef,
    playing, setPlaying,
    previewMode, setPreviewMode,
    playheadRef,
  };
}
