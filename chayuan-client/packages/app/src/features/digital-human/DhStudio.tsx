import * as React from 'react';
import { digitalHuman, type DigitalHumanPreset } from '@chayuan/api';
import { GeneratePanel } from './GeneratePanel';
import { CanvasStage } from './CanvasStage';
import { DhTaskList } from './DhTaskList';

/**
 * 数字人工作台:左设置 / 可拖拽分隔 / 右预览;底部全宽任务列表。
 * 预览随所选预设变(画布比例 + 形象 + 模式)。复用 GeneratePanel(embedded,任务列表移到底部全宽 DhTaskList)。
 */
export const DhStudio: React.FC<{ presets: DigitalHumanPreset[]; initialPresetId?: string }> = ({ presets, initialPresetId }) => {
  const [pid, setPid] = React.useState(initialPresetId ?? presets[0]?.id ?? '');
  const preset = presets.find((p) => p.id === pid) ?? presets[0] ?? null;
  const w = preset?.video_width ?? 720;
  const h = preset?.video_height ?? 1280;
  const url = preset ? digitalHuman.avatarFileUrl(preset.avatar_ref) : '';
  const modeLabel = preset?.compose_mode === 'coframe'
    ? '多人同框' : preset?.compose_mode === 'sequential' ? '分段轮流' : '单形象';

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
            {preset && (preset.avatars?.length ?? 0) > 0 ? (
              <CanvasStage width={w} height={h} roles={preset.avatars!} readOnly />
            ) : preset && preset.avatar_kind === 'image' ? (
              <img src={url} alt={preset.name} className="h-full w-full object-cover" />
            ) : preset ? (
              <video src={url} muted loop autoPlay playsInline className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-white/40">在左侧选择或到「我的数字人」新建一个数字人</div>
            )}
            <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/50 px-2 py-0.5 text-[10px] text-white/80">
              {w}×{h} · {modeLabel}
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
