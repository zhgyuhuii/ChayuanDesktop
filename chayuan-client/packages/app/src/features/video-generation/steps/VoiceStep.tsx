/**
 * Step 3 · 语音(TTS provider + 音色 + 语速 + 音量 + 试听)。
 *
 * 设计:
 *   - provider chip:piper(本地离线) / edge(微软在线)/ sherpa(M4 升级)
 *   - 音色 dropdown 跟 provider 联动:列表来自后端 /voices(按 provider 过滤)
 *   - rate / volume slider 0.5-2.0 / 0.0-2.0
 *   - 试听按钮:取脚本前 50 字(不超 200,后端限制),调 previewAudio 拿 wav
 *     blob,createObjectURL 喂 <audio>,播放完毕自动 revoke 防内存泄漏
 *   - 提示文案告诉用户 piper 离线推理 ~1× realtime + edge 联网更高质量
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Play, Square, Wifi, WifiOff } from 'lucide-react';
import {
  videoGeneration,
  type VgVoiceItem,
  type VgVoiceProvider,
} from '@chayuan/api';
import { useVgComposer } from '../store/vgComposer';
import { VOICE_PREVIEW_TEXT } from '../voicePreviewText';
import { reportError } from '../../../store/errorDialog';
import { blobToAudioDataUrl } from '../blobToDataUrl';

const PROVIDERS: Array<{ id: VgVoiceProvider; label: string; hint: string; offline: boolean }> = [
  { id: 'piper',  label: 'piper(本地快速)', hint: 'CPU ~1× 实时,无网可用,音色机器味较重',  offline: true },
  { id: 'edge',   label: 'edge(联网)',  hint: '联网免 Key,声音自然,300+ 多语种音色', offline: false },
  { id: 'sherpa', label: 'sherpa(本地高质)', hint: '高质量中文 VITS,模型 ~125 MB,需先 seed-bundled-assets.py sherpa-voice', offline: true },
];

export const VoiceStep: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patchParams = useVgComposer((s) => s.patchParams);
  const script = useVgComposer((s) => {
    const src = s.params.script_source;
    return src === 'ai' ? s.scriptSlots.ai
      : src === 'manual' ? s.scriptSlots.manual
      : s.scriptSlots.srt;
  });

  // 音色列表跟 provider 联动
  const voicesQ = useQuery({
    queryKey: ['vg.voices', params.voice_provider],
    queryFn: () => videoGeneration.listVoices(params.voice_provider),
    staleTime: 5 * 60 * 1000,
  });
  // 音色按当前语言过滤(同对话模式 VgMessageExtras 规则):同语言 / 同语族 /
  // multilingual 音色保留;过滤后为空则回退全量,避免下拉空白。
  const allVoices: VgVoiceItem[] = voicesQ.data?.items ?? [];
  const lang = params.video_language;
  const fam = lang.split('-')[0];
  const matched = lang
    ? allVoices.filter((v) => v.language === lang || v.language.split('-')[0] === fam || /multilingual/i.test(v.id))
    : allVoices;
  const voices = matched.length > 0 ? matched : allVoices;

  // ── 试听 ────────────────────────────────────────────────────
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const previewText = React.useMemo(() => {
    const t = (script || VOICE_PREVIEW_TEXT).replace(/\s+/g, ' ').trim();
    return t.length > 50 ? t.slice(0, 50) : t;
  }, [script]);

  const onPreview = React.useCallback(async () => {
    if (playing) {
      audioRef.current?.pause();
      audioRef.current?.removeAttribute('src');
      setPlaying(false);
      return;
    }
    setPreviewing(true);
    try {
      const r = await videoGeneration.previewAudio({
        video_script: previewText,
        voice_provider: params.voice_provider,
        voice_name: params.voice_name || undefined,
        voice_rate: params.voice_rate,
        voice_volume: params.voice_volume,
      });
      // WKWebView 不支持 blob: 作 <audio> 源(NotSupportedError)→ data: URL
      const url = await blobToAudioDataUrl(r.blob);
      setPreviewUrl(url);
      const el = audioRef.current ?? new Audio();
      audioRef.current = el;
      el.src = url;
      el.onended = () => setPlaying(false);
      el.onerror = () => setPlaying(false);
      await el.play();
      setPlaying(true);
    } catch (e) {
      reportError(e as Error, '试听失败 — 检查 TTS 服务是否就绪');
    } finally {
      setPreviewing(false);
    }
  }, [playing, previewText, params.voice_provider, params.voice_name, params.voice_rate, params.voice_volume, previewUrl]);

  const selCls =
    'h-8 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-xs text-[var(--cy-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]';

  return (
    <div className="space-y-2">
      {/* 单行:provider · 音色 · 语速 · 音量 · 试听 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* provider chip(紧凑) */}
        {PROVIDERS.map((p) => (
          <button
            type="button"
            key={p.id}
            onClick={() => patchParams({ voice_provider: p.id, voice_name: '' })}
            title={p.hint}
            className={
              'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors ' +
              (params.voice_provider === p.id
                ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')
            }
          >
            {p.offline ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
            {p.id}
          </button>
        ))}

        {/* 音色(按语言过滤) */}
        <select
          className={`${selCls} w-[13em]`}
          value={params.voice_name || voices[0]?.id || ''}
          onChange={(e) => patchParams({ voice_name: e.target.value })}
          disabled={voices.length === 0}
          title={voices.length === 0 ? '当前后端无可用音色' : '音色'}
        >
          {voices.length === 0 && <option value="">{voicesQ.isLoading ? '加载中…' : '无音色'}</option>}
          {voices.map((v) => (
            <option key={v.id} value={v.id}>{v.label} · {v.language}</option>
          ))}
        </select>

        {/* 语速 */}
        <select
          className={`${selCls} w-[5.5em]`}
          value={params.voice_rate}
          onChange={(e) => patchParams({ voice_rate: parseFloat(e.target.value) })}
          title="语速"
        >
          {[0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0].map((r) => (
            <option key={r} value={r}>{r.toFixed(2).replace(/\.?0+$/, '')}×</option>
          ))}
        </select>

        {/* 音量 — 滑块上下/左右拖调 */}
        <span className="inline-flex items-center gap-1 text-xs text-[var(--cy-text-tertiary)]">
          音量
          <input
            type="range" min={0} max={2} step={0.05}
            value={params.voice_volume}
            onChange={(e) => patchParams({ voice_volume: parseFloat(e.target.value) })}
            className="w-20 accent-[var(--cy-brand-500)]"
            title={`${Math.round(params.voice_volume * 100)}%`}
          />
          <span className="w-9 text-right tabular-nums">{Math.round(params.voice_volume * 100)}%</span>
        </span>

        {/* 试听 */}
        <button
          type="button"
          onClick={onPreview}
          disabled={previewing}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--cy-brand-500)] px-3 text-xs font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : playing ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {previewing ? '合成中' : playing ? '停止' : '试听'}
        </button>
      </div>
      <p className="text-[10px] text-[var(--cy-text-tertiary)]">
        {PROVIDERS.find((p) => p.id === params.voice_provider)?.hint} · 试听用前 50 字
      </p>
    </div>
  );
};
