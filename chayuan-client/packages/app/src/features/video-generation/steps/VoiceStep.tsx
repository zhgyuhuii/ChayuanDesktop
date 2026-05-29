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
import { reportError } from '../../../store/errorDialog';

const PROVIDERS: Array<{ id: VgVoiceProvider; label: string; hint: string; offline: boolean }> = [
  { id: 'piper',  label: 'piper(本地快速)', hint: 'CPU ~1× 实时,无网可用,音色机器味较重',  offline: true },
  { id: 'edge',   label: 'edge(微软在线)',  hint: '联网免 Key,声音自然,300+ 多语种音色', offline: false },
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
    const t = (script || '试听一段示例文本,听听这个音色的效果。').replace(/\s+/g, ' ').trim();
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
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(r.blob);
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

  return (
    <div className="space-y-5">
      {/* provider chip */}
      <div>
        <label className="mb-2 block text-sm font-medium text-[var(--cy-text-primary)]">
          TTS 后端
        </label>
        <div className="flex flex-wrap gap-2">
          {PROVIDERS.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => patchParams({ voice_provider: p.id, voice_name: '' })}
              className={
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ' +
                (params.voice_provider === p.id
                  ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                  : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')
              }
              title={p.hint}
            >
              {p.offline ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-[var(--cy-text-tertiary)]">
          {PROVIDERS.find((p) => p.id === params.voice_provider)?.hint}
        </p>
      </div>

      {/* 音色 */}
      <div>
        <label className="mb-2 block text-sm font-medium text-[var(--cy-text-primary)]">
          音色
        </label>
        {voicesQ.isLoading ? (
          <div className="text-xs text-[var(--cy-text-tertiary)]">加载音色列表…</div>
        ) : voices.length === 0 ? (
          <div className="text-xs text-[var(--cy-text-tertiary)]">
            {params.voice_provider === 'sherpa'
              ? '未找到本地 sherpa voice — 跑 ``scripts/seed-bundled-assets.py sherpa-voice`` 下载模型(~125 MB)'
              : '当前后端无可用音色'}
          </div>
        ) : (
          <select
            className="w-full max-w-md rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]"
            value={params.voice_name || voices[0]?.id || ''}
            onChange={(e) => patchParams({ voice_name: e.target.value })}
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} · {v.language}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* rate / volume slider */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 flex items-center justify-between text-sm font-medium text-[var(--cy-text-primary)]">
            语速
            <span className="text-xs font-normal text-[var(--cy-text-tertiary)]">
              {params.voice_rate.toFixed(2)}×
            </span>
          </label>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.05}
            value={params.voice_rate}
            onChange={(e) => patchParams({ voice_rate: parseFloat(e.target.value) })}
            className="w-full accent-[var(--cy-brand-500)]"
          />
        </div>
        <div>
          <label className="mb-1.5 flex items-center justify-between text-sm font-medium text-[var(--cy-text-primary)]">
            音量
            <span className="text-xs font-normal text-[var(--cy-text-tertiary)]">
              {Math.round(params.voice_volume * 100)}%
            </span>
          </label>
          <input
            type="range"
            min={0.0}
            max={2.0}
            step={0.05}
            value={params.voice_volume}
            onChange={(e) => patchParams({ voice_volume: parseFloat(e.target.value) })}
            className="w-full accent-[var(--cy-brand-500)]"
          />
        </div>
      </div>

      {/* 试听 */}
      <div className="rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onPreview}
            disabled={previewing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--cy-brand-500)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--cy-brand-600)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {previewing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : playing ? (
              <Square className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {previewing ? '合成中…' : playing ? '停止' : '试听'}
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-[var(--cy-text-secondary)]">
              试听文本(≤ 50 字):{previewText}
            </p>
            <p className="mt-0.5 text-[10px] text-[var(--cy-text-tertiary)]">
              试听只用前 50 字,正式合成时用完整脚本
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
