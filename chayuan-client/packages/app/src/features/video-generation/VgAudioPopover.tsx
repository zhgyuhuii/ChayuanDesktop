/**
 * 语音设置 — 内联参数条(对齐 composer/TtsVoiceParamBar 视觉:h-6 / text-[10px] /
 * `·` 分隔 / ink-700 高亮 chip / 单行可换行)。
 *
 * 由 VgComposerToolbar 在"语音设置"chip 展开时内联渲染。写全局默认
 * vgComposer.params.voice_*;单条消息覆盖走 message 下方 TtsCard。
 *
 * 导出 VgSpeechSettings(原 VgAudioPopover 改名;弹窗 → 内联)。
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wifi, WifiOff, Play, Loader2 } from 'lucide-react';
import { cn } from '@chayuan/ui';
import { videoGeneration, type VgVoiceItem, type VgVoiceProvider } from '@chayuan/api';
import { useVgComposer } from './store/vgComposer';
import { reportError } from '../../store/errorDialog';

const PROVIDERS: Array<{ id: VgVoiceProvider; offline: boolean; label: string }> = [
  { id: 'piper',  offline: true,  label: 'piper'  },
  { id: 'edge',   offline: false, label: 'edge'   },
  { id: 'sherpa', offline: true,  label: 'sherpa' },
];

const RATE_OPTIONS = [0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0] as const;

const chipCls = (active: boolean) =>
  cn(
    'inline-flex h-6 items-center rounded-md px-1.5 text-[10px] transition-colors',
    active
      ? 'bg-[var(--cy-ink-700)] text-white'
      : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]',
  );

export const VgSpeechSettings: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const voicesQ = useQuery({
    queryKey: ['vg.voices', params.voice_provider],
    queryFn: () => videoGeneration.listVoices(params.voice_provider),
    staleTime: 5 * 60 * 1000,
  });
  // 按 toolbar 选的语言过滤音色;选「自动」(空)显示全部。放宽匹配以给更多音色:
  //   - 精确同语言(zh-CN)
  //   - 同语族(zh-* 港台也算中文,en-* 英语都算)
  //   - 多语种音色(*Multilingual*,微软这些能流利说任意语言,质量高)
  // 过滤后为空(如 piper 无该语言离线音色)→ fallback 全部 + 提示,避免下拉空。
  const allVoices: VgVoiceItem[] = voicesQ.data?.items ?? [];
  const lang = params.video_language;
  const langFamily = lang.split('-')[0];
  const matched = lang
    ? allVoices.filter(
        (v) =>
          v.language === lang ||
          v.language.split('-')[0] === langFamily ||
          /multilingual/i.test(v.id),
      )
    : allVoices;
  const noMatch = !!lang && matched.length === 0 && allVoices.length > 0;
  const voices = noMatch ? allVoices : matched;

  // 当前选中音色不在过滤后列表里 → 自动切到第一个匹配音色(语言切换时纠偏)
  React.useEffect(() => {
    if (voices.length === 0) return;
    if (voices.some((v) => v.id === params.voice_name)) return;
    patch({ voice_name: voices[0]!.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, params.voice_provider, allVoices.length]);

  const [previewing, setPreviewing] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const urlRef = React.useRef<string | null>(null);
  React.useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const onPreview = async () => {
    setPreviewing(true);
    try {
      const r = await videoGeneration.previewAudio({
        video_script: '试听一段示例文本，听听这个音色的效果。',
        voice_provider: params.voice_provider,
        voice_name: params.voice_name || undefined,
        voice_rate: params.voice_rate,
        voice_volume: params.voice_volume,
      });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(r.blob);
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      a.src = urlRef.current;
      await a.play();
    } catch (e) {
      reportError(e as Error, '试听失败');
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="语音设置"
      className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--cy-text-secondary)]"
    >
      {/* 后端 */}
      <span className="opacity-60">后端</span>
      <div className="flex items-center gap-0.5">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => patch({ voice_provider: p.id, voice_name: '' })}
            aria-pressed={params.voice_provider === p.id}
            className={cn(chipCls(params.voice_provider === p.id), 'gap-1')}
          >
            {p.offline ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
            {p.label}
          </button>
        ))}
      </div>

      <span className="mx-1 opacity-30">·</span>

      {/* 音色 select — 限宽 ~5 字,鼠标悬停 title 显示全名 */}
      <span className="opacity-60">音色</span>
      <select
        value={params.voice_name || voices[0]?.id || ''}
        onChange={(e) => patch({ voice_name: e.target.value })}
        disabled={voices.length === 0}
        title={voices.find((v) => v.id === (params.voice_name || voices[0]?.id))?.label ?? '音色'}
        className={cn(
          'h-6 w-[10em] rounded-md border border-[var(--cy-border-subtle)]',
          'bg-[var(--cy-surface-1)] pl-1.5 pr-5 text-[10px] text-[var(--cy-text-primary)]',
          'focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none',
        )}
      >
        {voices.length === 0 && (
          <option value="">
            {voicesQ.isLoading ? '加载中…'
              : params.voice_provider === 'sherpa' ? '(无 sherpa 模型,去模型广场下载)'
              : params.voice_provider === 'edge' ? '(空 — 请重启后端)'
              : '(无可用音色)'}
          </option>
        )}
        {voices.map((v) => (
          <option key={v.id} value={v.id} title={v.label}>
            {v.label}
          </option>
        ))}
      </select>
      {noMatch && (
        <span className="text-[10px] text-amber-600" title="当前后端无该语言音色">
          无该语言音色,已列全部(可换 edge)
        </span>
      )}

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

      <span className="mx-1 opacity-30">·</span>

      {/* 试听 */}
      <button
        type="button"
        onClick={onPreview}
        disabled={previewing}
        className="inline-flex h-6 items-center gap-1 rounded-md bg-[var(--cy-brand-500)] px-2 text-[10px] text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50"
      >
        {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
        试听
      </button>
    </div>
  );
};
