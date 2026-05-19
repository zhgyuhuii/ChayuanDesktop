/**
 * 语音合成模式参数条。
 *
 * 仅在 ``composerMode.paramKind === 'tts_voice'`` 时显示。
 *
 * 字段(共用 composer store 的 ``modalityParams``):
 *   - voice:OpenAI 6 标准音色(alloy/echo/fable/onyx/nova/shimmer)
 *           中文模型(qwen-tts / cosyvoice)的厂商音色后续厂商专属 Connector
 *           接入时另行扩充;现在统一走 OpenAI 兼容协议。
 *   - speed:0.75 / 1.0 / 1.25 / 1.5 chips(后端 clamp 到 [0.25, 4.0])
 *   - format(高级,折叠):mp3 / wav / opus,默认 mp3
 */

import * as React from 'react';
import { ChevronDown, Gauge, Music } from 'lucide-react';
import { cn } from '@chayuan/ui';
import { useComposerS } from '../../store/composer';

interface VoiceOption {
  value: string;
  label: string;
  hint?: string;
}

// OpenAI 6 标准音色 — 用中性描述,不强调男女(部分音色实际偏向但官方不分类)
const VOICE_OPTIONS: VoiceOption[] = [
  { value: 'alloy',   label: 'Alloy',   hint: '中性 · 默认' },
  { value: 'echo',    label: 'Echo',    hint: '清晰 · 中性' },
  { value: 'fable',   label: 'Fable',   hint: '柔和 · 叙事' },
  { value: 'onyx',    label: 'Onyx',    hint: '低沉 · 厚重' },
  { value: 'nova',    label: 'Nova',    hint: '明亮 · 活泼' },
  { value: 'shimmer', label: 'Shimmer', hint: '温暖 · 清亮' },
];

const SPEED_OPTIONS = [0.75, 1.0, 1.25, 1.5] as const;
const FORMAT_OPTIONS = ['mp3', 'wav', 'opus'] as const;

export const TtsVoiceParamBar: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const params = useComposerS((s) => s.modalityParams);
  const setParams = useComposerS((s) => s.setModalityParams);

  const voice = typeof params.voice === 'string' ? params.voice : VOICE_OPTIONS[0]!.value;
  const speed = typeof params.speed === 'number' ? params.speed : 1.0;
  const fmt = typeof params.response_format === 'string' ? params.response_format : 'mp3';

  const [advOpen, setAdvOpen] = React.useState(false);

  return (
    <div
      role="toolbar"
      aria-label="TTS 参数"
      className={cn(
        'flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--cy-text-secondary)]',
        compact && 'gap-1',
      )}
    >
      {/* 音色 — select 比 chip 更省空间(6 个) */}
      <span className="opacity-60">音色</span>
      <select
        value={voice}
        onChange={(e) => setParams({ voice: e.target.value })}
        className={cn(
          'h-6 rounded-md border border-[var(--cy-border-subtle)]',
          'bg-[var(--cy-surface-1)] px-1.5 text-[10px] text-[var(--cy-text-primary)]',
          'focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none',
        )}
      >
        {VOICE_OPTIONS.map((v) => (
          <option key={v.value} value={v.value} title={v.hint}>
            {v.label}
          </option>
        ))}
      </select>

      <span className="mx-1 opacity-30">·</span>

      {/* 语速 chips */}
      <span className="opacity-60">语速</span>
      <div className="flex items-center gap-0.5">
        {SPEED_OPTIONS.map((value) => {
          const active = Math.abs(speed - value) < 1e-3;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setParams({ speed: value })}
              aria-pressed={active}
              title={`${value.toFixed(2)}×`}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-md px-1.5 transition-colors',
                active
                  ? 'bg-[var(--cy-ink-700)] text-white'
                  : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]',
              )}
            >
              <Gauge className="h-3 w-3" />
              <span className="text-[10px]">{value.toFixed(2).replace(/\.?0+$/, '')}×</span>
            </button>
          );
        })}
      </div>

      <span className="mx-1 opacity-30">·</span>

      {/* 格式 — 折叠在按钮里,大多数用户不需要改 */}
      <button
        type="button"
        onClick={() => setAdvOpen((v) => !v)}
        aria-expanded={advOpen}
        className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]"
        title="高级:输出格式"
      >
        <Music className="h-3 w-3" />
        <span className="text-[10px]">{fmt}</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform', advOpen && 'rotate-180')} />
      </button>
      {advOpen && (
        <div className="flex items-center gap-0.5">
          {FORMAT_OPTIONS.map((f) => {
            const active = fmt === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setParams({ response_format: f })}
                aria-pressed={active}
                className={cn(
                  'inline-flex h-6 items-center rounded-md px-1.5 text-[10px] transition-colors',
                  active
                    ? 'bg-[var(--cy-ink-700)] text-white'
                    : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]',
                )}
              >
                {f}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
