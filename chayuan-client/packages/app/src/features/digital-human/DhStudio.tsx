import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { digitalHuman, type AvatarSlot, type DigitalHumanPreset } from '@chayuan/api';
import { GeneratePanel } from './GeneratePanel';
import { CanvasStage, type CanvasProduct } from './CanvasStage';

/** 折叠后的竖条(左设置 / 右预览),点击展开。 */
const CollapsedSide: React.FC<{ label: string; icon: React.ReactNode; onExpand: () => void }> = ({ label, icon, onExpand }) => (
  <button type="button" onClick={onExpand} title={`展开${label}`}
    className="flex h-full w-7 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]">
    {icon}
    <span className="text-[11px] [writing-mode:vertical-rl]">{label}</span>
  </button>
);

const collapseBtnCls =
  'absolute right-1.5 top-1.5 z-20 flex h-6 w-6 items-center justify-center rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]/90 text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]';

/**
 * 数字人工作台:左设置 / 拖拽分隔 / 右预览。左设置 / 右预览可折叠成细条,点细条展开。
 * (生成任务与数字人视频列表已独立到「数字人视频」tab。)
 */
export const DhStudio: React.FC<{ presets: DigitalHumanPreset[]; initialPresetId?: string; onPublished?: () => void }> = ({ presets, initialPresetId, onPublished }) => {
  const qc = useQueryClient();
  const [pid, setPid] = React.useState(initialPresetId ?? presets[0]?.id ?? '');
  const preset = presets.find((p) => p.id === pid) ?? presets[0] ?? null;
  const w = preset?.video_width ?? 720;
  const h = preset?.video_height ?? 1280;
  const url = preset ? digitalHuman.avatarFileUrl(preset.avatar_ref) : '';
  const modeLabel = preset?.compose_mode === 'coframe'
    ? '多人同框' : preset?.compose_mode === 'sequential' ? '分段轮流' : '单形象';

  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = React.useRef<Partial<DigitalHumanPreset>>({});
  const persist = React.useCallback((patch: Partial<DigitalHumanPreset>) => {
    // 合并待写补丁:防抖窗口内多次 persist(如先右键改 product_z、再拖拽改 product_x/y/scale)
    // 必须累积。否则后到的部分补丁会取代前一个 timer → 丢掉先设的字段(典型:resize 丢掉 z,
    // 重拉后回退默认 z,层级乱跳)。
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const id = pid;
    saveTimer.current = setTimeout(() => {
      const p = pendingPatch.current;
      pendingPatch.current = {};
      if (id && Object.keys(p).length) {
        void digitalHuman.updatePreset(id, p).then(() => qc.invalidateQueries({ queryKey: ['dh.presets'] }));
      }
    }, 600);
  }, [pid, qc]);

  // 数字人拖拽:本地 roles 即时反馈,防抖写回 preset.avatars。
  const [localRoles, setLocalRoles] = React.useState<AvatarSlot[]>(preset?.avatars ?? []);
  React.useEffect(() => { setLocalRoles(preset?.avatars ?? []); }, [pid, preset?.avatars]);
  const onRoleChange = React.useCallback((ref: string, pos: { x: number; y: number; scale: number }) => {
    setLocalRoles((prev) => {
      const next = prev.map((r) => (r.ref === ref ? { ...r, ...pos } : r));
      persist({ avatars: next });
      return next;
    });
  }, [persist]);

  // 多商品图层:从 preset.products 读;旧 preset(只有 product_ref)兜底迁移成一条。
  const productsOf = React.useCallback((p: DigitalHumanPreset | null): CanvasProduct[] => {
    if (p?.products?.length) {
      return p.products.map((q) => ({
        ref: q.ref, kind: q.kind === 'video' ? 'video' : 'image',
        x: q.x ?? 0.66, y: q.y ?? 0.6, scale: q.scale ?? 0.32, z: q.z, opacity: q.opacity,
      }));
    }
    if (p?.product_ref) {
      return [{ ref: p.product_ref, kind: p.product_kind ?? 'image',
        x: p.product_x ?? 0.66, y: p.product_y ?? 0.6, scale: p.product_scale ?? 0.32,
        z: p.product_z, opacity: p.product_opacity }];
    }
    return [];
  }, []);
  const [localProducts, setLocalProducts] = React.useState<CanvasProduct[]>(() => productsOf(preset));
  React.useEffect(() => { setLocalProducts(productsOf(preset)); },
    [pid, preset?.products, preset?.product_ref, productsOf]);

  // refs 跟随最新本地值,供跨状态写回(避免 useCallback 闭包陈旧 / 嵌套 setState)。
  const rolesNowRef = React.useRef(localRoles); rolesNowRef.current = localRoles;
  const prodsNowRef = React.useRef(localProducts); prodsNowRef.current = localProducts;
  const serializeProducts = (arr: CanvasProduct[]) =>
    arr.map((p) => ({ ref: p.ref, kind: p.kind, x: p.x, y: p.y, scale: p.scale, z: p.z, opacity: p.opacity }));
  const isProd = (ref: string) => ref.startsWith('product:');

  const onProductChange = React.useCallback((ref: string, pos: { x: number; y: number; scale: number }) => {
    const next = prodsNowRef.current.map((p) => (p.ref === ref ? { ...p, ...pos } : p));
    setLocalProducts(next);
    persist({ products: serializeProducts(next) });
  }, [persist]);

  // 图层叠放:拆分角色 z(avatars)与商品 z(products),用最新本地值一并写回。
  const onLayerZChange = React.useCallback((updates: Array<{ ref: string; z: number }>) => {
    const z = new Map(updates.map((u) => [u.ref, u.z]));
    const nr = rolesNowRef.current.map((r) => (z.has(r.ref) ? { ...r, z: z.get(r.ref) } : r));
    const np = prodsNowRef.current.map((p) => (z.has(p.ref) ? { ...p, z: z.get(p.ref) } : p));
    setLocalRoles(nr);
    setLocalProducts(np);
    persist({ avatars: nr, products: serializeProducts(np) });
  }, [persist]);

  const onLayerOpacityChange = React.useCallback((ref: string, opacity: number) => {
    if (isProd(ref)) {
      const np = prodsNowRef.current.map((p) => (p.ref === ref ? { ...p, opacity } : p));
      setLocalProducts(np); persist({ products: serializeProducts(np) });
    } else {
      const nr = rolesNowRef.current.map((r) => (r.ref === ref ? { ...r, opacity } : r));
      setLocalRoles(nr); persist({ avatars: nr });
    }
  }, [persist]);

  const onLayerDelete = React.useCallback((ref: string) => {
    if (isProd(ref)) {
      const np = prodsNowRef.current.filter((p) => p.ref !== ref);
      setLocalProducts(np); persist({ products: serializeProducts(np) });
    } else {
      const nr = rolesNowRef.current.filter((r) => r.ref !== ref);
      setLocalRoles(nr); persist({ avatars: nr });
    }
  }, [persist]);

  // 左设置宽、右预览窄(默认 4:1 = 80%);可拖拽,clamp 55%-90%。
  const [leftPct, setLeftPct] = React.useState<number>(() => {
    const v = Number(localStorage.getItem('dh.studio.leftPct'));
    return v >= 55 && v <= 90 ? v : 80;
  });
  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const row = (e.currentTarget as HTMLElement).parentElement;
    const totalW = row?.offsetWidth || 1000;
    const startX = e.clientX;
    const startPct = leftPct;
    const onMove = (ev: PointerEvent) => {
      setLeftPct(Math.max(55, Math.min(90, startPct + ((ev.clientX - startX) / totalW) * 100)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLeftPct((cur) => { localStorage.setItem('dh.studio.leftPct', String(Math.round(cur))); return cur; });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // 左设置 / 右预览折叠状态。
  const [col, setColState] = React.useState<{ left: boolean; right: boolean }>(() => {
    try {
      const o = JSON.parse(localStorage.getItem('dh.studio.collapse') ?? '');
      if (o && typeof o === 'object') return { left: !!o.left, right: !!o.right };
    } catch { /* ignore */ }
    return { left: false, right: false };
  });
  const setCol = (patch: Partial<{ left: boolean; right: boolean }>) =>
    setColState((c) => {
      const next = { ...c, ...patch };
      localStorage.setItem('dh.studio.collapse', JSON.stringify(next));
      return next;
    });

  const canvas = (
    <div
      className="relative max-h-full max-w-full overflow-hidden rounded-lg bg-black shadow-lg ring-1 ring-[var(--cy-border-strong)]"
      style={{ aspectRatio: `${w} / ${h}`, maxWidth: '100%', maxHeight: '100%', ...(w >= h ? { width: '100%', height: 'auto' } : { height: '100%', width: 'auto' }) }}
    >
      {preset && localRoles.length > 0 ? (
        <CanvasStage width={w} height={h} roles={localRoles} onChange={onRoleChange}
          products={localProducts} onProductChange={onProductChange}
          onLayerZChange={onLayerZChange} onLayerDelete={onLayerDelete}
          onLayerOpacityChange={onLayerOpacityChange} />
      ) : preset && preset.avatar_ref && preset.avatar_kind === 'image' ? (
        <img src={url} alt={preset.name} className="h-full w-full object-cover" />
      ) : preset && preset.avatar_ref ? (
        <video src={url} muted loop autoPlay playsInline className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-white/40">
          {preset ? '该数字人还没有形象素材,去右上角「数字人设置」编辑添加' : '在左侧选择,或到右上角「数字人设置」新建一个数字人'}
        </div>
      )}
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/50 px-2 py-0.5 text-[10px] text-white/80">
        {w}×{h} · {modeLabel} · 可拖拽数字人{localProducts.length ? '/商品图' : ''}
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-2">
      {/* 左设置 | 拖拽分隔 | 右预览 */}
      <div className="flex min-h-0 flex-1 gap-0">
        {col.left ? (
          <CollapsedSide label="设置" icon={<ChevronRight className="h-4 w-4" />} onExpand={() => setCol({ left: false })} />
        ) : (
          <div className="relative shrink-0" style={{ width: col.right ? '100%' : `${leftPct}%` }}>
            <button type="button" title="折叠设置栏" onClick={() => setCol({ left: true })} className={collapseBtnCls}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="h-full overflow-y-auto pr-1">
              <GeneratePanel presets={presets} initialPresetId={pid} onPresetChange={setPid} embedded onPublished={onPublished} />
            </div>
          </div>
        )}

        {!col.left && !col.right && (
          <div
            onPointerDown={onResizeDown}
            title="拖拽调整宽度"
            className="mx-0.5 w-1.5 shrink-0 cursor-col-resize rounded bg-[var(--cy-border-subtle)] hover:bg-[var(--cy-brand-400)]"
          />
        )}

        {col.right ? (
          <CollapsedSide label="预览" icon={<ChevronLeft className="h-4 w-4" />} onExpand={() => setCol({ right: false })} />
        ) : (
          <div className="relative flex min-w-0 flex-1 items-center justify-center rounded-xl bg-[var(--cy-surface-2)] p-4">
            <button type="button" title="折叠预览栏" onClick={() => setCol({ right: true })} className={collapseBtnCls}>
              <ChevronRight className="h-4 w-4" />
            </button>
            {canvas}
          </div>
        )}
      </div>
    </div>
  );
};
