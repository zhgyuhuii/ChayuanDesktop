import * as React from 'react';
import { videoGeneration, type VgTimeline } from '@chayuan/api';
import { clipDurMs } from './timelineEdit';

/** 预览区 PIP 浮层:第 2+ 视频轨在当前时刻命中的 clip 显可拖拽移动 + 拖角缩放的框。
 *  坐标 0-1 归一(相对容器),回写 clip x/y/scale。 */
export const PipOverlay: React.FC<{
  timeline: VgTimeline;
  playheadMs: number;
  onTransform: (clipId: string, tf: { x?: number; y?: number; scale?: number }) => void;
}> = ({ timeline, playheadMs, onTransform }) => {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const videoTracks = (timeline.tracks || []).filter((t) => t.kind === 'video');
  const pipClips = videoTracks.slice(1).flatMap((tr) => tr.clips ?? []);
  const active = pipClips.filter((c) => {
    const s = c.track_start_ms;
    const e = s + clipDurMs(c);
    return playheadMs >= s && playheadMs < e;
  });

  const drag = (e: React.PointerEvent, clipId: string, mode: 'move' | 'resize', cur: { x: number; y: number; scale: number }) => {
    e.preventDefault();
    e.stopPropagation();
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / box.width;
      const dy = (ev.clientY - startY) / box.height;
      if (mode === 'move') onTransform(clipId, { x: cur.x + dx, y: cur.y + dy });
      else onTransform(clipId, { scale: cur.scale + dx });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-20">
      {active.map((c) => {
        const x = c.x ?? 0;
        const y = c.y ?? 0;
        const scale = c.scale ?? 0.4;
        const thumb = c.source.material_id ? videoGeneration.materialThumbUrl(c.source.material_id) : null;
        return (
          <div key={c.id}
            className="pointer-events-auto absolute cursor-move rounded border-2 border-[var(--cy-brand-500)] bg-black/20"
            style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${scale * 100}%` }}
            onPointerDown={(e) => drag(e, c.id, 'move', { x, y, scale })}>
            {thumb && <img src={thumb} alt="" draggable={false} className="pointer-events-none w-full rounded-sm opacity-80" />}
            <span
              onPointerDown={(e) => drag(e, c.id, 'resize', { x, y, scale })}
              className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-white bg-[var(--cy-brand-600)]" />
          </div>
        );
      })}
    </div>
  );
};
