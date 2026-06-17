/**
 * 紧凑 3 row TtsCard — 渲染在每条 assistant message 下方(VgMessageExtras)。
 *
 * 数据走 message.metadata.videoMeta.tts(props-controlled),不依赖 vgComposerStore。
 * 跟 toolbar VgAudioPopover 关系:popover 写全局默认,新 message 用全局默认初始化;
 * 本 TtsCard 编辑当前 message 的覆盖值。
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Play, Wifi, WifiOff } from 'lucide-react';
import { videoGeneration, type VgVoiceItem, type VgVoiceProvider } from '@chayuan/api';
import type { VgMessageMeta } from '@chayuan/transport';
import { reportError } from '../../store/errorDialog';

export interface TtsCardProps {
  tts: NonNullable<VgMessageMeta['tts']>;
  onChange: (next: NonNullable<VgMessageMeta['tts']>) => void;
  /** 试听用文本(脚本前 50 字)*/
  previewText: string;
}

const PROVIDERS: Array<{ id: VgVoiceProvider; offline: boolean; label: string }> = [
  { id: 'piper',  offline: true,  label: 'piper' },
  { id: 'edge',   offline: false, label: 'edge'  },
  { id: 'sherpa', offline: true,  label: 'sherpa'},
];

export const TtsCard: React.FC<TtsCardProps> = ({ tts, onChange, previewText }) => {
  const voicesQ = useQuery({
    queryKey: ['vg.voices', tts.provider],
    queryFn: () => videoGeneration.listVoices(tts.provider),
    staleTime: 5 * 60 * 1000,
  });
  const voices: VgVoiceItem[] = voicesQ.data?.items ?? [];
  const [previewing, setPreviewing] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const urlRef = React.useRef<string | null>(null);

  React.useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const onPreview = async () => {
    if (!previewText.trim()) return;
    setPreviewing(true);
    try {
      const r = await videoGeneration.previewAudio({
        video_script: previewText.slice(0, 50),
        voice_provider: tts.provider, voice_name: tts.voice || undefined,
        voice_rate: tts.rate, voice_volume: tts.volume,
      });
      // ⚠ Tauri WKWebView(macOS)不支持 blob: URL 作 <audio> 媒体源 → play() 报
      // NotSupportedError（打包后才暴露，dev 浏览器支持 blob）。改用 data: URL 内联，
      // 跟 VoicePicker 试听同款修法。
      const wavBlob = r.blob.type ? r.blob : new Blob([r.blob], { type: 'audio/wav' });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(wavBlob);
      });
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      a.src = dataUrl;
      await a.play();
    } catch (e) { reportError(e as Error, '试听失败'); }
    finally { setPreviewing(false); }
  };

  return (
    <div className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-2.5 text-xs">
      {/* row 1: provider + voice + preview */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PROVIDERS.map((p) => (
          <button key={p.id} type="button" onClick={() => onChange({ ...tts, provider: p.id, voice: '' })}
            className={
              'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ' +
              (tts.provider === p.id
                ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')
            }
          >
            {p.offline ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
            {p.label}
          </button>
        ))}
        <select
          value={tts.voice || voices[0]?.id || ''}
          onChange={(e) => onChange({ ...tts, voice: e.target.value })}
          disabled={voices.length === 0}
          className="rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5 py-0.5"
        >
          {voices.length === 0 && <option value="">(无可用音色)</option>}
          {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
        <button type="button" onClick={onPreview} disabled={previewing || !previewText.trim()}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-[var(--cy-brand-500)] px-2 py-0.5 text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
          {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          试听
        </button>
      </div>
      {/* row 2: rate + volume slider */}
      <div className="mt-2 grid grid-cols-2 gap-3">
        <label className="flex items-center gap-1.5">
          <span className="w-7 text-[var(--cy-text-tertiary)]">语速</span>
          <input type="range" min={0.5} max={2.0} step={0.05} value={tts.rate}
            onChange={(e) => onChange({ ...tts, rate: parseFloat(e.target.value) })}
            className="flex-1 accent-[var(--cy-brand-500)]" />
          <span className="w-10 text-right tabular-nums">{tts.rate.toFixed(2)}×</span>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="w-7 text-[var(--cy-text-tertiary)]">音量</span>
          <input type="range" min={0} max={2} step={0.05} value={tts.volume}
            onChange={(e) => onChange({ ...tts, volume: parseFloat(e.target.value) })}
            className="flex-1 accent-[var(--cy-brand-500)]" />
          <span className="w-10 text-right tabular-nums">{Math.round(tts.volume * 100)}%</span>
        </label>
      </div>
      {/* row 3: 当前生效 */}
      <p className="mt-1.5 text-[10px] text-[var(--cy-text-tertiary)]">
        生效:{tts.provider} · {tts.voice || '(默认)'}
      </p>
    </div>
  );
};
