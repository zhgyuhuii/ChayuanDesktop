import * as React from 'react';
import { videoGeneration, type VgTimeline, type VgTimelineClip } from '@chayuan/api';
import { clipDurMs } from './timelineEdit';

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

/** 单个视频元素:按 playhead seek 到对应帧(静帧/scrub,不自动播放)。 */
const FrameVideo: React.FC<{ url: string; clip: VgTimelineClip; playheadMs: number; className?: string; style?: React.CSSProperties }>
  = ({ url, clip, playheadMs, className, style }) => {
  const ref = React.useRef<HTMLVideoElement | null>(null);
  React.useEffect(() => {
    const v = ref.current; if (!v) return;
    const t = Math.max(0, (playheadMs - clip.track_start_ms) / 1000 + (clip.in_ms ?? 0) / 1000);
    const apply = () => { if (Number.isFinite(t) && Math.abs(v.currentTime - t) > 0.05) { try { v.currentTime = t; } catch { /* not ready */ } } };
    if (v.readyState >= 1) apply(); else v.addEventListener('loadedmetadata', apply, { once: true });
  }, [url, playheadMs, clip.track_start_ms, clip.in_ms]);
  return <video ref={ref} src={url} muted preload="metadata" className={className} style={style} />;
};

/**
 * 实时预览画布:不依赖服务端 proxy,直接用 DOM 渲染当前 playhead 的画面。
 *  - 主视频轨(第 0 条)命中 clip → 铺满底层。
 *  - 附加视频轨(PIP)→ 按 x/y/scale 定位叠加,层级 = 轨道顺序(越靠后越上层)。
 *  - PIP 框可拖拽移动 + 拖角缩放(回写 x/y/scale)。
 */
export const LivePreviewCanvas: React.FC<{
  timeline: VgTimeline;
  playheadMs: number;
  onTransform: (clipId: string, tf: { x?: number; y?: number; scale?: number }) => void;
}> = ({ timeline, playheadMs, onTransform }) => {
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const videoTracks = (timeline.tracks || []).filter((t) => t.kind === 'video');
  const base = clipAt(videoTracks[0]?.clips, playheadMs);
  const baseUrl = base ? clipUrl(base) : null;

  type Corner = 'nw' | 'ne' | 'sw' | 'se';
  const drag = (e: React.PointerEvent, clipId: string, mode: 'move' | Corner, cur: { x: number; y: number; scale: number }) => {
    e.preventDefault(); e.stopPropagation();
    const box = boxRef.current?.getBoundingClientRect(); if (!box) return;
    const sx = e.clientX; const sy = e.clientY;
    const isLeft = mode === 'nw' || mode === 'sw';
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / box.width; const dy = (ev.clientY - sy) / box.height;
      if (mode === 'move') { onTransform(clipId, { x: cur.x + dx, y: cur.y + dy }); return; }
      // 左侧角:拖动会移动左边,对右边锚定 → x 跟着补偿;右侧角:左上锚定。
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
      {/* 底层:主视频轨当前帧 */}
      {baseUrl && base && (
        isImageUrl(baseUrl)
          ? <img src={baseUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
          : <FrameVideo url={baseUrl} clip={base} playheadMs={playheadMs} className="absolute inset-0 h-full w-full object-contain" />
      )}
      {!baseUrl && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-white/50">拖素材到视频轨即可预览</div>
      )}
      {/* PIP 层:附加视频轨,层级按轨序(越靠前=越上层,遮盖靠后) */}
      {videoTracks.slice(1).map((tr, ti) => {
        const c = clipAt(tr.clips, playheadMs);
        if (!c) return null;
        const url = clipUrl(c); if (!url) return null;
        const x = c.x ?? 0; const y = c.y ?? 0; const scale = c.scale ?? 0.4;
        return (
          <div key={c.id} className="absolute cursor-move border-2 border-[var(--cy-brand-500)]"
            style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${scale * 100}%`, zIndex: 100 - ti }}
            onPointerDown={(e) => drag(e, c.id, 'move', { x, y, scale })}>
            {isImageUrl(url)
              ? <img src={url} alt="" draggable={false} className="pointer-events-none w-full" />
              : <FrameVideo url={url} clip={c} playheadMs={playheadMs} className="pointer-events-none w-full" />}
            {CORNERS.map(({ c: corner, cls }) => (
              <span key={corner} onPointerDown={(e) => drag(e, c.id, corner, { x, y, scale })}
                className={`absolute h-3 w-3 rounded-full border border-white bg-[var(--cy-brand-600)] ${cls}`} />
            ))}
          </div>
        );
      })}
    </div>
  );
};
