import * as React from 'react';
import { msToPx, pxToMs } from './timelineScale';
import { TRACK_H } from './TrackHeader';
import type { SrtCue } from './srtParse';
import { editCueTime, editCueText } from './subtitleEdit';

export const SubtitleCueTrack: React.FC<{
  cues: SrtCue[];
  pxPerSec: number;
  contentWidthPx: number;
  editable?: boolean;
  onCuesChange?: (cues: SrtCue[]) => void;
  onCueContextMenu?: (e: React.MouseEvent, index: number) => void;
}> = ({ cues, pxPerSec, contentWidthPx, editable, onCuesChange, onCueContextMenu }) => {
  const [editingIdx, setEditingIdx] = React.useState<number | null>(null);

  const startDrag = (e: React.PointerEvent, i: number, edge: 'start' | 'end') => {
    if (!editable || !onCuesChange) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const c0 = cues[i]!;
    const move = (ev: PointerEvent) => {
      const d = pxToMs(ev.clientX - startX, pxPerSec);
      onCuesChange(edge === 'start'
        ? editCueTime(cues, i, c0.startMs + d, c0.endMs)
        : editCueTime(cues, i, c0.startMs, c0.endMs + d));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="relative border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
      style={{ height: TRACK_H, width: contentWidthPx }}>
      {cues.length === 0 && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">字幕(渲染后生成)</span>}
      {cues.map((c, i) => (
        <div key={i}
          style={{ left: msToPx(c.startMs, pxPerSec), width: Math.max(8, msToPx(c.endMs - c.startMs, pxPerSec)) }}
          className="absolute top-1.5 flex h-8 items-center overflow-hidden rounded border border-amber-300 bg-amber-50 px-1 text-[9px] text-amber-800"
          title={c.text}
          onDoubleClick={() => editable && setEditingIdx(i)}
          onContextMenu={(e) => { if (onCueContextMenu) { e.preventDefault(); onCueContextMenu(e, i); } }}>
          {editingIdx === i ? (
            <input autoFocus defaultValue={c.text}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => { onCuesChange?.(editCueText(cues, i, e.target.value)); setEditingIdx(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="w-full bg-transparent text-[9px] text-amber-900 outline-none" />
          ) : (
            <span className="truncate">{c.text}</span>
          )}
          {editable && onCuesChange && editingIdx !== i && (
            <>
              <span onPointerDown={(e) => startDrag(e, i, 'start')} className="absolute left-0 top-0 h-full w-1 cursor-ew-resize bg-amber-400/70 hover:bg-amber-500" />
              <span onPointerDown={(e) => startDrag(e, i, 'end')} className="absolute right-0 top-0 h-full w-1 cursor-ew-resize bg-amber-400/70 hover:bg-amber-500" />
            </>
          )}
        </div>
      ))}
    </div>
  );
};
