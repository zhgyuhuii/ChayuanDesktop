/**
 * 受控 TTS 设置(对话内联产出面板用)——不依赖 composer store,纯 value/onChange。
 * 复用 VoicePicker(本地引擎音色/克隆/试听)+ VerticalSliderPopover(语速/音量)。
 */
import * as React from 'react';
import { Gauge, Volume2 } from 'lucide-react';
import { cn } from '@chayuan/ui';
import type { VgVoiceProvider } from '@chayuan/api';
import { VoicePicker } from '../../video-generation/VoicePicker';
import { VerticalSliderPopover } from '../../video-generation/timeline/VerticalSliderPopover';

export interface TtsSettings {
  engine: VgVoiceProvider;
  voice: string;
  rate: number;
  volume: number;
  language: string;
}
export const DEFAULT_TTS_SETTINGS: TtsSettings = { engine: 'piper', voice: '', rate: 1, volume: 1, language: 'zh' };

const LOCAL_ENGINES: Array<{ id: VgVoiceProvider; label: string }> = [
  { id: 'piper', label: 'Piper(本地)' }, { id: 'edge', label: 'Edge(联网)' },
  { id: 'sherpa', label: 'Sherpa(本地)' }, { id: 'clone', label: '克隆(本地)' },
];
const LANG_OPTIONS = [
  { v: 'zh', l: '中文' }, { v: 'en', l: 'English' },
  { v: 'ja', l: '日本語' }, { v: 'ko', l: '한국어' },
];
const selCls = cn('h-6 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-1.5 text-[10px] text-[var(--cy-text-primary)] focus-visible:outline-none');

export const TtsActionSettings: React.FC<{ value: TtsSettings; onChange: (v: TtsSettings) => void }> = ({ value, onChange }) => {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--cy-text-secondary)]">
      <span className="opacity-60">语言</span>
      <select value={value.language || 'zh'} onChange={(e) => onChange({ ...value, language: e.target.value })} className={selCls} title="语言">
        {LANG_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
      <span className="mx-1 opacity-30">·</span>
      <span className="opacity-60">引擎</span>
      <div className="flex items-center gap-0.5">
        {LOCAL_ENGINES.map((e) => (
          <button key={e.id} type="button"
            onClick={() => onChange({ ...value, engine: e.id, voice: '' })}
            aria-pressed={value.engine === e.id}
            className={cn('inline-flex h-6 items-center rounded-md px-1.5 text-[10px] transition-colors',
              value.engine === e.id ? 'bg-[var(--cy-ink-700)] text-white' : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]')}>
            {e.label}
          </button>
        ))}
      </div>
      <VoicePicker
        value={{ voice_provider: value.engine, voice_name: value.voice }}
        onChange={(v) => onChange({ ...value, engine: v.voice_provider, voice: v.voice_name })}
        language={value.language}
        previewRate={value.rate}
        previewVolume={value.volume}
        hideProviderChips
      />
      <span className="mx-1 opacity-30">·</span>
      <VerticalSliderPopover value={value.rate} min={0.25} max={4} step={0.05}
        onChange={(v) => onChange({ ...value, rate: v })} icon={<Gauge className="h-3.5 w-3.5" />} title="语速" format={(v) => `${v.toFixed(2)}×`} />
      <VerticalSliderPopover value={value.volume} min={0} max={2} step={0.05}
        onChange={(v) => onChange({ ...value, volume: v })} icon={<Volume2 className="h-3.5 w-3.5" />} title="音量" format={(v) => v.toFixed(2)} />
    </div>
  );
};
