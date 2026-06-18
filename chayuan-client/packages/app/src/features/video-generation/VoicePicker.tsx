/**
 * VoicePicker — 受控音色选择器,从 VgSpeechSettings 抽出。
 *
 * 包含:后端 chip 行、语言过滤音色 <select>、克隆上传/录音/删除、试听按钮。
 * 不依赖全局 vgComposer store;通过 value/onChange props 控制。
 *
 * 使用方:
 *   <VoicePicker
 *     value={{ voice_provider, voice_name }}
 *     onChange={(v) => ...}
 *     language={params.video_language}
 *     previewRate={params.voice_rate}
 *     previewVolume={params.voice_volume}
 *   />
 */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Wifi, WifiOff, Play, Loader2, Mic, Square, Upload, Trash2, Pencil } from 'lucide-react';
import { cn } from '@chayuan/ui';
import { videoGeneration, type VgVoiceProvider } from '@chayuan/api';
import { VOICE_PREVIEW_TEXT } from './voicePreviewText';
import { reportError } from '../../store/errorDialog';
import { confirmDialog } from '../../store/confirmDialog';
import { promptDialog } from '../../store/promptDialog';

export interface VoicePickerValue {
  voice_provider: VgVoiceProvider;
  voice_name: string;
}

const PROVIDERS: Array<{ id: VgVoiceProvider; offline: boolean; label: string }> = [
  { id: 'piper',  offline: true,  label: 'Piper(本地)'  },
  { id: 'edge',   offline: false, label: 'Edge(联网)'   },
  { id: 'sherpa', offline: true,  label: 'Sherpa(本地)' },
  { id: 'clone',  offline: true,  label: '克隆(本地)'   },
];

const chipCls = (active: boolean) =>
  cn(
    'inline-flex h-6 items-center rounded-md px-1.5 text-[10px] transition-colors',
    active
      ? 'bg-[var(--cy-ink-700)] text-white'
      : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]',
  );

