import * as React from 'react';
import { Music2 } from 'lucide-react';
import { videoGeneration, type VgTimeline, type VgTimelineClip } from '@chayuan/api';
import { msToPx } from './timelineScale';
import { clipDurMs, setClipStart } from './timelineEdit';
import { TRACK_H } from './TrackHeader';
import { waveformPath } from './AudioWaveTrack';
import { decodeAudioPeaks } from './audioPeaksClient';

/** 取音频 clip 的可解码文件 URL(material_id → 素材文件;否则 http url)。 */
function clipAudioUrl(c: VgTimelineClip): string | null {
  if (c.source.material_id) return videoGeneration.materialFileUrl(c.source.material_id);
  if (c.source.url && /^https?:/.test(c.source.url)) return c.source.url;
  return null;
}

/** 单个音频 clip 块:本地解码波形 + 时长。 */
const AudioClipBlock: React.FC<{
  c: VgTimelineClip; pxPerSec: number; selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}> = ({ c, pxPerSec, selected, onPointerDown, onContextMenu }) => {
  const [peaks, setPeaks] = React.useState<number[]>([]);
  const url = clipAudioUrl(c);
  React.useEffect(() => {
    let alive = true;
    if (url) void decodeAudioPeaks(url).then((p) => { if (alive) setPeaks(p); });
    return () => { alive = false; };
  }, [url]);
  const durS = clipDurMs(c) / 1000;
  const name = c.source.material_id || c.source.url || '音频';
  return (
    <div
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      style={{ left: msToPx(c.track_start_ms, pxPerSec), width: Math.max(12, msToPx(clipDurMs(c), pxPerSec)) }}
      className={`absolute top-1.5 flex h-8 cursor-grab active:cursor-grabbing flex-col justify-center overflow-hidden rounded border px-1 text-[9px] ${selected ? 'border-[var(--cy-brand-600)] ring-2 ring-[var(--cy-brand-400)] bg-sky-100 text-sky-900' : 'border-sky-300 bg-sky-50 text-sky-800'}`}
      title="拖动调整位置 · 右键删除">
      {peaks.length > 0 && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-50" viewBox={`0 0 ${peaks.length} 100`}
          preserveAspectRatio="none">
          <path d={waveformPath(peaks)} fill="rgb(2 132 199)" />
        </svg>
      )}
      <div className="relative flex items-center gap-1">
        <Music2 className="h-3 w-3 shrink-0" />
        <span className="truncate">{name}</span>
        <span className="ml-auto shrink-0 tabular-nums opacity-70">{durS.toFixed(1)}s</span>
      </div>
    </div>
  );
};

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
      {clips.map((c) => (
        <AudioClipBlock
          key={c.id} c={c} pxPerSec={pxPerSec} selected={selectedClipId === c.id}
          onPointerDown={(e) => startBodyDrag(e, c.id, c.track_start_ms)}
          onContextMenu={(e) => { if (onClipContextMenu) { e.preventDefault(); onClipContextMenu(e, c.id); } }}
        />
      ))}
    </div>
  );
};
