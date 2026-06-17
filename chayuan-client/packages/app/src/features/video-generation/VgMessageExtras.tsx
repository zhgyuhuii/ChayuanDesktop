/**
 * 每条 assistant message 下方聚合渲染 — VgChatPage 通过 ConversationView 的
 * extraSlot 传入。
 *
 * 状态:
 *   - vm.taskId && vm.renderState !== 'idle' → RenderProgressCard(任务已提交)
 *   - 否则 → 单行:[音色 · 语速 · 音量(全局)] [试听] [重新生成] [字幕] [去生成视频]
 *
 * 音色/语速/音量全局统一 —— 直接读写 vgComposer.params(跟工具栏「语音设置」
 * 同一份状态),不再每条消息存独立 tts(原 TtsCard 移除)。音色按 toolbar
 * 选的语言自动筛选;后端 provider(piper/edge/sherpa)在工具栏「语音设置」选,
 * 这里不重复。
 */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit3, Sparkles, RefreshCw, Play, Loader2, Film } from 'lucide-react';
import { videoGeneration, type VgVoiceItem } from '@chayuan/api';
import { VOICE_PREVIEW_FALLBACK } from './voicePreviewText';
import { RenderProgressCard } from './RenderProgressCard';
import { SubtitleEditorDialog } from './SubtitleEditorDialog';
import { MaterialsBgmOutputDialog } from './MaterialsBgmOutputDialog';
import { useVgComposer } from './store/vgComposer';
import { resolveVgChatModel } from './store/vgComposerStore';
import { reportError } from '../../store/errorDialog';
import type { ChatMessage } from '../chat/useChayuanChat';
import { blobToAudioDataUrl } from './blobToDataUrl';

const RATE_OPTIONS = [0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0] as const;
const VOLUME_OPTIONS = [0.8, 1.0, 1.2] as const;

const selectCls =
  'h-7 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5 text-xs text-[var(--cy-text-primary)] focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none';
const btnCls =
  'inline-flex h-7 items-center gap-1 rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-xs text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]';

export interface VgMessageExtrasProps {
  message: ChatMessage;
  /** 父级 (VgChatPage) 提供 — 改 cues 等 patch metadata 到 message */
  onMetaChange: (messageId: string, patch: Record<string, unknown>) => void;
  /** 用户点"去生成"后,VgChatPage 调 submitTask + 把 taskId 写回 metadata.taskId */
  onSubmit: (messageId: string) => Promise<void>;
  /** 重新生成脚本(删最后一条 assistant + 用上条主题重发)。 */
  onRegenerate?: () => void;
  /** 去编辑合成:把本条脚本带进时间轴编辑器(父级 VgChatPage 实现)。 */
  onGoEdit?: (script: string) => void;
}

