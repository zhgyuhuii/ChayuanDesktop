/**
 * 语音设置 — 内联参数条(对齐 composer/TtsVoiceParamBar 视觉:h-6 / text-[10px] /
 * `·` 分隔 / ink-700 高亮 chip / 单行可换行)。
 *
 * 由 VgComposerToolbar 在"语音设置"chip 展开时内联渲染。写全局默认
 * vgComposer.params.voice_*;单条消息覆盖走 message 下方 TtsCard。
 *
 * 导出 VgSpeechSettings(原 VgAudioPopover 改名;弹窗 → 内联)。
 * 音色选择已提取到 VoicePicker 受控组件以便跨场景复用(PresetEditor 等)。
 */
import * as React from 'react';
import { cn } from '@chayuan/ui';
import { useVgComposer } from './store/vgComposer';
import { VoicePicker } from './VoicePicker';

const RATE_OPTIONS = [0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0] as const;

export const VgSpeechSettings: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);

  return (
    <div
      role="toolbar"
      aria-label="语音设置"
      className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--cy-text-secondary)]"
    >
      {/* 后端 chip + 音色 select + 克隆上传/录音/删除 + 试听 */}
      <VoicePicker
        value={{ voice_provider: params.voice_provider, voice_name: params.voice_name }}
        onChange={(v) => patch(v)}
        language={params.video_language}
        previewRate={params.voice_rate}
        previewVolume={params.voice_volume}
      />

      <span className="mx-1 opacity-30">·</span>

      {/* 语速 — 下拉,限宽 */}
      <span className="opacity-60">语速</span>
      <select
        value={params.voice_rate}
        onChange={(e) => patch({ voice_rate: parseFloat(e.target.value) })}
        className={cn(
          'h-6 w-[6em] rounded-md border border-[var(--cy-border-subtle)]',
          'bg-[var(--cy-surface-1)] pl-1.5 pr-5 text-[10px] text-[var(--cy-text-primary)]',
          'focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none',
        )}
      >
        {RATE_OPTIONS.map((value) => (
          <option key={value} value={value}>
            {value.toFixed(2).replace(/\.?0+$/, '')}×
          </option>
        ))}
      </select>

      <span className="mx-1 opacity-30">·</span>

      {/* 音量 — 滑块 */}
      <span className="opacity-60">音量</span>
      <input
        type="range"
        min={0} max={2} step={0.1}
        value={params.voice_volume}
        onChange={(e) => patch({ voice_volume: parseFloat(e.target.value) })}
        title={`音量 ${Math.round(params.voice_volume * 100)}%`}
        className="h-1 w-16 accent-[var(--cy-brand-500)]"
      />
      <span className="w-8 text-[10px] tabular-nums text-[var(--cy-text-tertiary)]">
        {Math.round(params.voice_volume * 100)}%
      </span>
    </div>
  );
};
