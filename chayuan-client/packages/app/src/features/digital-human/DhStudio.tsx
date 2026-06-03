import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { digitalHuman, type AvatarSlot, type DigitalHumanPreset } from '@chayuan/api';
import { GeneratePanel } from './GeneratePanel';
import { CanvasStage, type CanvasProduct } from './CanvasStage';
import { DhTaskList } from './DhTaskList';

/**
 * 数字人工作台:左设置 / 可拖拽分隔 / 右预览(画布可拖数字人 + 商品图,松手持久化到 preset);底部全宽任务列表。
 */
export const DhStudio: React.FC<{ presets: DigitalHumanPreset[]; initialPresetId?: string }> = ({ presets, initialPresetId }) => {
  const qc = useQueryClient();
  const [pid, setPid] = React.useState(initialPresetId ?? presets[0]?.id ?? '');
  const preset = presets.find((p) => p.id === pid) ?? presets[0] ?? null;
  const w = preset?.video_width ?? 720;
  const h = preset?.video_height ?? 1280;
  const url = preset ? digitalHuman.avatarFileUrl(preset.avatar_ref) : '';
  const modeLabel = preset?.compose_mode === 'coframe'
    ? '多人同框' : preset?.compose_mode === 'sequential' ? '分段轮流' : '单形象';

  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = React.useCallback((patch: Partial<DigitalHumanPreset>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const id = pid;
    saveTimer.current = setTimeout(() => {
      if (id) void digitalHuman.updatePreset(id, patch).then(() => qc.invalidateQueries({ queryKey: ['dh.presets'] }));
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
          x: preset.product_x ?? 0.66, y: preset.product_y ?? 0.6, scale: preset.product_scale ?? 0.32 }
      : undefined);
  }, [pid, preset?.product_ref, preset?.product_kind, preset?.product_x, preset?.product_y, preset?.product_scale]);
  const onProductChange = React.useCallback((pos: { x: number; y: number; scale: number }) => {
    setLocalProduct((p) => (p ? { ...p, ...pos } : p));
    persist({ product_x: pos.x, product_y: pos.y, product_scale: pos.scale });
  }, [persist]);

  const [leftW, setLeftW] = React.useState<number>(() => {
    const v = Number(localStorage.getItem('dh.studio.leftW'));
    return v >= 320 && v <= 720 ? v : 400;
  });
  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftW;
    const onMove = (ev: PointerEvent) => {
      setLeftW(Math.max(320, Math.min(720, startW + (ev.clientX - startX))));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLeftW((cur) => { localStorage.setItem('dh.studio.leftW', String(cur)); return cur; });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="flex h-full flex-col gap-2">
      {/* 上区:左设置 | 拖拽分隔 | 右预览 */}
      <div className="flex min-h-0 flex-1 gap-0">
        <div className="shrink-0 overflow-y-auto pr-1" style={{ width: leftW }}>
          <GeneratePanel presets={presets} initialPresetId={pid} onPresetChange={setPid} embedded />
        </div>
        <div
          onPointerDown={onResizeDown}
          title="拖拽调整宽度"
          className="mx-0.5 w-1.5 shrink-0 cursor-col-resize rounded bg-[var(--cy-border-subtle)] hover:bg-[var(--cy-brand-400)]"
        />
        <div className="flex min-w-0 flex-1 items-center justify-center rounded-xl bg-[var(--cy-surface-2)] p-4">
          <div
            className="relative max-h-full max-w-full overflow-hidden rounded-lg bg-black shadow-lg ring-1 ring-[var(--cy-border-strong)]"
            style={{ aspectRatio: `${w} / ${h}`, maxWidth: '100%', maxHeight: '100%', ...(w >= h ? { width: '100%', height: 'auto' } : { height: '100%', width: 'auto' }) }}
          >
            {preset && localRoles.length > 0 ? (
              <CanvasStage width={w} height={h} roles={localRoles} onChange={onRoleChange}
                product={localProduct} onProductChange={onProductChange} />
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
        </div>
      </div>
      {/* 下区:全宽任务列表 */}
      <div className="h-44 shrink-0 overflow-hidden rounded-xl border border-[var(--cy-border-subtle)]">
        <DhTaskList />
      </div>
    </div>
  );
};