export const VgMessageExtras: React.FC<VgMessageExtrasProps> = ({
  message, onMetaChange, onSubmit, onRegenerate, onGoEdit,
}) => {
  const vm = message.metadata?.videoMeta;
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const [subtitleOpen, setSubtitleOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const qc = useQueryClient();
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const urlRef = React.useRef<string | null>(null);
  React.useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  // 脚本流式结束后自动生成在线搜索关键词 —— 进「去生成」配置页时即已存在(可再编辑)。
  // 每条消息只触发一次;已有关键词则不覆盖(避免清掉用户手改的)。
  const termsGenRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!message.content || message.streaming) return;
    if (termsGenRef.current === message.id) return;
    termsGenRef.current = message.id;
    const cur = useVgComposer.getState().params.video_terms;
    const hasTerms = Array.isArray(cur) ? cur.length > 0 : !!cur;
    if (hasTerms) return;
    const p = useVgComposer.getState().params;
    const subj = (p.video_subject || message.content.slice(0, 80)).trim();
    void videoGeneration
      .generateTerms({ video_subject: subj, video_script: message.content, model: resolveVgChatModel() || undefined })
      .then((r) => { if (r.video_terms?.length) patch({ video_terms: r.video_terms }); })
      .catch(() => { /* 静默:用户仍可在弹框「自动生成」或手动填 */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id, message.streaming, message.content]);

  // 全局音色:按当前 provider 取列表,按 toolbar 语言筛选(同 VgSpeechSettings 规则)
  const voicesQ = useQuery({
    queryKey: ['vg.voices', params.voice_provider],
    queryFn: () => videoGeneration.listVoices(params.voice_provider),
    staleTime: 5 * 60 * 1000,
  });
  const allVoices: VgVoiceItem[] = voicesQ.data?.items ?? [];
  const lang = params.video_language;
  const fam = lang.split('-')[0];
  const matched = lang
    ? allVoices.filter((v) => v.language === lang || v.language.split('-')[0] === fam || /multilingual/i.test(v.id))
    : allVoices;
  const voices = matched.length > 0 ? matched : allVoices;

  const onPreview = React.useCallback(async () => {
    setPreviewing(true);
    try {
      const r = await videoGeneration.previewAudio({
        video_script: (message.content || VOICE_PREVIEW_FALLBACK).slice(0, 50),
        voice_provider: params.voice_provider,
        voice_name: params.voice_name || undefined,
        voice_rate: params.voice_rate,
        voice_volume: params.voice_volume,
      });
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      // WKWebView 不支持 blob: 作 <audio> 源(NotSupportedError)→ data: URL
      a.src = await blobToAudioDataUrl(r.blob);
      await a.play();
    } catch (e) {
      reportError(e as Error, '试听失败');
    } finally {
      setPreviewing(false);
    }
  }, [message.content, params.voice_provider, params.voice_name, params.voice_rate, params.voice_volume]);

  if (!vm) return null;

  // 已提交 → 进度卡 + 「重新生成视频」(重开配置弹框,改完再提交一次)
  if (vm.taskId && vm.renderState && vm.renderState !== 'idle') {
    return (
      <div className="space-y-2">
        <RenderProgressCard taskId={vm.taskId} />
        <button type="button" onClick={() => setDrawerOpen(true)}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 text-xs font-medium text-white shadow">
          <RefreshCw className="h-3.5 w-3.5" /> 重新生成视频
        </button>
        <MaterialsBgmOutputDialog
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          script={message.content || ''}
          onConfirm={async () => {
            setDrawerOpen(false);
            await onSubmit(message.id);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* 全局音色(按语言筛选) */}
      <select
        value={params.voice_name || voices[0]?.id || ''}
        onChange={(e) => {
          patch({ voice_name: e.target.value });
          void qc.invalidateQueries({ queryKey: ['vg.voices', params.voice_provider] });
        }}
        disabled={voices.length === 0}
        title={voices.find((v) => v.id === (params.voice_name || voices[0]?.id))?.label ?? '音色'}
        className={`${selectCls} w-[10em]`}
      >
        {voices.length === 0 && <option value="">(无音色)</option>}
        {voices.map((v) => <option key={v.id} value={v.id} title={v.label}>{v.label}</option>)}
      </select>
      {/* 语速 */}
      <select value={params.voice_rate}
        onChange={(e) => patch({ voice_rate: parseFloat(e.target.value) })}
        className={`${selectCls} w-[5em]`} title="语速">
        {RATE_OPTIONS.map((v) => <option key={v} value={v}>{v.toFixed(2).replace(/\.?0+$/, '')}×</option>)}
      </select>
      {/* 音量 */}
      <select value={params.voice_volume}
        onChange={(e) => patch({ voice_volume: parseFloat(e.target.value) })}
        className={`${selectCls} w-[5em]`} title="音量">
        {VOLUME_OPTIONS.map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
      </select>

      {/* 试听 */}
      <button type="button" onClick={() => void onPreview()} disabled={previewing} className={btnCls}>
        {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} 试听
      </button>
      {/* 重新生成 */}
      {onRegenerate && (
        <button type="button" onClick={onRegenerate} title="重新生成脚本" className={btnCls}>
          <RefreshCw className="h-3 w-3" /> 重新生成
        </button>
      )}
      {/* 字幕 */}
      <button type="button" onClick={() => setSubtitleOpen(true)} title="编辑字幕" className={btnCls}>
        <Edit3 className="h-3 w-3" /> 字幕
      </button>
      {/* 自动生成视频(全自动 submitTask) */}
      <button type="button" onClick={() => setDrawerOpen(true)}
        className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 text-xs font-medium text-white shadow">
        <Sparkles className="h-3.5 w-3.5" /> 自动生成视频
      </button>
      {/* 去编辑合成(进时间轴手动编辑) */}
      {onGoEdit && (
        <button type="button" onClick={() => onGoEdit(message.content || '')}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--cy-border-strong)] bg-[var(--cy-surface-base)] px-3 text-xs font-medium text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]">
          <Film className="h-3.5 w-3.5" /> 去编辑合成
        </button>
      )}

      {/* 弹窗 */}
      <SubtitleEditorDialog
        open={subtitleOpen}
        onOpenChange={setSubtitleOpen}
        script={message.content || ''}
        cues={vm.scriptCues ?? null}
        onCuesChange={(next) => onMetaChange(message.id, { scriptCues: next })}
      />
      <MaterialsBgmOutputDialog
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        script={message.content || ''}
        onConfirm={async () => {
          setDrawerOpen(false);
          await onSubmit(message.id);
        }}
      />
    </div>
  );
};
