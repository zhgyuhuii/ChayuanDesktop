import * as React from 'react';
import { digitalHuman, type AvatarSlot } from '@chayuan/api';

export interface CanvasProduct {
  ref: string;
  kind: 'image' | 'video';
  x: number;
  y: number;
  scale: number;
}

export interface CanvasStageProps {
  width: number;          // 画幅像素(仅定比例)
  height: number;
  roles: AvatarSlot[];    // 每角色 ref/kind/name/x/y/scale(归一)
  onChange?: (ref: string, pos: { x: number; y: number; scale: number }) => void;
  product?: CanvasProduct;        // 商品图/视频层(可选)
  onProductChange?: (pos: { x: number; y: number; scale: number }) => void;
  readOnly?: boolean;
}

const PRODUCT_REF = '__product__';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Drag =
  | { mode: 'move'; ref: string; mx: number; my: number; x0: number; y0: number }
  | { mode: 'resize'; ref: string; corner: Corner; mx: number; s0: number; x0: number; y0: number };

/** 按画幅比例显示舞台,角色 + 商品图按归一 x/y/scale 摆放。
 *  拖拽改位置(跟手),四角控制点改大小。编辑器(可拖)与生成预览(readOnly)共用。
 *  用 window 级 pointer 监听,避免 pointer-capture/重渲染导致"只动一点点不跟手"。 */
export const CanvasStage: React.FC<CanvasStageProps> = ({ width, height, roles, onChange, product, onProductChange, readOnly }) => {
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<Drag | null>(null);
  const rolesRef = React.useRef(roles);
  rolesRef.current = roles;
  const productRef = React.useRef<CanvasProduct | undefined>(product);
  productRef.current = product;

  React.useEffect(() => {
    if (readOnly) return undefined;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      const box = boxRef.current;
      if (!d || !box) return;
      const rect = box.getBoundingClientRect();
      const isProduct = d.ref === PRODUCT_REF;
      const cur = isProduct
        ? productRef.current
        : rolesRef.current.find((x) => x.ref === d.ref);
      if (!cur) return;
      const emit = (pos: { x: number; y: number; scale: number }) => {
        if (isProduct) onProductChange?.(pos);
        else onChange?.(d.ref, pos);
      };
      if (d.mode === 'move') {
        const nx = Math.min(0.99, Math.max(0, d.x0 + (e.clientX - d.mx) / rect.width));
        const ny = Math.min(0.99, Math.max(0, d.y0 + (e.clientY - d.my) / rect.height));
        emit({ x: nx, y: ny, scale: cur.scale ?? 1 });
      } else {
        const dirX = d.corner === 'ne' || d.corner === 'se' ? 1 : -1;
        const delta = ((e.clientX - d.mx) / rect.width) * dirX;
        const ns = Math.min(1.0, Math.max(0.05, d.s0 + delta));
        emit({ x: cur.x ?? 0, y: cur.y ?? 0, scale: ns });
      }
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [onChange, onProductChange, readOnly]);

  const startMove = (e: React.PointerEvent, ref: string, x0: number, y0: number) => {
    if (readOnly) return;
    e.preventDefault();
    dragRef.current = { mode: 'move', ref, mx: e.clientX, my: e.clientY, x0, y0 };
  };
  const startResize = (e: React.PointerEvent, ref: string, corner: Corner, x0: number, y0: number, s0: number) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode: 'resize', ref, corner, mx: e.clientX, s0, x0, y0 };
  };

  const corners: Array<[Corner, string]> = [
    ['nw', 'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nw-resize'],
    ['ne', 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-ne-resize'],
    ['sw', 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-sw-resize'],
    ['se', 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-se-resize'],
  ];

  return (
    <div ref={boxRef}
      className="relative mx-auto select-none overflow-hidden rounded-lg bg-black"
      style={{ aspectRatio: `${width} / ${height}`, maxWidth: '100%', maxHeight: '100%', ...(width >= height ? { width: '100%', height: 'auto' } : { height: '100%', width: 'auto' }) }}>
      {roles.map((r) => (
        <div key={r.ref}
          onPointerDown={(e) => startMove(e, r.ref, r.x ?? 0, r.y ?? 0)}
          className={'absolute ' + (readOnly ? '' : 'cursor-move')}
          style={{ left: `${(r.x ?? 0) * 100}%`, top: `${(r.y ?? 0) * 100}%`, width: `${(r.scale ?? 1) * 100}%`, touchAction: 'none' }}>
          {r.kind === 'video'
            ? <video src={digitalHuman.avatarFileUrl(r.ref)} muted loop autoPlay playsInline className="pointer-events-none w-full rounded" />
            : <img src={digitalHuman.avatarFileUrl(r.ref)} alt={r.name || '角色'} className="pointer-events-none w-full rounded" draggable={false} />}
          {r.name ? <span className="pointer-events-none absolute -bottom-4 left-0 rounded bg-black/60 px-1 text-[10px] text-white">{r.name}</span> : null}
          {!readOnly && corners.map(([c, cls]) => (
            <div key={c} onPointerDown={(e) => startResize(e, r.ref, c, r.x ?? 0, r.y ?? 0, r.scale ?? 1)}
              title="拖拽缩放"
              className={'absolute h-2.5 w-2.5 rounded-sm border border-white bg-[var(--cy-brand-500)] ' + cls}
              style={{ touchAction: 'none' }} />
          ))}
        </div>
      ))}
      {product && product.ref ? (
        <div
          onPointerDown={(e) => startMove(e, PRODUCT_REF, product.x ?? 0, product.y ?? 0)}
          className={'absolute ' + (readOnly ? '' : 'cursor-move')}
          style={{ left: `${(product.x ?? 0) * 100}%`, top: `${(product.y ?? 0) * 100}%`, width: `${(product.scale ?? 0.3) * 100}%`, touchAction: 'none' }}>
          {product.kind === 'video'
            ? <video src={digitalHuman.productFileUrl(product.ref)} muted loop autoPlay playsInline className="pointer-events-none w-full rounded ring-1 ring-white/40" />
            : <img src={digitalHuman.productFileUrl(product.ref)} alt="商品图" className="pointer-events-none w-full rounded ring-1 ring-white/40" draggable={false} />}
          <span className="pointer-events-none absolute -top-4 left-0 rounded bg-[var(--cy-brand-600)]/80 px-1 text-[10px] text-white">商品</span>
          {!readOnly && corners.map(([c, cls]) => (
            <div key={c} onPointerDown={(e) => startResize(e, PRODUCT_REF, c, product.x ?? 0, product.y ?? 0, product.scale ?? 0.3)}
              title="拖拽缩放"
              className={'absolute h-2.5 w-2.5 rounded-sm border border-white bg-[var(--cy-brand-500)] ' + cls}
              style={{ touchAction: 'none' }} />
          ))}
        </div>
      ) : null}
    </div>
  );
};
