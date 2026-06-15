/**
 * 语音合成模式参数条。
 *
 * 统一「合成引擎」下拉:厂商 TTS 模型(GET /v1/models 里 capability=tts 的真模型)
 * + 一个「本地引擎」项。
 *   - 选厂商模型 → 厂商音色下拉 + 语速 + 格式(沿用 OpenAI/DashScope 音色映射)。
 *   - 选本地引擎 → 复用 VG 的 VoicePicker(piper/edge/sherpa/克隆 + 上传/录音/语言/试听)
 *     + 语速 + 音量 + 语言;选中模型记为伪模型 `local-tts:<provider>`,后端本地连接器据此
 *     调 tts.synthesize。
 *
 * 字段(共用 composer store 的 modalityParams):
 *   厂商:voice / speed / response_format
 *   本地:voice_provider / voice_name / voice_rate / voice_volume / language
 */

import * as React from 'react';
import { ChevronDown, Gauge, Music } from 'lucide-react';
import { cn } from '@chayuan/ui';
import { classifyModalityVendor } from '@chayuan/transport';
import type { VgVoiceProvider } from '@chayuan/api';
import { useComposerS } from '../../store/composer';
import { useAvailableModelsByCapability } from '../home/capabilityCards/useAvailableModelsByCapability';
import { VoicePicker } from '../video-generation/VoicePicker';

interface VoiceOption {
  value: string;
  label: string;
  hint?: string;
}

const OPENAI_VOICES: VoiceOption[] = [
  { value: 'alloy',   label: 'Alloy',   hint: '中性 · 默认' },
  { value: 'echo',    label: 'Echo',    hint: '清晰 · 中性' },
  { value: 'fable',   label: 'Fable',   hint: '柔和 · 叙事' },
  { value: 'onyx',    label: 'Onyx',    hint: '低沉 · 厚重' },
  { value: 'nova',    label: 'Nova',    hint: '明亮 · 活泼' },
  { value: 'shimmer', label: 'Shimmer', hint: '温暖 · 清亮' },
];

const DASHSCOPE_VOICES: VoiceOption[] = [
  { value: 'Cherry',   label: 'Cherry',   hint: '默认 · 通用' },
  { value: 'Serena',   label: 'Serena',   hint: '柔和 · 女声' },
  { value: 'Ethan',    label: 'Ethan',    hint: '清晰 · 男声' },
  { value: 'Chelsie',  label: 'Chelsie',  hint: '活泼 · 女声' },
  { value: 'Dylan',    label: 'Dylan',    hint: '京片儿 · 男声' },
  { value: 'Jada',     label: 'Jada',     hint: '上海话 · 女声' },
  { value: 'Sunny',    label: 'Sunny',    hint: '四川话 · 女声' },
  { value: 'Jennifer', label: 'Jennifer', hint: '叙事 · 女声' },
  { value: 'Ryan',     label: 'Ryan',     hint: '深沉 · 男声' },
  { value: 'Katerina', label: 'Katerina', hint: '亲切 · 女声' },
  { value: 'Eric',     label: 'Eric',     hint: '稳健 · 男声' },
  { value: 'Kiki',     label: 'Kiki',     hint: '甜美 · 女声' },
];

const SPEED_OPTIONS = [0.75, 1.0, 1.25, 1.5] as const;
const FORMAT_OPTIONS = ['mp3', 'wav', 'opus'] as const;

const LOCAL_PREFIX = 'local-tts:';
const LOCAL_SENTINEL = 'local-tts:piper'; // 选「本地引擎」时的默认伪模型
const LANG_OPTIONS = [
  { v: '', l: '不限' }, { v: 'zh', l: '中文' }, { v: 'en', l: 'English' },
  { v: 'ja', l: '日本語' }, { v: 'ko', l: '한국어' },
];

const selCls = cn(
  'h-6 rounded-md border border-[var(--cy-border-subtle)]',
  'bg-[var(--cy-surface-1)] px-1.5 text-[10px] text-[var(--cy-text-primary)]',
  'focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none',
);

