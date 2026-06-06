import * as React from 'react';
import { digitalHuman, type AvatarSlot } from '@chayuan/api';

export interface CanvasProduct {
  ref: string;
  kind: 'image' | 'video';
  x: number;
  y: number;
  scale: number;
  z?: number;
  opacity?: number;
  link?: string;
  title?: string;
  price?: string;
  desc?: string;
}

export interface CanvasStageProps {
  width: number;          // 画幅像素(仅定比例)
  height: number;
  roles: AvatarSlot[];    // 每角色 ref/kind/name/x/y/scale/z(归一)
  onChange?: (ref: string, pos: { x: number; y: number; scale: number }) => void;
  products?: CanvasProduct[];     // 商品图/视频层(可多个),按各自 ref 标识
  onProductChange?: (ref: string, pos: { x: number; y: number; scale: number }) => void;
  /** 图层叠放变更:一次给出受影响图层的新 z(ref=角色 ref 或商品 ref)。 */
  onLayerZChange?: (updates: Array<{ ref: string; z: number }>) => void;
  /** 删除某图层(商品 ref 删该商品,否则删该角色)。 */
  onLayerDelete?: (ref: string) => void;
  /** 设置某图层不透明度(0-1)。 */
  onLayerOpacityChange?: (ref: string, opacity: number) => void;
  /** 当前选中的商品 ref(高亮);点商品图回调 onSelect(与左侧列表联动)。 */
  selectedRef?: string | null;
  onSelect?: (ref: string | null) => void;
  readOnly?: boolean;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Drag =
  | { mode: 'move'; ref: string; mx: number; my: number; x0: number; y0: number }
  | { mode: 'resize'; ref: string; corner: Corner; mx: number; s0: number; x0: number; y0: number };

type MenuState = { x: number; y: number; ref: string } | null;

/** 按画幅比例显示舞台,角色 + 多商品图按归一 x/y/scale 摆放,显式 zIndex 控制叠放。
 *  拖拽改位置(跟手),四角控制点改大小,右键菜单调层级 / 透明度 / 删除。
 *  编辑器(可拖)与生成预览(readOnly)共用。 */
export const CanvasStage: React.FC<CanvasStageProps> = ({
  width, height, roles, onChange, products, onProductChange, onLayerZChange, onLayerDelete, onLayerOpacityChange, selectedRef, onSelect, readOnly,
}) => {
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<Drag | null>(null);
  const rolesRef = React.useRef(roles);
  rolesRef.current = roles;
  const prodsRef = React.useRef<CanvasProduct[]>(products ?? []);
  prodsRef.current = products ?? [];
  const [menu, setMenu] = React.useState<MenuState>(null);

  const prods = products ?? [];
  const isProductRef = (ref: string) => prodsRef.current.some((p) => p.ref === ref);

  // 各图层有效 z(缺省:角色按数组序,商品排在角色之上、彼此按数组序)+ 数组序兜底稳定排序。
  const layerList = React.useMemo(() => {
    const list = roles.map((r, i) => ({ ref: r.ref, ez: r.z ?? i, fi: i }));
    prods.forEach((p, j) => list.push({ ref: p.ref, ez: p.z ?? (roles.length + j), fi: roles.length + j }));
    return list;
  }, [roles, prods]);
  const ordered = React.useMemo(
    () => layerList.slice().sort((a, b) => a.ez - b.ez || a.fi - b.fi).map((l) => l.ref),
    [layerList],
  );

  const applyOrder = (ref: string, op: 'front' | 'back' | 'up' | 'down') => {
    const arr = ordered.slice();
    const i = arr.indexOf(ref);
    if (i < 0) return;
    if (op === 'front') { arr.splice(i, 1); arr.push(ref); }
    else if (op === 'back') { arr.splice(i, 1); arr.unshift(ref); }
    else if (op === 'up' && i < arr.length - 1) { arr.splice(i, 1); arr.splice(i + 1, 0, ref); }
    else if (op === 'down' && i > 0) { arr.splice(i, 1); arr.splice(i - 1, 0, ref); }
    else return;
    onLayerZChange?.(arr.map((r, idx) => ({ ref: r, z: idx })));
  };

  React.useEffect(() => {
    if (readOnly) return undefined;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      const box = boxRef.current;
      if (!d || !box) return;
      const rect = box.getBoundingClientRect();
      const isProduct = isProductRef(d.ref);
      const cur = isProduct ? prodsRef.current.find((x) => x.ref === d.ref) : rolesRef.current.find((x) => x.ref === d.ref);
      if (!cur) return;
      // 点击抖动阈值:位移 < 3px 视为点击,不写回(否则点一下就 emit→重拉→层级/位置跳)。
      const _dx = Math.abs(e.clientX - d.mx);
      const _dy = d.mode === 'move' ? Math.abs(e.clientY - d.my) : 0;
      if (_dx < 3 && _dy < 3) return;
      const emit = (pos: { x: number; y: number; scale: number }) => {
        if (isProduct) onProductChange?.(d.ref, pos);
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

  // 右键菜单:点外部 / Esc 关(延迟一帧注册,避免捕获到打开菜单的这次事件)。
  React.useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    const id = window.setTimeout(() => {
      window.addEventListener('click', close);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const startMove = (e: React.PointerEvent, ref: string, x0: number, y0: number) => {
    if (readOnly || e.button !== 0) return;   // 右键不拖拽
    e.preventDefault();
    dragRef.current = { mode: 'move', ref, mx: e.clientX, my: e.clientY, x0, y0 };
  };
  const startResize = (e: React.PointerEvent, ref: string, corner: Corner, x0: number, y0: number, s0: number) => {
    if (readOnly || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode: 'resize', ref, corner, mx: e.clientX, s0, x0, y0 };
  };
  const onCtx = (e: React.MouseEvent, ref: string) => {
    if (readOnly || (!onLayerZChange && !onLayerDelete && !onLayerOpacityChange)) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, ref });
  };

  const corners: Array<[Corner, string]> = [
    ['nw', 'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nw-resize'],
    ['ne', 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-ne-resize'],
    ['sw', 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-sw-resize'],
    ['se', 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-se-resize'],
  ];

  const menuPos = menu ? ordered.indexOf(menu.ref) : -1;
  const menuOpacity = menu
    ? ((prods.find((p) => p.ref === menu.ref)?.opacity) ?? (roles.find((r) => r.ref === menu.ref)?.opacity) ?? 1)
    : 1;
  const menuItem = (label: string, onClick: () => void, disabled = false, danger = false) => (
    <button type="button" disabled={disabled}
      onClick={() => { onClick(); setMenu(null); }}
      className={`block w-full px-3 py-1.5 text-left text-sm disabled:opacity-40 ${
        danger ? 'text-[var(--cy-danger-500)] hover:bg-[var(--cy-surface-2)]' : 'text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]'}`}>
      {label}
    </button>
  );

  return (
    <>
      <div ref={boxRef}
        className="relative mx-auto select-none overflow-hidden rounded-lg bg-black"
        style={{ aspectRatio: `${width} / ${height}`, maxWidth: '100%', maxHeight: '100%', ...(width >= height ? { width: '100%', height: 'auto' } : { height: '100%', width: 'auto' }) }}>
        {roles.map((r, i) => (
          <div key={r.ref}
            onPointerDown={(e) => startMove(e, r.ref, r.x ?? 0, r.y ?? 0)}
            onContextMenu={(e) => onCtx(e, r.ref)}
            className={'absolute ' + (readOnly ? '' : 'cursor-move')}
            style={{ left: `${(r.x ?? 0) * 100}%`, top: `${(r.y ?? 0) * 100}%`, width: `${(r.scale ?? 1) * 100}%`, zIndex: r.z ?? i, opacity: r.opacity ?? 1, touchAction: 'none' }}>
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
        {prods.filter((pp) => pp.ref.startsWith('product:')).map((product) => {
          const psel = selectedRef === product.ref;
          const ring = psel ? 'ring-2 ring-[var(--cy-brand-500)]' : 'ring-1 ring-white/40';
          return (
          <div key={product.ref}
            onPointerDown={(e) => { onSelect?.(product.ref); startMove(e, product.ref, product.x ?? 0, product.y ?? 0); }}
            onContextMenu={(e) => onCtx(e, product.ref)}
            className={'absolute ' + (readOnly ? '' : 'cursor-move')}
            style={{ left: `${(product.x ?? 0) * 100}%`, top: `${(product.y ?? 0) * 100}%`, width: `${(product.scale ?? 0.3) * 100}%`, zIndex: product.z ?? roles.length, opacity: product.opacity ?? 1, touchAction: 'none' }}>
            {product.kind === 'video'
              ? <video src={digitalHuman.productFileUrl(product.ref)} muted loop autoPlay playsInline className={`pointer-events-none w-full rounded ${ring}`} />
              : <img src={digitalHuman.productFileUrl(product.ref)} alt="商品图" className={`pointer-events-none w-full rounded ${ring}`} draggable={false} />}
            <span className="pointer-events-none absolute -top-4 left-0 rounded bg-[var(--cy-brand-600)]/80 px-1 text-[10px] text-white">商品</span>
            {!readOnly && corners.map(([c, cls]) => (
              <div key={c} onPointerDown={(e) => startResize(e, product.ref, c, product.x ?? 0, product.y ?? 0, product.scale ?? 0.3)}
                title="拖拽缩放"
                className={'absolute h-2.5 w-2.5 rounded-sm border border-white bg-[var(--cy-brand-500)] ' + cls}
                style={{ touchAction: 'none' }} />
            ))}
          </div>
          );
        })}
      </div>

      {menu ? (
        <div
          className="fixed z-[400] min-w-[8rem] overflow-hidden rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] py-1 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}>
          {menuItem('置顶', () => applyOrder(menu.ref, 'front'), menuPos === ordered.length - 1)}
          {menuItem('上移一层', () => applyOrder(menu.ref, 'up'), menuPos === ordered.length - 1)}
          {menuItem('下移一层', () => applyOrder(menu.ref, 'down'), menuPos <= 0)}
          {menuItem('置底', () => applyOrder(menu.ref, 'back'), menuPos <= 0)}
          {onLayerOpacityChange ? (
            <div className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
              <div className="mb-1 flex justify-between text-xs text-[var(--cy-text-secondary)]">
                <span>透明度</span><span>{Math.round(menuOpacity * 100)}%</span>
              </div>
              <input type="range" min={10} max={100} value={Math.round(menuOpacity * 100)}
                onChange={(e) => onLayerOpacityChange(menu.ref, Number(e.target.value) / 100)}
                className="w-full" />
            </div>
          ) : null}
          <div className="my-1 h-px bg-[var(--cy-border-subtle)]" />
          {menuItem('删除', () => onLayerDelete?.(menu.ref), false, true)}
        </div>
      ) : null}
    </>
  );
};
