/**
 * 语音合成模式参数条(渲染在对话输入框上方)。
 *
 * 模型选择沿用原有 ComposerModelPill(可选对话模型 / 云端 TTS 模型)。本组件只管
 * 「语音设置」,且复用数字人同款 VoicePicker:
 *   - 选中的是云端 TTS 模型(byCap.get('tts') 里的非本地模型,如阿里 qwen-tts)→
 *     显示该厂商音色 + 语速 + 音量 + 格式 + 试听。
 *   - 否则(本地引擎 / 默认 / 对话模型)→ 显示 VoicePicker(piper/edge/sherpa/克隆 chips
 *     + 音色 + 克隆上传/录音 + 试听)+ 语速 + 音量 + 语言。选本地引擎时把选中模型记为
 *     伪模型 local-tts:<engine> 供后端本地连接器路由(pill 显示「本地引擎 · X」)。
 *
 * 语速/音量统一用 VerticalSliderPopover(图标点击 → 竖向滑条)。
 */

import * as React from 'react';
import { ChevronDown, Gauge, Music, Volume2, Play, Loader2 } from 'lucide-react';
import { cn } from '@chayuan/ui';
import { classifyModalityVendor, streamModality, isFilePart } from '@chayuan/transport';
import { getClientConfig, type VgVoiceProvider } from '@chayuan/api';
import { useComposerS } from '../../store/composer';
import { useAvailableModelsByCapability } from '../home/capabilityCards/useAvailableModelsByCapability';
import { VoicePicker } from '../video-generation/VoicePicker';
import { VerticalSliderPopover } from '../video-generation/timeline/VerticalSliderPopover';
import { VOICE_PREVIEW_TEXT } from '../video-generation/voicePreviewText';
import { reportError } from '../../store/errorDialog';

