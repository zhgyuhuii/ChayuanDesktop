/**
 * 实时数字人页（RT-P1）
 *
 * 功能：
 *   - 顶部配置栏：选数字人预设 / 模型 / 知识库 / 人设 prompt
 *   - 形象区：图片或视频静态展示（idle；RT-P2 再加口型驱动）
 *   - 底部：输入 → LLM 流式回答（有 KB 时走 RAG）→ 逐句 TTS 顺序播
 *
 * 真复用清单：
 *   - ModelPicker         value/onChange 受控 props（96 题引入）
 *   - KnowledgePickerPill 直接从 ComposerStoreContext 读写 selectedKuIds；
 *                         本页为此创建独立 dhComposerStore，通过 Provider 注入，
 *                         避免污染全局 chat store
 *   - createChayuanTransport  .chat() 流式接口
 *   - useSentenceTts      feed / flush / reset
 *
 * 人设（persona）的传递方式：
 *   ChatRequestV2 没有专用 system prompt 字段，按现有协议惯例放在
 *   metadata.system（后端 ChatGraph handler 在 build_messages 时取
 *   request_dto.metadata["system"] 注入为 system message，与其它 metadata
 *   透传行为一致）。若后端版本不支持此键，persona 会被静默忽略，不影响基础对话。
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Send, Bot, Mic, Square, ChevronDown, ChevronUp, Settings } from 'lucide-react';

import { digitalHuman, modality, knowledgeUniverse, type DigitalHumanPreset, type KuItem } from '@chayuan/api';
import { uuid } from '@chayuan/platform-shared';
import { createChayuanTransport } from '@chayuan/transport';
import type { ChatRequestV2 } from '@chayuan/transport';

import { ModelPicker } from '../chat/ModelPicker';
import { KnowledgePickerPill } from '../composer/KnowledgePickerPill';
import {
  ComposerStoreContext,
  createComposerStore,
} from '../../store/composer';
import { reportError } from '../../store/errorDialog';
import { useSentenceTts } from './useSentenceTts';
import { useMicSimpleRecorder } from '../composer/useMicSimpleRecorder';
import {
  effectiveModel,
  effectiveKuIds,
  showModelPicker,
  showKbPicker,
} from './usePresetBinding';
import { BindingHint, bindingStateOf, normKuIds } from './dhBinding';

// 独立 composer store，与全局 chat store 完全隔离
const dhComposerStore = createComposerStore('live-avatar');

/** 拆 "provider::id" 为 { platform, id };无 :: 时整串当 id。 */
function decodeModel(v: string): { platform?: string; id: string } {
  const i = v.indexOf('::');
  return i >= 0 ? { platform: v.slice(0, i), id: v.slice(i + 2) } : { id: v };
}

// 模块级 transport 单例（无状态，复用同一连接配置）
const transport = createChayuanTransport();

// ─────────────────────────────────────────────────────────────────────────────
// 内部实现（挂在 Provider 内，可安全读 dhComposerStore via Context）
// ─────────────────────────────────────────────────────────────────────────────

