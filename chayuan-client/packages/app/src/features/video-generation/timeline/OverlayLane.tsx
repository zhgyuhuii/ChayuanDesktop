import * as React from 'react';
import { Type, Trash2, Square, Circle, Minus, MoveUpRight, Image as ImageIcon, Grid2x2 } from 'lucide-react';
import { TRACK_H } from './TrackHeader';
import type { VgOverlay } from '@chayuan/api';

const OV_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  text: Type, rect: Square, ellipse: Circle, line: Minus, arrow: MoveUpRight, image: ImageIcon, mosaic: Grid2x2,
};
const OV_LABEL: Record<string, string> = {
  text: '文字', rect: '矩形', ellipse: '椭圆', line: '直线', arrow: '箭头', image: '图片', mosaic: '马赛克',
};

/** 时间轴叠加轨:每个叠加元素一个可拖位置 + 两端拉时长的条。 */
export const OverlayLane: React.FC<{
  overlays?: VgOverlay[];
  pxPerSec: number;
  contentWidthPx: number;
  selectedOverlayIds?: string[];
  onSelect?: (id: string | null, additive?: boolean) => void;
  onPatch?: (id: string, patch: { track_start_ms?: number; duration_ms?: number }) => void;
  onDelete?: (id: string) => void;
}> = ({ overlays, pxPerSec, contentWidthPx, selectedOverlayIds = [], onSelect, onPatch, onDelete }) => {
  const px = (ms: number) => (ms / 1000) * pxPerSec;
  const drag = (e: React.PointerEvent, ov: VgOverlay, mode: 'move' | 'l' | 'r') => {
    e.preventDefault(); e.stopPropagation();
    onSelect?.(ov.id, e.ctrlKey || e.metaKey);
    if (!onPatch) return;
    const sx = e.clientX;
    const s0 = ov.track_start_ms; const d0 = ov.duration_ms;
    const move = (ev: PointerEvent) => {
      const dms = ((ev.clientX - sx) / pxPerSec) * 1000;
      if (mode === 'move') onPatch(ov.id, { track_start_ms: Math.max(0, Math.round(s0 + dms)) });
      else if (mode === 'r') onPatch(ov.id, { duration_ms: Math.max(200, Math.round(d0 + dms)) });
      else { const ns = Math.max(0, Math.round(s0 + dms)); onPatch(ov.id, { track_start_ms: ns, duration_ms: Math.max(200, Math.round(d0 - (ns - s0))) }); }
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <div className="relative border-b border-[var(--cy-border-subtle)]" style={{ height: TRACK_H, width: contentWidthPx }}>
      {(overlays || []).map((ov) => {
        const sel = selectedOverlayIds.includes(ov.id);
        return (
          <div key={ov.id}
            onPointerDown={(e) => drag(e, ov, 'move')}
            title={ov.text || ov.type}
            className={'absolute top-1 flex h-[calc(100%-8px)] cursor-grab items-center gap-1 overflow-hidden rounded px-1 text-[10px] text-white ' +
              (sel ? 'ring-2 ring-white bg-[var(--cy-brand-600)]' : 'bg-[var(--cy-brand-500)]/80')}
            style={{ left: px(ov.track_start_ms), width: Math.max(12, px(ov.duration_ms)) }}>
            {(() => { const Ic = OV_ICON[ov.type] || Type; return <Ic className="h-2.5 w-2.5 shrink-0" />; })()}
            <span className="truncate">{ov.type === 'text' ? (ov.text || '文字') : (OV_LABEL[ov.type] || ov.type)}</span>
            {sel && (
              <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDelete?.(ov.id); }}
                className="ml-auto shrink-0 text-white/90 hover:text-rose-200"><Trash2 className="h-2.5 w-2.5" /></button>
            )}
            <span onPointerDown={(e) => drag(e, ov, 'l')} className="absolute left-0 top-0 h-full w-1 cursor-ew-resize bg-white/40" />
            <span onPointerDown={(e) => drag(e, ov, 'r')} className="absolute right-0 top-0 h-full w-1 cursor-ew-resize bg-white/40" />
          </div>
        );
      })}
    </div>
  );
};