interface VoiceOption { value: string; label: string; hint?: string }

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
const FORMAT_OPTIONS = ['mp3', 'wav', 'opus'] as const;
const LOCAL_PREFIX = 'local-tts:';
const LOCAL_ENGINES: Array<{ id: VgVoiceProvider; label: string }> = [
  { id: 'piper', label: 'Piper(本地)' },
  { id: 'edge', label: 'Edge(联网)' },
  { id: 'sherpa', label: 'Sherpa(本地)' },
  { id: 'clone', label: '克隆(本地)' },
];
const LANG_OPTIONS = [
  { v: '', l: '自动' }, { v: 'zh', l: '中文' }, { v: 'en', l: 'English' },
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
  // 真·云端 TTS 模型(剔除本地 sidecar/bundled);用于判断当前选中的是不是云端 TTS。
  const vendorModels = (byCap.get('tts') ?? []).filter((m) => {
    const pn = m.platform_name ?? '';
    return !(pn === 'local' || pn.startsWith('local-') || m.id.startsWith('models/') || m.id.includes('bundled/'));
  });

  const isLocal = typeof modelId === 'string' && modelId.startsWith(LOCAL_PREFIX);
  const isVendorCloud = !isLocal && !!modelId && vendorModels.some((m) => m.id === modelId);

  // ── Hooks(任何条件 return 之前) ──────────────────────────────────────
  const [advOpen, setAdvOpen] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const vendor = classifyModalityVendor(modelId);
  const voiceList = vendor === 'dashscope' ? DASHSCOPE_VOICES : OPENAI_VOICES;
  React.useEffect(() => {
    if (!isVendorCloud) return;
    if (typeof params.voice === 'string' && voiceList.some((v) => v.value === params.voice)) return;
    setParams({ voice: voiceList[0]!.value });
  }, [vendor, isVendorCloud]); // eslint-disable-line react-hooks/exhaustive-deps
  // 默认进 TTS 模式常选中 bundled 本地模型(models/bundled/tts/piper)——它是引擎不是模型,
  // 归一到干净的本地引擎伪模型 local-tts:piper(之后用 VoicePicker chips 切换引擎)。
  React.useEffect(() => {
    if (isLocal) return;
    const looksLocalBundled = !modelId || modelId.startsWith('models/') || modelId.includes('bundled/');
    if (looksLocalBundled) setModel(LOCAL_PREFIX + 'piper', undefined, 'tts');
  }, [modelId, isLocal]); // eslint-disable-line react-hooks/exhaustive-deps

  const rate = typeof params.voice_rate === 'number' ? params.voice_rate
    : typeof params.speed === 'number' ? params.speed : 1.0;
  const volume = typeof params.voice_volume === 'number' ? params.voice_volume : 1.0;

  const onVendorPreview = async () => {
    if (!modelId) return;
    setPreviewing(true);
    try {
      const baseUrl = getClientConfig().baseURL || '';
      const m = vendorModels.find((x) => x.id === modelId);
      const sendModel = m?.platform_name ? `${m.platform_name}::${modelId}` : modelId;
      const stream = streamModality({
        model: sendModel, prompt: VOICE_PREVIEW_TEXT, baseUrl,
        params: { voice: params.voice, speed: rate, response_format: 'mp3' },
      });
      let url: string | null = null;
      for await (const ev of stream) {
        if (isFilePart(ev)) { url = ev.url.startsWith('/') ? baseUrl.replace(/\/+$/, '') + ev.url : ev.url; break; }
      }
      if (!url) { reportError(new Error('未产出音频'), '试听失败'); return; }
      const a = audioRef.current ?? new Audio();
      audioRef.current = a; a.src = url; await a.play();
    } catch (e) {
      reportError(e as Error, '试听失败');
    } finally {
      setPreviewing(false);
    }
  };

  const curEngine = isLocal ? modelId.slice(LOCAL_PREFIX.length) : '';
  const engineChips = (
    <>
      <span className="opacity-60">引擎</span>
      <div className="flex items-center gap-0.5">
        {LOCAL_ENGINES.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => { setModel(LOCAL_PREFIX + e.id, undefined, 'tts'); setParams({ voice_provider: e.id, voice_name: '' }); }}
            aria-pressed={curEngine === e.id}
            title={`本地引擎 · ${e.label}`}
            className={cn('inline-flex h-6 items-center rounded-md px-1.5 text-[10px] transition-colors',
              curEngine === e.id ? 'bg-[var(--cy-ink-700)] text-white' : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]')}
          >
            {e.label}
          </button>
        ))}
      </div>
      {isVendorCloud && <span className="text-[10px] text-[var(--cy-text-tertiary)]">(云端模型在下方模型选择处切换)</span>}
      <span className="mx-1 opacity-30">·</span>
    </>
  );

  const speedPopover = (
    <VerticalSliderPopover
      value={rate} min={0.25} max={4} step={0.05}
      onChange={(v) => setParams(isVendorCloud ? { voice_rate: v, speed: v } : { voice_rate: v })}
      icon={<Gauge className="h-3.5 w-3.5" />} title="语速" format={(v) => `${v.toFixed(2)}×`}
    />
  );
  const volumePopover = (
    <VerticalSliderPopover
      value={volume} min={0} max={2} step={0.05}
      onChange={(v) => setParams({ voice_volume: v })}
      icon={<Volume2 className="h-3.5 w-3.5" />} title="音量" format={(v) => v.toFixed(2)}
    />
  );

  // ── 云端 TTS 模型分支:厂商音色 + 语速/音量/格式/试听 ──────────────────
  if (isVendorCloud) {
    const voice = (() => {
      const stored = typeof params.voice === 'string' ? params.voice : '';
      if (stored && voiceList.some((v) => v.value === stored)) return stored;
      return voiceList[0]!.value;
    })();
    const fmt = typeof params.response_format === 'string' ? params.response_format : 'mp3';
    return (
      <div role="toolbar" aria-label="TTS 参数(云端)" className={cn('flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--cy-text-secondary)]', compact && 'gap-1')}>
        {engineChips}
        <span className="opacity-60">音色</span>
        <select value={voice} onChange={(e) => setParams({ voice: e.target.value })} className={selCls}>
          {voiceList.map((v) => (<option key={v.value} value={v.value} title={v.hint}>{v.label}</option>))}
        </select>
        <span className="mx-1 opacity-30">·</span>
        {speedPopover}
        {volumePopover}
        <button type="button" onClick={() => setAdvOpen((v) => !v)} aria-expanded={advOpen}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]" title="高级:输出格式">
          <Music className="h-3 w-3" /><span className="text-[10px]">{fmt}</span>
          <ChevronDown className={cn('h-3 w-3 transition-transform', advOpen && 'rotate-180')} />
        </button>
        {advOpen && (
          <div className="flex items-center gap-0.5">
            {FORMAT_OPTIONS.map((f) => (
              <button key={f} type="button" onClick={() => setParams({ response_format: f })} aria-pressed={fmt === f}
                className={cn('inline-flex h-6 items-center rounded-md px-1.5 text-[10px] transition-colors',
                  fmt === f ? 'bg-[var(--cy-ink-700)] text-white' : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]')}>
                {f}
              </button>
            ))}
          </div>
        )}
        <span className="mx-1 opacity-30">·</span>
        <button type="button" onClick={() => void onVendorPreview()} disabled={previewing}
          title="试听" aria-label="试听"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50">
          {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        </button>
      </div>
    );
  }

  // ── 本地引擎分支:复用 VoicePicker(含引擎 chips)+ 语速/音量/语言 ──────
  const vpProvider = (isLocal ? modelId.slice(LOCAL_PREFIX.length)
    : (typeof params.voice_provider === 'string' ? params.voice_provider : 'piper')) as VgVoiceProvider;
  const language = typeof params.language === 'string' ? params.language : '';
  const voiceName = typeof params.voice_name === 'string' ? params.voice_name : '';
  return (
    <div role="toolbar" aria-label="TTS 参数(本地)" className={cn('flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--cy-text-secondary)]', compact && 'gap-1')}>
      <span className="opacity-60">语言</span>
      <select value={language} onChange={(e) => setParams({ language: e.target.value })} className={selCls} title="语言">
        {LANG_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
      <span className="mx-1 opacity-30">·</span>
      {engineChips}
      <VoicePicker
        value={{ voice_provider: vpProvider, voice_name: voiceName }}
        onChange={(v) => {
          setModel(LOCAL_PREFIX + v.voice_provider, undefined, 'tts');
          setParams({ voice_provider: v.voice_provider, voice_name: v.voice_name });
        }}
        language={language}
        previewRate={rate}
        previewVolume={volume}
        hideProviderChips
      />
      <span className="mx-1 opacity-30">·</span>
      {speedPopover}
      {volumePopover}
    </div>
  );
};
