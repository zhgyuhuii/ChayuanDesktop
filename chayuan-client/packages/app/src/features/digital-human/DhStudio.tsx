import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';
import { digitalHuman, type AvatarSlot, type DigitalHumanPreset } from '@chayuan/api';
import { GeneratePanel } from './GeneratePanel';
import { CanvasStage, PRODUCT_REF, type CanvasProduct } from './CanvasStage';
import { DhTaskList } from './DhTaskList';

/** 折叠后的竖条(左设置 / 右预览),点击展开。 */
const CollapsedSide: React.FC<{ label: string; icon: React.ReactNode; onExpand: () => void }> = ({ label, icon, onExpand }) => (
  <button type="button" onClick={onExpand} title={`展开${label}`}
    className="flex h-full w-7 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]">
    {icon}
    <span className="text-[11px] [writing-mode:vertical-rl]">{label}</span>
  </button>
);

/** 折叠后的横条(上区 / 下区列表),点击展开。 */
const CollapsedBar: React.FC<{ label: string; icon: React.ReactNode; onExpand: () => void }> = ({ label, icon, onExpand }) => (
  <button type="button" onClick={onExpand} title={`展开${label}`}
    className="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] text-xs text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]">
    {icon}{label}
  </button>
);

const collapseBtnCls =
  'absolute right-1.5 top-1.5 z-20 flex h-6 w-6 items-center justify-center rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]/90 text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]';

/**
 * 数字人工作台:上区(左设置 / 拖拽分隔 / 右预览)+ 下区全宽任务列表。
 * 上下可拖拽调高度;上区/下区/左设置/右预览均可折叠成细条,点细条展开。
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

  // 商品图拖拽:本地 product 即时反馈,防抖写回 preset.product_x/y/scale。
  const [localProduct, setLocalProduct] = React.useState<CanvasProduct | undefined>(undefined);
  React.useEffect(() => {
    setLocalProduct(preset?.product_ref
      ? { ref: preset.product_ref, kind: preset.product_kind ?? 'image',
          x: preset.product_x ?? 0.66, y: preset.product_y ?? 0.6, scale: preset.product_scale ?? 0.32,
          z: preset.product_z }
      : undefined);
  }, [pid, preset?.product_ref, preset?.product_kind, preset?.product_x, preset?.product_y, preset?.product_scale, preset?.product_z]);
  const onProductChange = React.useCallback((pos: { x: number; y: number; scale: number }) => {
    setLocalProduct((p) => (p ? { ...p, ...pos } : p));
    persist({ product_x: pos.x, product_y: pos.y, product_scale: pos.scale });
  }, [persist]);

  // 图层叠放:右键菜单一次给出受影响图层的新 z;拆分商品层 vs 角色层后一并写回 preset。
  const onLayerZChange = React.useCallback((updates: Array<{ ref: string; z: number }>) => {
    const zByRef = new Map(updates.map((u) => [u.ref, u.z]));
    setLocalRoles((prev) => {
      const next = prev.map((r) => (zByRef.has(r.ref) ? { ...r, z: zByRef.get(r.ref) } : r));
      const productZ = zByRef.get(PRODUCT_REF);
      persist(productZ === undefined ? { avatars: next } : { avatars: next, product_z: productZ });
      return next;
    });
    const pz = zByRef.get(PRODUCT_REF);
    if (pz !== undefined) setLocalProduct((p) => (p ? { ...p, z: pz } : p));
  }, [persist]);

  // 删除图层:商品层清空 product_ref;角色层从 avatars 移除。
  const onLayerDelete = React.useCallback((ref: string) => {
    if (ref === PRODUCT_REF) {
      setLocalProduct(undefined);
      persist({ product_ref: '' });
      return;
    }
    setLocalRoles((prev) => {
      const next = prev.filter((r) => r.ref !== ref);
      persist({ avatars: next });
      return next;
    });
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

  // 下区任务列表高度,可上下拖拽,clamp 80-700。
  const [bottomH, setBottomH] = React.useState<number>(() => {
    const v = Number(localStorage.getItem('dh.studio.bottomH'));
    return v >= 80 && v <= 700 ? v : 176;
  });
  const onResizeV = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = bottomH;
    const onMove = (ev: PointerEvent) => setBottomH(Math.max(80, Math.min(700, startH - (ev.clientY - startY))));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setBottomH((cur) => { localStorage.setItem('dh.studio.bottomH', String(Math.round(cur))); return cur; });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // 四向折叠状态;上区与下区不可同时折叠。
  const [col, setColState] = React.useState<{ top: boolean; bottom: boolean; left: boolean; right: boolean }>(() => {
    try {
      const o = JSON.parse(localStorage.getItem('dh.studio.collapse') ?? '');
      if (o && typeof o === 'object') return { top: !!o.top, bottom: !!o.bottom, left: !!o.left, right: !!o.right };
    } catch { /* ignore */ }
    return { top: false, bottom: false, left: false, right: false };
  });
  const setCol = (patch: Partial<{ top: boolean; bottom: boolean; left: boolean; right: boolean }>) =>
    setColState((c) => {
      const next = { ...c, ...patch };
      if (next.top && next.bottom) { if (patch.top) next.bottom = false; else next.top = false; }
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
          product={localProduct} onProductChange={onProductChange}
          onLayerZChange={onLayerZChange} onLayerDelete={onLayerDelete} />
      ) : preset && preset.avatar_kind === 'image' ? (
        <img src={url} alt={preset.name} className="h-full w-full object-cover" />
      ) : preset ? (
        <video src={url} muted loop autoPlay playsInline className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-white/40">在左侧选择或到「我的数字人」新建一个数字人</div>
      )}
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/50 px-2 py-0.5 text-[10px] text-white/80">
        {w}×{h} · {modeLabel} · 可拖拽数字人{localProduct ? '/商品图' : ''}
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-2">
      {/* 上区:左设置 | 拖拽分隔 | 右预览 */}
      {col.top ? (
        <CollapsedBar label="设置 / 预览" icon={<ChevronDown className="h-4 w-4" />} onExpand={() => setCol({ top: false })} />
      ) : (
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
      )}

      {/* 上下分隔:拖拽调高度 + 折叠上/下 */}
      {!col.top && !col.bottom && (
        <div className="flex h-3 shrink-0 items-center gap-1">
          <div onPointerDown={onResizeV} title="拖拽调整高度"
            className="h-1.5 flex-1 cursor-row-resize rounded bg-[var(--cy-border-subtle)] hover:bg-[var(--cy-brand-400)]" />
          <button type="button" title="折叠上方(设置/预览)" onClick={() => setCol({ top: true })}
            className="flex h-4 w-5 items-center justify-center rounded text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]">
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" title="折叠下方列表" onClick={() => setCol({ bottom: true })}
            className="flex h-4 w-5 items-center justify-center rounded text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <div onPointerDown={onResizeV} title="拖拽调整高度"
            className="h-1.5 flex-1 cursor-row-resize rounded bg-[var(--cy-border-subtle)] hover:bg-[var(--cy-brand-400)]" />
        </div>
      )}

      {/* 下区:全宽任务列表 */}
      {col.bottom ? (
        <CollapsedBar label="任务列表" icon={<ChevronUp className="h-4 w-4" />} onExpand={() => setCol({ bottom: false })} />
      ) : (
        <div
          className={`shrink-0 overflow-hidden rounded-xl border border-[var(--cy-border-subtle)] ${col.top ? 'flex-1' : ''}`}
          style={col.top ? undefined : { height: bottomH }}
        >
          <DhTaskList />
        </div>
      )}
    </div>
  );
};