const LiveAvatarInner: React.FC = () => {
  // ── 数字人预设 ──────────────────────────────────────────────────────────
  const presetsQ = useQuery({
    queryKey: ['dh.presets'],
    queryFn: digitalHuman.listPresets,
  });
  const presets: DigitalHumanPreset[] = presetsQ.data?.items ?? [];

  const [presetId, setPresetId] = React.useState<string>('');
  // 预设加载完后默认选第一条
  React.useEffect(() => {
    const first = presets[0];
    if (!presetId && first) {
      setPresetId(first.id);
    }
  }, [presetId, presets]);

  const preset = presets.find((p) => p.id === presetId) ?? presets[0] ?? null;

  // ── 模型（受控，与 dhComposerStore 隔离；ModelPicker 支持 value/onChange）──
  const [model, setModel] = React.useState('');
  const [platformName, setPlatformName] = React.useState<string | undefined>(undefined);
  const handleModelChange = React.useCallback((id: string, pn?: string) => {
    setModel(id);
    setPlatformName(pn);
  }, []);

  // ── KB 选择态（从 dhComposerStore 读；KnowledgePickerPill 通过 Context 写入）──
  const kuIds = dhComposerStore((s) => s.selectedKuIds);

  // ── 绑定来源标签 + 失效检测 ──────────────────────────────────────────────
  const kbsQ = useQuery({ queryKey: ['v1.knowledgeUniverse.list'], queryFn: () => knowledgeUniverse.list(), staleTime: 5 * 60 * 1000 });
  const kbList: KuItem[] = kbsQ.data ?? [];
  const missingKuIds = React.useMemo(() => {
    const bound = preset?.ku_ids ?? [];
    if (!bound.length || kbsQ.isLoading) return [];
    const avail = new Set(kbList.map((k) => k.ku_id));
    return bound.filter((id) => !avail.has(id));
  }, [preset?.ku_ids, kbList, kbsQ.isLoading]);
  const sessionModel = model ? (platformName ? `${platformName}::${model}` : model) : '';
  const modelBindState = bindingStateOf(preset?.model ?? '', sessionModel);
  const kbBindState = bindingStateOf(normKuIds(preset?.ku_ids), normKuIds(kuIds), missingKuIds.length > 0);
  const kbHintLabel = (() => {
    if (!kuIds.length) return '';
    const names = kuIds.map((id) => kbList.find((k) => k.ku_id === id)?.display_name || kbList.find((k) => k.ku_id === id)?.name || id);
    return names.length <= 2 ? names.join('、') : `${names.slice(0, 2).join('、')} 等 ${names.length} 个`;
  })();

  // ── 选/切预设时,用预设绑定预填模型与知识库 ──────────────────────────────
  React.useEffect(() => {
    if (!preset) return;
    if (preset.model) {
      const { id, platform } = decodeModel(preset.model);
      setModel(id);
      setPlatformName(platform);
    }
    dhComposerStore.setState({ selectedKuIds: preset.ku_ids ?? [] });
    // 仅在预设切换时预填,避免覆盖用户手动改动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId]);

  // ── 人设 prompt ──────────────────────────────────────────────────────────
  const [persona, setPersona] = React.useState('');

  // ── 实时口型（WebRTC）────────────────────────────────────────────────────
  const [liveVideo, setLiveVideo] = React.useState(false);
  const pcRef = React.useRef<RTCPeerConnection | null>(null);
  const dcRef = React.useRef<RTCDataChannel | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  const startLive = React.useCallback(async () => {
    try {
      const avail = await digitalHuman.liveAvailable();
      if (!avail.available) {
        // 实时口型需要 GPU 实时数字人 sidecar(realtime/musetalk)在跑;没装/没起时
        // 给明确提示而非静默回弹(用户反馈"勾不上不知为啥")。
        reportError(
          new Error('实时口型运行时未启动:需在「模型广场」安装并启动实时数字人(realtime/musetalk)运行时(需 GPU)。未启用时仍可用「生成视频」做离线口型。'),
          '实时口型不可用',
        );
        setLiveVideo(false);
        return;
      }
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
      dcRef.current = pc.createDataChannel('text');
      pc.ontrack = (e) => {
        if (videoRef.current && e.streams[0]) videoRef.current.srcObject = e.streams[0];
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const ans = await digitalHuman.liveOffer(
        pc.localDescription!.sdp,
        pc.localDescription!.type,
      );
      await pc.setRemoteDescription(ans as RTCSessionDescriptionInit);
    } catch (err) {
      reportError(err as Error, '实时口型连接失败');
      setLiveVideo(false);
    }
  }, []);

  const stopLive = React.useCallback(() => {
    try {
      dcRef.current?.close();
      pcRef.current?.close();
    } catch {
      /* noop */
    }
    pcRef.current = null;
    dcRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  React.useEffect(() => {
    if (liveVideo) {
      void startLive();
    } else {
      stopLive();
    }
    return () => stopLive();
  }, [liveVideo, startLive, stopLive]);

  // ── 对话状态 ─────────────────────────────────────────────────────────────
  const [input, setInput] = React.useState('');
  const [answer, setAnswer] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const answerRef = React.useRef<HTMLDivElement>(null);

  // ── TTS ──────────────────────────────────────────────────────────────────
  const tts = useSentenceTts(
    {
      voice_provider: preset?.voice_provider,
      voice_name: preset?.voice_name,
    },
    true,
  );

  // ── 发送 ──────────────────────────────────────────────────────────────────
  const send = React.useCallback(async (override?: string) => {
    const q = (override ?? input).trim();
    if (!q || busy) return;

    // 实时口型模式：直接把文字推入 data channel，sidecar 驱动口型
    if (liveVideo && dcRef.current?.readyState === 'open') {
      dcRef.current.send(q);
      setInput('');
      return;
    }

    setBusy(true);
    setAnswer('');
    tts.reset();

    let full = '';
    try {
      // 用 platformName::modelId 格式传 model，跟 buildChatRequest 保持一致
      const sessionModel = model
        ? platformName
          ? `${platformName}::${model}`
          : model
        : '';
      // 有效值:预设锁定时强制预设值,否则会话值优先(effective* 解析)
      const modelField = effectiveModel(preset, sessionModel) || undefined;
      const effKuIds = effectiveKuIds(preset, kuIds);

      const req: ChatRequestV2 = {
        query: q,
        // 有选知识库时走 'kb' 模式，否则纯 LLM
        mode: effKuIds.length > 0 ? 'kb' : 'llm',
        ...(modelField ? { model: modelField } : {}),
        ...(effKuIds.length > 0 ? { ku_ids: effKuIds } : {}),
        // 人设通过 metadata.system 传递（后端 ChatGraph 在 build_messages 时注入
        // system message；后端版本不支持时静默忽略，不影响基础对话）
        ...(persona.trim()
          ? { metadata: { system: persona.trim() } }
          : {}),
      };

      for await (const ev of transport.chat(req, { traceId: uuid() })) {
        if (ev.type === 'token' && ev.delta) {
          full += ev.delta;
          setAnswer(full);
          tts.feed(full);
        } else if (ev.type === 'error') {
          reportError(new Error(ev.message), '对话失败');
        }
      }
      tts.flush(full);
      setInput('');
    } catch (e) {
      reportError(e as Error, '对话失败');
    } finally {
      setBusy(false);
    }
  }, [input, busy, liveVideo, model, platformName, kuIds, persona, tts, preset]);

  // 回答增长时滚到底
  React.useEffect(() => {
    if (answerRef.current) {
      answerRef.current.scrollTop = answerRef.current.scrollHeight;
    }
  }, [answer]);

  // ── 语音输入(ASR)──────────────────────────────────────────────────────────
  const [transcribing, setTranscribing] = React.useState(false);
  const mic = useMicSimpleRecorder({
    onRecorded: async (blob) => {
      setTranscribing(true);
      try {
        const res = await modality.transcribe(blob, { language: 'zh' });
        const text = (res?.text ?? '').trim();
        if (text) {
          setInput(text);     // 显示转写内容，用户可见
          void send(text);    // 实时对话=免手发，直接进编排
        }
      } catch (e) {
        reportError(e as Error, '语音转写失败');
      } finally {
        setTranscribing(false);
      }
    },
    onError: (err) => reportError(err, '麦克风不可用'),
  });
  const toggleMic = React.useCallback(() => {
    if (mic.recording) mic.stop();
    else void mic.start();
  }, [mic]);

  // ── 键盘：Enter 发送，Shift+Enter 换行 ────────────────────────────────────
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void send();
      }
    },
    [send],
  );

  const avatarUrl = preset ? digitalHuman.avatarFileUrl(preset.avatar_ref) : '';

  // ── 展示态（纯 UI，不影响任何业务逻辑）──────────────────────────────────
  const [cfgOpen, setCfgOpen] = React.useState(true);
  const [convOpen, setConvOpen] = React.useState(true);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[var(--cy-ink-900,#0b0d12)]">

      {/* ── Stage layer（全屏铺满，在最底层）────────────────────────────── */}
      <div className="absolute inset-0">
        {liveVideo ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-cover"
          />
        ) : preset && preset.avatar_kind === 'image' ? (
          <img
            src={avatarUrl}
            alt={preset.name}
            className="h-full w-full object-cover"
          />
        ) : preset ? (
          <video
            src={avatarUrl}
            muted
            loop
            autoPlay
            playsInline
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[var(--cy-ink-800,#11141c)] to-[var(--cy-ink-900,#0b0d12)] text-white/40">
            <Bot className="h-12 w-12" />
            <span className="text-sm">
              {presetsQ.isLoading ? '正在加载数字人...' : '暂无数字人预设'}
            </span>
          </div>
        )}
        {/* 暗色渐变蒙层，让浮层内容可读 */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/20" />
      </div>

      {/* ── Config overlay（左上角，可折叠）──────────────────────────────── */}
      {cfgOpen ? (
        <div className="absolute left-3 top-3 z-20 w-[300px] max-w-[80%] rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]/95 p-3 shadow-lg backdrop-blur">
          {/* 标题行 */}
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--cy-text-primary)]">
              <Settings className="h-3.5 w-3.5" />
              配置
            </div>
            <button
              type="button"
              onClick={() => setCfgOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]"
              aria-label="收起配置面板"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>

          {/* 配置项垂直堆叠 */}
          <div className="flex flex-col gap-2">
            {/* 数字人预设选择 */}
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              className="h-8 w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-[13px] text-[var(--cy-text-primary)] outline-none"
              aria-label="选择数字人"
            >
              {presets.length === 0 && (
                <option value="">-- 暂无预设 --</option>
              )}
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {/* 模型选择（受控 props，不写全局 composer store）;锁定时隐藏 */}
            {showModelPicker(preset) && (
              <ModelPicker
                value={{ modelId: model, platformName }}
                onChange={handleModelChange}
              />
            )}
            {showModelPicker(preset) && preset?.model ? (
              <BindingHint state={modelBindState} noun="模型" />
            ) : null}

            {/* 知识库选择（通过 ComposerStoreContext 读写 dhComposerStore）;锁定时隐藏 */}
            {showKbPicker(preset) && <KnowledgePickerPill side="bottom" align="start" />}
            {showKbPicker(preset) && (preset?.ku_ids?.length || missingKuIds.length > 0) ? (
              <BindingHint state={kbBindState} label={kbHintLabel} noun="知识库" />
            ) : null}
            {missingKuIds.length > 0 && (
              <span className="text-[11px] text-[var(--cy-danger-500)]">⚠ 绑定的知识库已失效,请重新绑定。</span>
            )}

            {/* 人设 prompt */}
            <input
              type="text"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              placeholder="人设 prompt（可选）"
              className="h-8 w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2.5 text-[13px] text-[var(--cy-text-primary)] outline-none placeholder:text-[var(--cy-text-tertiary)]"
              aria-label="人设 prompt"
            />

            {/* 实时口型开关 */}
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-[13px] text-[var(--cy-text-secondary)]">
              <input
                type="checkbox"
                checked={liveVideo}
                onChange={(e) => setLiveVideo(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--cy-ink-600)]"
              />
              实时口型
            </label>
          </div>
        </div>
      ) : (
        /* 折叠态：左上角胶囊按钮 */
        <button
          type="button"
          onClick={() => setCfgOpen(true)}
          className="absolute left-3 top-3 z-20 flex items-center gap-1 rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[13px] text-white/80 backdrop-blur hover:bg-black/60"
          aria-label="展开配置面板"
        >
          <Settings className="h-3.5 w-3.5" />
          配置
        </button>
      )}

      {/* ── Conversation overlay（右侧，可折叠）──────────────────────────── */}
      {convOpen ? (
        <div className="absolute right-3 top-3 z-20 flex max-h-[55%] w-[340px] max-w-[80%] flex-col rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]/95 shadow-lg backdrop-blur">
          {/* 标题行 */}
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--cy-border-subtle)] px-3 py-2">
            <span className="text-[13px] font-medium text-[var(--cy-text-primary)]">回答</span>
            <button
              type="button"
              onClick={() => setConvOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]"
              aria-label="隐藏回答面板"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>
          {/* 回答滚动区（answerRef 保持在此，保证 auto-scroll 正常）*/}
          <div
            ref={answerRef}
            className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words p-3 text-[14px] leading-7 text-[var(--cy-text-primary)]"
          >
            {answer || (
              <span className="text-[13px] text-[var(--cy-text-tertiary)]">
                {busy ? '正在思考...' : '向数字人提问，回答将在此显示'}
              </span>
            )}
          </div>
        </div>
      ) : (
        /* 折叠态：右下方胶囊按钮（在输入栏上方）*/
        <button
          type="button"
          onClick={() => setConvOpen(true)}
          className="absolute bottom-[80px] right-3 z-20 flex items-center gap-1 rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[13px] text-white/80 backdrop-blur hover:bg-black/60"
          aria-label="显示回答面板"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          显示回答
        </button>
      )}

      {/* ── 底部输入栏（固定在底部，覆盖在舞台上方）──────────────────────── */}
      <div className="relative z-20 mt-auto flex items-end gap-2 border-t border-white/10 bg-black/30 p-2.5 backdrop-blur">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入问题，Enter 发送 / Shift+Enter 换行"
          disabled={busy}
          rows={2}
          className="flex-1 resize-none rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-[14px] text-white outline-none placeholder:text-white/50 disabled:opacity-60"
          aria-label="输入问题"
        />
        {/* 发送按钮 */}
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          title="发送（Enter）"
          aria-label="发送"
          className={[
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-none transition-colors',
            busy || !input.trim()
              ? 'cursor-not-allowed bg-white/10 text-white/40'
              : 'cursor-pointer bg-[var(--cy-ink-600)] text-white hover:opacity-90',
          ].join(' ')}
        >
          <Send className="h-[18px] w-[18px]" />
        </button>
        {/* 麦克风按钮 */}
        <button
          type="button"
          onClick={toggleMic}
          disabled={busy || transcribing}
          title={mic.recording ? '点击停止并转写' : '点击说话'}
          aria-label={mic.recording ? '停止录音' : '开始录音'}
          className={[
            'flex h-10 shrink-0 items-center justify-center gap-1 rounded-lg border-none px-3 text-[13px] whitespace-nowrap transition-colors',
            busy || transcribing
              ? 'cursor-not-allowed bg-white/10 text-white/40'
              : mic.recording
                ? 'cursor-pointer bg-[#ef4444] text-white hover:opacity-90'
                : 'cursor-pointer bg-[var(--cy-ink-600)] text-white hover:opacity-90',
          ].join(' ')}
        >
          {transcribing ? (
            <span>转写中…</span>
          ) : mic.recording ? (
            <>
              <Square className="h-[14px] w-[14px]" />
              <span>{mic.elapsed}s</span>
            </>
          ) : (
            <Mic className="h-[18px] w-[18px]" />
          )}
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// 外层：注入独立 composer store，KnowledgePickerPill 通过 Context 自动拿到
// ─────────────────────────────────────────────────────────────────────────────

export const LiveAvatarPage: React.FC = () => (
  <ComposerStoreContext.Provider value={dhComposerStore}>
    <LiveAvatarInner />
  </ComposerStoreContext.Provider>
);

export default LiveAvatarPage;