export const VoicePicker: React.FC<{
  value: VoicePickerValue;
  onChange: (v: VoicePickerValue) => void;
  /** 语言过滤(传 params.video_language);省略/'' = 不过滤,列全部 */
  language?: string;
  /** 试听语速,默认 1.0 */
  previewRate?: number;
  /** 试听音量,默认 1.0 */
  previewVolume?: number;
  /** 隐藏「后端」引擎 chip 行(由外部下拉接管引擎选择时用);默认显示 */
  hideProviderChips?: boolean;
}> = ({ value, onChange, language = '', previewRate = 1.0, previewVolume = 1.0, hideProviderChips = false }) => {
  const qc = useQueryClient();

  const voicesQ = useQuery({
    queryKey: ['vg.voices', value.voice_provider],
    queryFn: () => videoGeneration.listVoices(value.voice_provider),
    staleTime: 5 * 60 * 1000,
  });

  // 按语言过滤音色;选「自动」(空)显示全部。
  //   - 精确同语言(zh-CN)
  //   - 同语族(zh-* 港台也算中文,en-* 英语都算)
  //   - 多语种音色(*Multilingual*,微软这些能流利说任意语言)
  // 过滤后为空(如 piper 无该语言离线音色) → fallback 全部 + 提示,避免下拉空。
  const allVoices = voicesQ.data?.items ?? [];
  // 克隆音色与语言无关(VoxCPM 跟着样本说任意语言) → 不做语言过滤,全列。
  const isClone = value.voice_provider === 'clone';
  const lang = language;
  const langFamily = lang.split('-')[0];
  const matched = lang
    ? allVoices.filter(
        (v) =>
          v.language === lang ||
          v.language.split('-')[0] === langFamily ||
          /multilingual/i.test(v.id),
      )
    : allVoices;
  const noMatch = !isClone && !!lang && matched.length === 0 && allVoices.length > 0;
  const voices = isClone ? allVoices : noMatch ? allVoices : matched;

  // 当前选中音色不在过滤后列表里 → 自动切到第一个匹配音色(语言切换时纠偏)
  React.useEffect(() => {
    if (voices.length === 0) return;
    if (voices.some((v) => v.id === value.voice_name)) return;
    // 语言「自动」(未过滤)时不能直接取 voices[0] —— piper 音色按字母序首个常是非中文
    // (ar_/de_/en_…),拿它念中文会乱码。优先挑中文音色作默认;挑不到再退第一个。
    // (选了具体语言时 voices 已按语言过滤,find 命中即该语言首个,行为不变。)
    const pick = voices.find((v) => (v.language || '').toLowerCase().startsWith('zh')) ?? voices[0]!;
    onChange({ ...value, voice_name: pick.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, value.voice_provider, allVoices.length]);

  // piper 选中未下载音色 → 显式下载 + 状态(下载中/失败),不再悄悄回退默认
  const [dlState, setDlState] = React.useState<'idle' | 'downloading' | 'failed'>('idle');
  const onSelectVoice = React.useCallback(
    async (id: string) => {
      onChange({ ...value, voice_name: id });
      const item = allVoices.find((v) => v.id === id);
      if (value.voice_provider !== 'piper' || !item || item.downloaded !== false) {
        setDlState('idle');
        return;
      }
      setDlState('downloading');
      try {
        await videoGeneration.downloadVoice('piper', id);
        setDlState('idle');
        // 刷新音色列表(downloaded 状态更新)
        void qc.invalidateQueries({ queryKey: ['vg.voices', 'piper'] });
      } catch {
        setDlState('failed');
      }
    },
    [allVoices, value, onChange, qc],
  );

  // ── 试听 ─────────────────────────────────────────────────────────────
  const [previewing, setPreviewing] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const urlRef = React.useRef<string | null>(null);
  React.useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const onPreview = async () => {
    setPreviewing(true);
    try {
      const r = await videoGeneration.previewAudio({
        video_script: VOICE_PREVIEW_TEXT,
        voice_provider: value.voice_provider,
        voice_name: value.voice_name || undefined,
        voice_rate: previewRate,
        voice_volume: previewVolume,
      });
      // ⚠ Tauri WKWebView(macOS)不支持 blob: URL 作 <audio> 媒体源 → play() 报
      // NotSupportedError。改用 data: URL(base64,内联),WKWebView 支持正常。
      const wavBlob = r.blob.type ? r.blob : new Blob([r.blob], { type: 'audio/wav' });
      const dataUrl: string = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(fr.error ?? new Error('读取音频失败'));
        fr.readAsDataURL(wavBlob);
      });
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      a.src = dataUrl;
      await a.play();
    } catch (e) {
      reportError(e as Error, '试听失败');
    } finally {
      setPreviewing(false);
    }
  };

  // ── 克隆音色:上传 / 录音 / 删除 ────────────────────────────────────
  const [cloneBusy, setCloneBusy] = React.useState(false);
  const [cloneEngine, setCloneEngine] = React.useState<'voxcpm' | 'cosyvoice'>('voxcpm');
  const [recording, setRecording] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const recRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  React.useEffect(
    () => () => { try { recRef.current?.stop(); } catch { /* noop */ } },
    [],
  );

  const registerClone = React.useCallback(
    async (blob: Blob, defaultName: string) => {
      // Tauri webview 禁用 window.prompt(返 null)→ 必须用跨端 promptDialog,
      // 否则桌面版"录音/上传克隆音色"起名这步静默中断,克隆根本建不出来。
      const name = await promptDialog('给这个克隆音色起个名字', { defaultValue: defaultName, title: '克隆音色命名' });
      if (!name || !name.trim()) return;
      setCloneBusy(true);
      try {
        const r = await videoGeneration.uploadCloneVoice({ file: blob, name: name.trim(), engine: cloneEngine });
        await qc.invalidateQueries({ queryKey: ['vg.voices', 'clone'] });
        onChange({ ...value, voice_name: r.name }); // 'clone:<id>'
        if (r.quality?.warnings?.length) {
          reportError(new Error(r.quality.warnings.join('；')), '样本质量提示');
        }
      } catch (e) {
        reportError(e as Error, '克隆音色注册失败');
      } finally {
        setCloneBusy(false);
      }
    },
    [onChange, value, qc, cloneEngine],
  );

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // 允许重复选同一文件
    if (f) void registerClone(f, f.name.replace(/\.[^.]+$/, ''));
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        if (blob.size > 0) void registerClone(blob, '录音音色');
      };
      recRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (e) {
      reportError(e as Error, '无法访问麦克风');
    }
  };
  const stopRec = () => { try { recRef.current?.stop(); } catch { /* noop */ } };

  const onDeleteClone = async () => {
    const cur = value.voice_name;
    if (!cur || !cur.startsWith('clone:')) return;
    if (!(await confirmDialog('删除这个克隆音色?不可恢复。', { danger: true }))) return;
    setCloneBusy(true);
    try {
      await videoGeneration.deleteCloneVoice(cur.slice('clone:'.length));
      await qc.invalidateQueries({ queryKey: ['vg.voices', 'clone'] });
      onChange({ ...value, voice_name: '' });
    } catch (e) {
      reportError(e as Error, '删除克隆音色失败');
    } finally {
      setCloneBusy(false);
    }
  };

  const onRenameClone = async () => {
    const cur = value.voice_name;
    if (!cur || !cur.startsWith('clone:')) return;
    const cid = cur.slice('clone:'.length);
    const curLabel = voices.find((v) => v.id === cur)?.label ?? '';
    const name = await promptDialog('重命名克隆音色', { defaultValue: curLabel, title: '重命名' });
    if (!name || !name.trim()) return;
    setCloneBusy(true);
    try {
      await videoGeneration.renameCloneVoice(cid, name.trim());
      await qc.invalidateQueries({ queryKey: ['vg.voices', 'clone'] });
    } catch (e) {
      reportError(e as Error, '重命名失败');
    } finally {
      setCloneBusy(false);
    }
  };

  return (
    <>
      {/* 后端引擎 chip 行(hideProviderChips 时由外部下拉接管,隐藏避免双重控件) */}
      {!hideProviderChips && (
        <>
          <span className="opacity-60">后端</span>
          <div className="flex items-center gap-0.5">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onChange({ voice_provider: p.id, voice_name: '' })}
                aria-pressed={value.voice_provider === p.id}
                className={cn(chipCls(value.voice_provider === p.id), 'gap-1')}
              >
                {p.offline ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
                {p.label}
              </button>
            ))}
          </div>
          <span className="mx-1 opacity-30">·</span>
        </>
      )}

      {/* 音色 select — 限宽 ~5 字,鼠标悬停 title 显示全名 */}
      <span className="opacity-60">音色</span>
      <select
        value={value.voice_name || voices[0]?.id || ''}
        onChange={(e) => void onSelectVoice(e.target.value)}
        disabled={voices.length === 0 || dlState === 'downloading'}
        title={voices.find((v) => v.id === (value.voice_name || voices[0]?.id))?.label ?? '音色'}
        className={cn(
          'h-6 w-[10em] rounded-md border border-[var(--cy-border-subtle)]',
          'bg-[var(--cy-surface-1)] pl-1.5 pr-5 text-[10px] text-[var(--cy-text-primary)]',
          'focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none',
        )}
      >
        {voices.length === 0 && (
          <option value="">
            {voicesQ.isLoading ? '加载中…'
              : value.voice_provider === 'sherpa' ? '(无 sherpa 模型,去模型广场下载)'
              : value.voice_provider === 'edge' ? '(空 — 请重启后端)'
              : value.voice_provider === 'clone' ? '(还没有克隆音色,点上传/录音)'
              : '(无可用音色)'}
          </option>
        )}
        {voices.map((v) => (
          <option key={v.id} value={v.id} title={v.label}>
            {v.label}
          </option>
        ))}
      </select>

      {/* 克隆:上传样本 / 浏览器录音 / 删除当前 */}
      {isClone && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={onPickFile}
          />
          <button
            type="button"
            onClick={() => setCloneEngine((e) => (e === 'cosyvoice' ? 'voxcpm' : 'cosyvoice'))}
            disabled={cloneBusy}
            title={cloneEngine === 'cosyvoice' ? '高质量 CosyVoice2(需 CosyVoice 运行时)' : '默认 VoxCPM 引擎'}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] disabled:opacity-50',
              cloneEngine === 'cosyvoice'
                ? 'border border-[var(--cy-brand-400)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                : 'border border-[var(--cy-border-subtle)] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]',
            )}
          >
            {cloneEngine === 'cosyvoice' ? '高质量' : '标准'}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={cloneBusy}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] px-1.5 text-[10px] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50"
          >
            <Upload className="h-3 w-3" /> 上传
          </button>
          <button
            type="button"
            onClick={() => (recording ? stopRec() : void startRec())}
            disabled={cloneBusy}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] disabled:opacity-50',
              recording
                ? 'bg-rose-500 text-white hover:bg-rose-600'
                : 'border border-[var(--cy-border-subtle)] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]',
            )}
          >
            {recording ? <Square className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
            {recording ? '停止' : '录音'}
          </button>
          {value.voice_name.startsWith('clone:') && (
            <>
              <button
                type="button"
                onClick={() => void onRenameClone()}
                disabled={cloneBusy}
                title="重命名当前克隆音色"
                className="inline-flex h-6 items-center rounded-md px-1 text-[10px] text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => void onDeleteClone()}
                disabled={cloneBusy}
                title="删除当前克隆音色"
                className="inline-flex h-6 items-center rounded-md px-1 text-[10px] text-rose-600 hover:bg-rose-50 disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </>
          )}
          {cloneBusy && <Loader2 className="h-3 w-3 animate-spin text-[var(--cy-brand-600)]" />}
        </>
      )}
      {noMatch && (
        <span className="text-[10px] text-amber-600" title="当前后端无该语言音色">
          无该语言音色,已列全部(可换 edge)
        </span>
      )}
      {dlState === 'downloading' && (
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--cy-brand-600)]">
          <Loader2 className="h-3 w-3 animate-spin" /> 下载音色中…
        </span>
      )}
      {dlState === 'failed' && (
        <span className="text-[10px] text-rose-600" title="下载失败,可换 edge 或检查网络">
          下载失败(可换 edge)
        </span>
      )}

      {/* 试听 */}
      <button
        type="button"
        onClick={onPreview}
        disabled={previewing}
        title="试听"
        aria-label="试听"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-50"
      >
        {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
      </button>
    </>
  );
};
