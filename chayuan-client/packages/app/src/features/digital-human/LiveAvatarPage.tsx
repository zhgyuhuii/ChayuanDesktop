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
import { Send, Bot } from 'lucide-react';

import { digitalHuman, type DigitalHumanPreset } from '@chayuan/api';
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

// 独立 composer store，与全局 chat store 完全隔离
const dhComposerStore = createComposerStore('live-avatar');

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
        window.console.warn('实时数字人运行时未启动');
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
  const send = React.useCallback(async () => {
    const q = input.trim();
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
      const modelField = model
        ? platformName
          ? `${platformName}::${model}`
          : model
        : undefined;

      const req: ChatRequestV2 = {
        query: q,
        // 有选知识库时走 'kb' 模式，否则纯 LLM
        mode: kuIds.length > 0 ? 'kb' : 'llm',
        ...(modelField ? { model: modelField } : {}),
        ...(kuIds.length > 0 ? { ku_ids: kuIds } : {}),
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
  }, [input, busy, liveVideo, model, platformName, kuIds, persona, tts]);

  // 回答增长时滚到底
  React.useEffect(() => {
    if (answerRef.current) {
      answerRef.current.scrollTop = answerRef.current.scrollHeight;
    }
  }, [answer]);

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

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--cy-surface-base)',
        color: 'var(--cy-text-primary)',
        overflow: 'hidden',
      }}
    >
      {/* ── 配置栏 ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          borderBottom: '1px solid var(--cy-border-subtle)',
          background: 'var(--cy-surface-1)',
          flexWrap: 'wrap',
        }}
      >
        {/* 数字人预设选择 */}
        <select
          value={presetId}
          onChange={(e) => setPresetId(e.target.value)}
          style={{
            height: '32px',
            padding: '0 8px',
            borderRadius: '8px',
            border: '1px solid var(--cy-border-subtle)',
            background: 'var(--cy-surface-base)',
            color: 'var(--cy-text-primary)',
            fontSize: '13px',
            outline: 'none',
          }}
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

        {/* 模型选择（受控 props，不写全局 composer store）*/}
        <ModelPicker
          value={{ modelId: model, platformName }}
          onChange={handleModelChange}
        />

        {/* 知识库选择（通过 ComposerStoreContext 读写 dhComposerStore）*/}
        <KnowledgePickerPill side="bottom" align="start" />

        {/* 人设 prompt */}
        <input
          type="text"
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          placeholder="人设 prompt（可选）"
          style={{
            flex: 1,
            minWidth: '120px',
            height: '32px',
            padding: '0 10px',
            borderRadius: '8px',
            border: '1px solid var(--cy-border-subtle)',
            background: 'var(--cy-surface-base)',
            color: 'var(--cy-text-primary)',
            fontSize: '13px',
            outline: 'none',
          }}
          aria-label="人设 prompt"
        />

        {/* 实时口型开关 */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '13px',
            color: 'var(--cy-text-secondary)',
            cursor: 'pointer',
            userSelect: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <input
            type="checkbox"
            checked={liveVideo}
            onChange={(e) => setLiveVideo(e.target.checked)}
            style={{ accentColor: 'var(--cy-ink-600)', width: '14px', height: '14px' }}
          />
          实时口型
        </label>
      </div>

      {/* ── 主体（形象 + 回答）────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* 形象区 */}
        <div
          style={{
            flex: '0 0 auto',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '16px',
            background: 'var(--cy-surface-2)',
            minHeight: '200px',
          }}
        >
          {/* 实时口型模式：显示 WebRTC 视频流 */}
          {liveVideo ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={{
                maxHeight: '240px',
                maxWidth: '100%',
                borderRadius: '12px',
                objectFit: 'contain',
                boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                background: '#000',
              }}
            />
          ) : preset ? (
            preset.avatar_kind === 'image' ? (
              <img
                src={avatarUrl}
                alt={preset.name}
                style={{
                  maxHeight: '240px',
                  maxWidth: '100%',
                  borderRadius: '12px',
                  objectFit: 'contain',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                }}
              />
            ) : (
              <video
                src={avatarUrl}
                muted
                loop
                autoPlay
                playsInline
                style={{
                  maxHeight: '240px',
                  maxWidth: '100%',
                  borderRadius: '12px',
                  objectFit: 'contain',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                }}
              />
            )
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                color: 'var(--cy-text-tertiary)',
              }}
            >
              <Bot style={{ width: '48px', height: '48px', opacity: 0.4 }} />
              <span style={{ fontSize: '13px' }}>
                {presetsQ.isLoading ? '正在加载数字人...' : '暂无数字人预设'}
              </span>
            </div>
          )}
        </div>

        {/* 流式回答区 */}
        <div
          ref={answerRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            fontSize: '14px',
            lineHeight: '1.7',
            color: 'var(--cy-text-primary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {answer || (
            <span style={{ color: 'var(--cy-text-tertiary)', fontSize: '13px' }}>
              {busy ? '正在思考...' : '向数字人提问，回答将在此显示'}
            </span>
          )}
        </div>
      </div>

      {/* ── 输入区 ──────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '8px',
          padding: '10px 12px',
          borderTop: '1px solid var(--cy-border-subtle)',
          background: 'var(--cy-surface-1)',
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入问题，Enter 发送 / Shift+Enter 换行"
          disabled={busy}
          rows={2}
          style={{
            flex: 1,
            resize: 'none',
            padding: '8px 12px',
            borderRadius: '10px',
            border: '1px solid var(--cy-border-subtle)',
            background: 'var(--cy-surface-base)',
            color: 'var(--cy-text-primary)',
            fontSize: '14px',
            outline: 'none',
            lineHeight: '1.5',
            fontFamily: 'inherit',
          }}
          aria-label="输入问题"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          title="发送（Enter）"
          aria-label="发送"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            border: 'none',
            background:
              busy || !input.trim()
                ? 'var(--cy-surface-3)'
                : 'var(--cy-ink-600)',
            color:
              busy || !input.trim()
                ? 'var(--cy-text-tertiary)'
                : '#fff',
            cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
            flexShrink: 0,
          }}
        >
          <Send style={{ width: '18px', height: '18px' }} />
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