export const TtsVoiceParamBar: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const params = useComposerS((s) => s.modalityParams);
  const setParams = useComposerS((s) => s.setModalityParams);
  const setModel = useComposerS((s) => s.setModel);
  const modelId = useComposerS((s) => s.modelId);

  const { byCap } = useAvailableModelsByCapability();
  const ttsModels = byCap.get('tts') ?? [];

  const isLocal = typeof modelId === 'string' && modelId.startsWith(LOCAL_PREFIX);
  const engine = (isLocal ? modelId.slice(LOCAL_PREFIX.length) : 'piper') as VgVoiceProvider;

  // ── 统一「合成引擎」下拉:厂商真模型 + 本地引擎 ──────────────────────────
  const engineValue = isLocal ? LOCAL_SENTINEL : modelId;
  const onEngineChange = (val: string) => {
    if (val.startsWith(LOCAL_PREFIX)) {
      setModel(val, undefined, 'tts');
      setParams({ voice_provider: val.slice(LOCAL_PREFIX.length) });
      return;
    }
    const m = ttsModels.find((x) => x.id === val);
    setModel(val, m?.platform_name, 'tts');
  };

  const engineSelect = (
    <>
      <span className="opacity-60">引擎</span>
      <select value={engineValue} onChange={(e) => onEngineChange(e.target.value)} className={selCls} title="合成引擎">
        {ttsModels.length > 0 && (
          <optgroup label="厂商模型">
            {ttsModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.platform_display_name ? `${m.platform_display_name} · ${m.id}` : m.id}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="本地引擎">
          <option value={LOCAL_SENTINEL}>本地引擎(piper/edge/sherpa/克隆)</option>
        </optgroup>
      </select>
      <span className="mx-1 opacity-30">·</span>
    </>
  );

  // ── Hooks 必须在任何条件 return 之前(本地/厂商分支共用,保证 hook 顺序稳定) ──
  const [advOpen, setAdvOpen] = React.useState(false);
  const vendor = classifyModalityVendor(modelId);
  const voiceList = vendor === 'dashscope' ? DASHSCOPE_VOICES : OPENAI_VOICES;
  React.useEffect(() => {
    if (isLocal) return;  // 本地分支不用厂商音色
    if (typeof params.voice === 'string' && voiceList.some((v) => v.value === params.voice)) return;
    setParams({ voice: voiceList[0]!.value });
  }, [vendor, isLocal]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 本地引擎分支:复用 VoicePicker + 语速/音量/语言 ─────────────────────
  if (isLocal) {
    const rate = typeof params.voice_rate === 'number' ? params.voice_rate : 1.0;
    const volume = typeof params.voice_volume === 'number' ? params.voice_volume : 1.0;
    const language = typeof params.language === 'string' ? params.language : '';
    const voiceName = typeof params.voice_name === 'string' ? params.voice_name : '';
    return (
      <div role="toolbar" aria-label="TTS 参数(本地)" className={cn('flex flex-col gap-2 text-[11px] text-[var(--cy-text-secondary)]', compact && 'gap-1')}>
        <div className="flex flex-wrap items-center gap-1.5">{engineSelect}</div>
        <VoicePicker
          value={{ voice_provider: engine, voice_name: voiceName }}
          onChange={(v) => {
            if (v.voice_provider !== engine) setModel(LOCAL_PREFIX + v.voice_provider, undefined, 'tts');
            setParams({ voice_provider: v.voice_provider, voice_name: v.voice_name });
          }}
          language={language}
          previewRate={rate}
          previewVolume={volume}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1">
            <span className="opacity-60">语速</span>
            <input type="range" min={0.25} max={4} step={0.05} value={rate}
              onChange={(e) => setParams({ voice_rate: parseFloat(e.target.value) })}
              className="w-24 accent-[var(--cy-brand-500)]" />
            <span className="tabular-nums">{rate.toFixed(2)}</span>
          </label>
          <label className="flex items-center gap-1">
            <span className="opacity-60">音量</span>
            <input type="range" min={0} max={2} step={0.05} value={volume}
              onChange={(e) => setParams({ voice_volume: parseFloat(e.target.value) })}
              className="w-24 accent-[var(--cy-brand-500)]" />
            <span className="tabular-nums">{volume.toFixed(2)}</span>
          </label>
          <label className="flex items-center gap-1">
            <span className="opacity-60">语言</span>
            <select value={language} onChange={(e) => setParams({ language: e.target.value })} className={selCls}>
              {LANG_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </label>
        </div>
      </div>
    );
  }

  // ── 厂商模型分支:沿用厂商音色下拉 + 语速 chips + 格式(vendor/voiceList/advOpen 已在上方提升) ──
  const voice = (() => {
    const stored = typeof params.voice === 'string' ? params.voice : '';
    if (stored && voiceList.some((v) => v.value === stored)) return stored;
    return voiceList[0]!.value;
  })();
  const speed = typeof params.speed === 'number' ? params.speed : 1.0;
  const fmt = typeof params.response_format === 'string' ? params.response_format : 'mp3';

  return (
    <div role="toolbar" aria-label="TTS 参数" className={cn('flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--cy-text-secondary)]', compact && 'gap-1')}>
      {engineSelect}
      <span className="opacity-60">音色</span>
      <select value={voice} onChange={(e) => setParams({ voice: e.target.value })} className={selCls}>
        {voiceList.map((v) => (
          <option key={v.value} value={v.value} title={v.hint}>{v.label}</option>
        ))}
      </select>

      <span className="mx-1 opacity-30">·</span>

      <span className="opacity-60">语速</span>
      <div className="flex items-center gap-0.5">
        {SPEED_OPTIONS.map((value) => {
          const active = Math.abs(speed - value) < 1e-3;
          return (
            <button key={value} type="button" onClick={() => setParams({ speed: value })} aria-pressed={active}
              title={`${value.toFixed(2)}×`}
              className={cn('inline-flex h-6 items-center gap-1 rounded-md px-1.5 transition-colors',
                active ? 'bg-[var(--cy-ink-700)] text-white' : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]')}>
              <Gauge className="h-3 w-3" />
              <span className="text-[10px]">{value.toFixed(2).replace(/\.?0+$/, '')}×</span>
            </button>
          );
        })}
      </div>

      <span className="mx-1 opacity-30">·</span>

      <button type="button" onClick={() => setAdvOpen((v) => !v)} aria-expanded={advOpen}
        className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]"
        title="高级:输出格式">
        <Music className="h-3 w-3" />
        <span className="text-[10px]">{fmt}</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform', advOpen && 'rotate-180')} />
      </button>
      {advOpen && (
        <div className="flex items-center gap-0.5">
          {FORMAT_OPTIONS.map((f) => {
            const active = fmt === f;
            return (
              <button key={f} type="button" onClick={() => setParams({ response_format: f })} aria-pressed={active}
                className={cn('inline-flex h-6 items-center rounded-md px-1.5 text-[10px] transition-colors',
                  active ? 'bg-[var(--cy-ink-700)] text-white' : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]')}>
                {f}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
