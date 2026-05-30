import * as React from 'react';
import { videoGeneration, type VgTimeline, type VgTimelineClip } from '@chayuan/api';
import { clipDurMs } from './timelineEdit';
import type { SrtCue } from './srtParse';

/** 解析 clip 的可播放 URL(material_id → 素材文件;url → 直接用)。path/无 → null。 */
function clipUrl(c: VgTimelineClip): string | null {
  if (c.source.material_id) return videoGeneration.materialFileUrl(c.source.material_id);
  if (c.source.url) return c.source.url;
  return null;
}
const isImageUrl = (u: string) => /\.(jpg|jpeg|png|webp|bmp|gif)(\?|$)/i.test(u);

/** 取轨道上当前 playhead 命中的 clip。 */
function clipAt(clips: VgTimelineClip[] | undefined, playheadMs: number): VgTimelineClip | null {
  for (const c of clips ?? []) {
    const s = c.track_start_ms;
    if (playheadMs >= s && playheadMs < s + clipDurMs(c)) return c;
  }
  return null;
}

/** 视频元素:暂停时按 playhead seek 静帧;播放时真 play(),仅在漂移大时校正。 */
const FrameVideo: React.FC<{ url: string; clip: VgTimelineClip; playheadMs: number; playing: boolean; className?: string }>
  = ({ url, clip, playheadMs, playing, className }) => {
  const ref = React.useRef<HTMLVideoElement | null>(null);
  React.useEffect(() => {
    const v = ref.current; if (!v) return;
    const t = Math.max(0, (playheadMs - clip.track_start_ms) / 1000 + (clip.in_ms ?? 0) / 1000);
    if (playing) {
      if (v.paused) { try { if (t >= 0) v.currentTime = t; } catch { /* noop */ } void v.play().catch(() => undefined); }
      else if (Math.abs(v.currentTime - t) > 0.4) { try { v.currentTime = t; } catch { /* noop */ } }
    } else {
      if (!v.paused) v.pause();
      const apply = () => { if (Math.abs(v.currentTime - t) > 0.05) { try { v.currentTime = t; } catch { /* noop */ } } };
      if (v.readyState >= 1) apply(); else v.addEventListener('loadedmetadata', apply, { once: true });
    }
  }, [url, playheadMs, playing, clip.track_start_ms, clip.in_ms]);
  return <video ref={ref} src={url} muted preload="metadata" className={className} />;
};

/**
 * 实时预览画布 = PhotoShop 式分层:每条视频轨都是一个独立图层,按自己的 x/y/scale
 * 定位(无 transform 默认满画幅),层级 = 轨道列表顺序(越靠上 = 越上层,遮盖下层),
 * 其余透明。黑色仅作底(没有任何画面处显黑)。每个图层悬停显边框+四角控制点,可拖移/缩放。
 */
export const LivePreviewCanvas: React.FC<{
  timeline: VgTimeline;
  playheadMs: number;
  playing?: boolean;
  onTransform: (clipId: string, tf: { x?: number; y?: number; scale?: number }) => void;
  cues?: SrtCue[];
}> = ({ timeline, playheadMs, playing = false, onTransform, cues }) => {
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const videoTracks = (timeline.tracks || []).filter((t) => t.kind === 'video');
  const cue = (cues ?? []).find((c) => playheadMs >= c.startMs && playheadMs < c.endMs);
  const anyVisible = videoTracks.some((tr) => clipAt(tr.clips, playheadMs));

  type Corner = 'nw' | 'ne' | 'sw' | 'se';
  const drag = (e: React.PointerEvent, clipId: string, mode: 'move' | Corner, cur: { x: number; y: number; scale: number }) => {
    e.preventDefault(); e.stopPropagation();
    const box = boxRef.current?.getBoundingClientRect(); if (!box) return;
    const sx = e.clientX; const sy = e.clientY;
    const isLeft = mode === 'nw' || mode === 'sw';
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / box.width; const dy = (ev.clientY - sy) / box.height;
      if (mode === 'move') { onTransform(clipId, { x: cur.x + dx, y: cur.y + dy }); return; }
      if (isLeft) onTransform(clipId, { scale: cur.scale - dx, x: cur.x + dx });
      else onTransform(clipId, { scale: cur.scale + dx });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const CORNERS: { c: Corner; cls: string }[] = [
    { c: 'nw', cls: '-top-1.5 -left-1.5 cursor-nwse-resize' },
    { c: 'ne', cls: '-top-1.5 -right-1.5 cursor-nesw-resize' },
    { c: 'sw', cls: '-bottom-1.5 -left-1.5 cursor-nesw-resize' },
    { c: 'se', cls: '-bottom-1.5 -right-1.5 cursor-nwse-resize' },
  ];

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden bg-black">
      {!anyVisible && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-white/50">拖素材到视频轨即可预览</div>
      )}
      {/* 每条视频轨 = 一个图层;列表越靠上 zIndex 越高(在前,遮盖靠下) */}
      {videoTracks.map((tr, i) => {
        const c = clipAt(tr.clips, playheadMs);
        if (!c) return null;
        const url = clipUrl(c); if (!url) return null;
        const x = c.x ?? 0; const y = c.y ?? 0; const scale = c.scale ?? 1; // 无 transform = 满画幅
        const full = x === 0 && y === 0 && scale >= 0.999;
        return (
          <div key={c.id} className="group absolute cursor-move"
            style={full
              ? { inset: 0, zIndex: 10 + (videoTracks.length - i) }
              : { left: `${x * 100}%`, top: `${y * 100}%`, width: `${scale * 100}%`, zIndex: 10 + (videoTracks.length - i) }}
            onPointerDown={(e) => drag(e, c.id, 'move', { x, y, scale })}>
            {isImageUrl(url)
              ? <img src={url} alt="" draggable={false} className={full ? 'pointer-events-none h-full w-full object-contain' : 'pointer-events-none w-full'} />
              : <FrameVideo url={url} clip={c} playheadMs={playheadMs} playing={playing} className={full ? 'pointer-events-none h-full w-full object-contain' : 'pointer-events-none w-full'} />}
            {/* 悬停显图层边框 + 四角控制点(满画幅图层也可微调) */}
            <span className="pointer-events-none absolute inset-0 border-2 border-transparent group-hover:border-[var(--cy-brand-500)]" />
            {CORNERS.map(({ c: corner, cls }) => (
              <span key={corner} onPointerDown={(e) => drag(e, c.id, corner, { x, y, scale })}
                className={`absolute h-3 w-3 rounded-full border border-white bg-[var(--cy-brand-600)] opacity-0 group-hover:opacity-100 ${cls}`} />
            ))}
          </div>
        );
      })}
      {/* 字幕叠层:当前 playhead 命中的 cue,底部居中(与画面/音频同 playhead → 可核对对齐) */}
      {cue && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[6%] z-[200] flex justify-center px-[6%]">
          <span className="max-w-full whitespace-pre-wrap rounded bg-black/55 px-2 py-0.5 text-center text-[clamp(11px,3.2vw,18px)] leading-snug text-white"
            style={{ textShadow: '0 1px 2px rgba(0,0,0,.9)' }}>
            {cue.text}
          </span>
        </div>
      )}
    </div>
  );
};
