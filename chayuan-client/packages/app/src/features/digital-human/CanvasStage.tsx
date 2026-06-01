import * as React from 'react';
import { digitalHuman, type AvatarSlot } from '@chayuan/api';

export interface CanvasStageProps {
  width: number;          // 画幅像素(仅定比例)
  height: number;
  roles: AvatarSlot[];    // 每角色 ref/kind/name/x/y/scale(归一)
  onChange?: (ref: string, pos: { x: number; y: number; scale: number }) => void;
  readOnly?: boolean;
}

/** 按画幅比例显示舞台,角色缩略图按归一 x/y/scale 摆放,可拖拽改位置(归一)。
 *  编辑器(可拖)与生成预览(readOnly)共用。 */
export const CanvasStage: React.FC<CanvasStageProps> = ({ width, height, roles, onChange, readOnly }) => {
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{ ref: string; dx: number; dy: number } | null>(null);
  const resizeRef = React.useRef<{ ref: string; startX: number; startScale: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent, r: AvatarSlot) => {
    if (readOnly || !boxRef.current) return;
    const box = boxRef.current.getBoundingClientRect();
    const curX = (r.x ?? 0) * box.width;
    const curY = (r.y ?? 0) * box.height;
    dragRef.current = { ref: r.ref, dx: e.clientX - box.left - curX, dy: e.clientY - box.top - curY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizeDown = (e: React.PointerEvent, r: AvatarSlot) => {
    if (readOnly) return;
    e.stopPropagation();
    resizeRef.current = { ref: r.ref, startX: e.clientX, startScale: r.scale ?? 1 };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const rz = resizeRef.current;
    if (rz && boxRef.current && onChange) {
      const box = boxRef.current.getBoundingClientRect();
      const delta = (e.clientX - rz.startX) / box.width;
      const ns = Math.min(1.0, Math.max(0.05, rz.startScale + delta));
      const r = roles.find((x) => x.ref === rz.ref);
      onChange(rz.ref, { x: r?.x ?? 0, y: r?.y ?? 0, scale: ns });
      return;
    }
    const d = dragRef.current;
    if (!d || !boxRef.current || !onChange) return;
    const box = boxRef.current.getBoundingClientRect();
    const nx = Math.min(0.99, Math.max(0, (e.clientX - box.left - d.dx) / box.width));
    const ny = Math.min(0.99, Math.max(0, (e.clientY - box.top - d.dy) / box.height));
    const r = roles.find((x) => x.ref === d.ref);
    onChange(d.ref, { x: nx, y: ny, scale: r?.scale ?? 1 });
  };
  const onPointerUp = () => { dragRef.current = null; resizeRef.current = null; };

  return (
    <div ref={boxRef}
      onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
      className="relative mx-auto overflow-hidden rounded-lg bg-black"
      style={{ aspectRatio: `${width} / ${height}`, height: '100%', maxWidth: '100%' }}>
      {roles.map((r) => (
        <div key={r.ref}
          onPointerDown={(e) => onPointerDown(e, r)}
          className={'absolute ' + (readOnly ? '' : 'cursor-move')}
          style={{ left: `${(r.x ?? 0) * 100}%`, top: `${(r.y ?? 0) * 100}%`, width: `${(r.scale ?? 1) * 100}%` }}>
          {r.kind === 'video'
            ? <video src={digitalHuman.avatarFileUrl(r.ref)} muted loop autoPlay playsInline className="w-full rounded" />
            : <img src={digitalHuman.avatarFileUrl(r.ref)} alt={r.name || r.ref} className="w-full rounded" />}
          {r.name ? <span className="absolute -bottom-4 left-0 rounded bg-black/60 px-1 text-[10px] text-white">{r.name}</span> : null}
          {!readOnly && (
            <div
              onPointerDown={(e) => onResizeDown(e, r)}
              className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize rounded-sm bg-[var(--cy-brand-500)] opacity-80"
              title="拖拽调整大小" />
          )}
        </div>
      ))}
    </div>
  );
};
