import * as React from 'react';
import { digitalHuman, type DigitalHumanPreset } from '@chayuan/api';
import { GeneratePanel } from './GeneratePanel';

/**
 * 数字人工作台(整合编辑器):左实时预览画布 / 右设置+生成面板。
 * 组合复用 GeneratePanel(含预设选择/文案/AI生成/引擎/生成/最近任务);
 * 预览随右侧所选预设变(画布比例 + 形象 + 模式)。不重写既有组件。
 */
export const DhStudio: React.FC<{ presets: DigitalHumanPreset[]; initialPresetId?: string }> = ({ presets, initialPresetId }) => {
  const [pid, setPid] = React.useState(initialPresetId ?? presets[0]?.id ?? '');
  const preset = presets.find((p) => p.id === pid) ?? presets[0] ?? null;
  const w = preset?.video_width ?? 720;
  const h = preset?.video_height ?? 1280;
  const url = preset ? digitalHuman.avatarFileUrl(preset.avatar_ref) : '';
  const modeLabel = preset?.compose_mode === 'coframe'
    ? '多人同框' : preset?.compose_mode === 'sequential' ? '分段轮流' : '单形象';

  return (
    <div className="flex h-full gap-4">
      {/* 左:预览画布(按画布比例) */}
      <div className="flex min-w-0 flex-1 items-center justify-center rounded-xl bg-[var(--cy-ink-900,#0b0d12)] p-4">
        <div
          className="relative max-h-full max-w-full overflow-hidden rounded-lg bg-black shadow-lg"
          style={{ aspectRatio: `${w} / ${h}`, height: '100%' }}
        >
          {preset && preset.avatar_kind === 'image' ? (
            <img src={url} alt={preset.name} className="h-full w-full object-cover" />
          ) : preset ? (
            <video src={url} muted loop autoPlay playsInline className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-white/40">
              右侧选择或到「我的数字人」新建一个数字人
            </div>
          )}
          <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/50 px-2 py-0.5 text-[10px] text-white/80">
            {w}×{h} · {modeLabel}
          </div>
        </div>
      </div>
      {/* 右:设置 + 生成 */}
      <div className="w-[380px] shrink-0 overflow-y-auto pr-1">
        <GeneratePanel presets={presets} initialPresetId={pid} onPresetChange={setPid} />
      </div>
    </div>
  );
};
