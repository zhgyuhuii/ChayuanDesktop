import * as React from 'react';
import { Music2 } from 'lucide-react';
import type { VgTimeline } from '@chayuan/api';
import { msToPx } from './timelineScale';
import { clipDurMs, setClipStart } from './timelineEdit';
import { TRACK_H } from './TrackHeader';

/** 插入音频轨:按 track_start_ms + clipDurMs 绝对定位音频 clip 块。
 *  支持点选高亮(#10)+ 整块水平拖动改位置(#11)+ 右键菜单。 */
export const AudioInsertTrack: React.FC<{
  timeline: VgTimeline;
  pxPerSec: number;
  contentWidthPx: number;
  onClipContextMenu?: (e: React.MouseEvent, clipId: string) => void;
  trackId?: string;
  onChange?: (t: VgTimeline) => void;
  selectedClipId?: string | null;
  onSelectClip?: (clipId: string) => void;
}> = ({ timeline, pxPerSec, contentWidthPx, onClipContextMenu, trackId, onChange, selectedClipId, onSelectClip }) => {
  const clips = (trackId
    ? (timeline.tracks || []).find((t) => t.id === trackId)
    : (timeline.tracks || []).find((t) => t.kind === 'audio'))?.clips ?? [];

  const startBodyDrag = (e: React.PointerEvent, clipId: string, origStart: number) => {
    if (!onChange) { onSelectClip?.(clipId); return; }
    const startX = e.clientX;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 4) return;
      moved = true;
      const deltaMs = ((ev.clientX - startX) / pxPerSec) * 1000;
      onChange(setClipStart(timeline, clipId, origStart + deltaMs));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) onSelectClip?.(clipId);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="relative border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
      style={{ height: TRACK_H, width: contentWidthPx }}>
      {clips.length === 0 && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">拖音频到此处</span>}
      {clips.map((c) => {
        const selected = selectedClipId === c.id;
        return (
          <div key={c.id}
            onPointerDown={(e) => startBodyDrag(e, c.id, c.track_start_ms)}
            onContextMenu={(e) => { if (onClipContextMenu) { e.preventDefault(); onClipContextMenu(e, c.id); } }}
            style={{ left: msToPx(c.track_start_ms, pxPerSec), width: Math.max(12, msToPx(clipDurMs(c), pxPerSec)) }}
            className={`absolute top-1.5 flex h-8 cursor-grab active:cursor-grabbing items-center gap-1 overflow-hidden rounded border px-1 text-[9px] ${selected ? 'border-[var(--cy-brand-600)] ring-2 ring-[var(--cy-brand-400)] bg-sky-100 text-sky-900' : 'border-sky-300 bg-sky-50 text-sky-800'}`}
            title="拖动调整位置 · 右键删除">
            <Music2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{c.source.material_id || c.source.url || '音频'}</span>
          </div>
        );
      })}
    </div>
  );
};
