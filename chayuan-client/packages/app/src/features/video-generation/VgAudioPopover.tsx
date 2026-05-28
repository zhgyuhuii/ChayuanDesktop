/**
 * Toolbar 🔊 音频 chip — 弹 popover 配置全局默认 TTS。
 *
 * 两层结构:
 *   - 本 popover:全局默认,写 vgComposer.params.voice_*
 *   - 单条消息覆盖:assistant message 下方 TtsCard(R3.3)
 *
 * 试听用固定示例文本,跟 message 下方 TtsCard 的 previewText(脚本前 50 字)不同。
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Volume2, Wifi, WifiOff, Play, Loader2 } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@chayuan/ui';
import { videoGeneration, type VgVoiceItem, type VgVoiceProvider } from '@chayuan/api';
import { useVgComposer } from './store/vgComposer';
import { reportError } from '../../store/errorDialog';

const PROVIDERS: Array<{ id: VgVoiceProvider; offline: boolean; label: string }> = [
  { id: 'piper',  offline: true,  label: 'piper'  },
  { id: 'edge',   offline: false, label: 'edge'   },
  { id: 'sherpa', offline: true,  label: 'sherpa' },
];

export const VgAudioPopover: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const voicesQ = useQuery({
    queryKey: ['vg.voices', params.voice_provider],
    queryFn: () => videoGeneration.listVoices(params.voice_provider),
    staleTime: 5 * 60 * 1000,
  });
  const voices: VgVoiceItem[] = voicesQ.data?.items ?? [];
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

  const summaryLabel = `${params.voice_provider} · ${params.voice_name || '(默认音色)'}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-xs hover:border-[var(--cy-border-strong)]"
          title="全局音频设置"
        >
          <Volume2 className="h-3 w-3 text-[var(--cy-brand-500)]" />
          <span className="max-w-[10rem] truncate">{summaryLabel}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[360px] p-3 text-xs">
        <div className="mb-2">
          <p className="mb-1 text-[var(--cy-text-tertiary)]">TTS 后端</p>
          <div className="flex flex-wrap gap-1">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => patch({ voice_provider: p.id, voice_name: '' })}
                className={
                  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ' +
                  (params.voice_provider === p.id
                    ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                    : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)]')
                }
              >
                {p.offline ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-2">
          <p className="mb-1 text-[var(--cy-text-tertiary)]">音色</p>
          <select
            value={params.voice_name || voices[0]?.id || ''}
            onChange={(e) => patch({ voice_name: e.target.value })}
            className="w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1"
            disabled={voices.length === 0}
          >
            {voices.length === 0 && <option value="">(无可用音色)</option>}
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} · {v.language}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-2 grid grid-cols-2 gap-3">
          <label className="flex items-center gap-1">
            <span className="w-7 text-[var(--cy-text-tertiary)]">语速</span>
            <input
              type="range"
              min={0.5} max={2} step={0.05}
              value={params.voice_rate}
              onChange={(e) => patch({ voice_rate: parseFloat(e.target.value) })}
              className="flex-1 accent-[var(--cy-brand-500)]"
            />
            <span className="w-10 text-right tabular-nums">{params.voice_rate.toFixed(2)}&times;</span>
          </label>
          <label className="flex items-center gap-1">
            <span className="w-7 text-[var(--cy-text-tertiary)]">音量</span>
            <input
              type="range"
              min={0} max={2} step={0.05}
              value={params.voice_volume}
              onChange={(e) => patch({ voice_volume: parseFloat(e.target.value) })}
              className="flex-1 accent-[var(--cy-brand-500)]"
            />
            <span className="w-10 text-right tabular-nums">{Math.round(params.voice_volume * 100)}%</span>
          </label>
        </div>
        <button
          type="button"
          onClick={onPreview}
          disabled={previewing}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--cy-brand-500)] py-1.5 text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50"
        >
          {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          试听
        </button>
        <p className="mt-1.5 text-[10px] text-[var(--cy-text-tertiary)]">
          这是全局默认。每条消息块下方 TtsCard 可单独覆盖。
        </p>
      </PopoverContent>
    </Popover>
  );
};
