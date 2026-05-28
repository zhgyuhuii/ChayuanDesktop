/**
 * 对话式视频生成主入口(N4 — 真路径骨架版)。
 *
 * 交互:
 *   1. 顶部消息列表:user "主题 + 附件" / assistant "脚本流式(M2 同步实现)+
 *      TTS 卡 + 字幕图标 + 去生成按钮"
 *   2. 底部 composer:textarea 输入主题 + 高级参数 popover(语言/段落/画幅)
 *      + 自动模式 toggle(默认关)+ 发送按钮
 *   3. 发送 → 调 vgGenerateScript → assistant message 替 loading;脚本成
 *      功后渲染 TTS / 字幕 / 去生成三联组件
 *   4. "去生成"按钮:走 submitTask → 跳"我的视频"看进度
 *
 * 复用现状:
 *   - 视觉对齐 ChatComposer + MessageBubble,但不直接 import(它们绑全局
 *     composer store + 完整 chat 协议,N4 简化版用本地 state)
 *   - VoiceStep 整块作 TTS 卡(已就绪复用,wizard 阶段写的)
 *   - vgComposer.params 持视频特有参数(语言/段落/画幅/voice/...)
 *   - SubtitleEditor / MaterialsDrawer 留 N5 接入(图标已露出但目前 alert
 *     占位)
 *
 * 全自动模式:开 → 提交时直接调 submitTask 走 ai script_source 一键
 * 跑完。关 → 当前流程(脚本预览 → 用户确认 → 去生成)。
 */

import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Send, Loader2, Sparkles, MessagesSquare, Layers, Library, Video,
  Edit3, Settings2, Zap,
} from 'lucide-react';
import { videoGeneration } from '@chayuan/api';
import { useTabsStore } from '../../store/tabs';
import { useVgComposer } from './store/vgComposer';
import { VoiceStep } from './steps/VoiceStep';
import { reportError, notifySuccess } from '../../store/errorDialog';

// 消息类型(本地 — 跟 chat 协议解耦)
type Msg =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; state: 'loading' | 'script' | 'error';
      text: string; error?: string };

function newId(): string {
  return `m${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const VgChatPage: React.FC = () => {
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.open);
  const params = useVgComposer((s) => s.params);
  const patchParams = useVgComposer((s) => s.patchParams);
  const setScriptSlot = useVgComposer((s) => s.setScriptSlot);

  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [autoMode, setAutoMode] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // 新消息后滚到底
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const goBatch = () => {
    openTab('/video-generation/batch', { title: '批量生成', icon: 'layers' });
    void navigate({ to: '/video-generation/batch' as never });
  };
  const goMaterials = () => {
    openTab('/video-generation/materials', { title: '素材库', icon: 'library' });
    void navigate({ to: '/video-generation/materials' as never });
  };
  const goLibrary = () => {
    openTab('/video-generation/library', { title: '我的视频', icon: 'video' });
    void navigate({ to: '/video-generation/library' as never });
  };

  const onSend = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setDraft('');
    const userMsg: Msg = { id: newId(), role: 'user', text };
    const asstId = newId();
    const loadingMsg: Msg = { id: asstId, role: 'assistant', state: 'loading', text: '' };
    setMessages((ms) => [...ms, userMsg, loadingMsg]);

    // 把主题写回 store(其它步骤会用)
    patchParams({ video_subject: text });

    if (autoMode) {
      // 全自动:直接提交 task,不预览脚本
      try {
        const t = await videoGeneration.submitTask(
          { ...params, video_subject: text, script_source: 'ai' },
          { stop_at: 'video' },
        );
        notifySuccess('已提交任务,跳转"我的视频"看进度');
        // 把 user 消息替换成成功提示
        setMessages((ms) => ms.map((m) => m.id === asstId ? {
          id: asstId, role: 'assistant', state: 'script',
          text: `任务已提交(task_id=${t.task_id})— "我的视频"页可查实时进度`,
        } : m));
        setTimeout(goLibrary, 800);
      } catch (e) {
        setMessages((ms) => ms.map((m) => m.id === asstId ? {
          id: asstId, role: 'assistant', state: 'error',
          text: '', error: (e as Error).message || '提交失败',
        } : m));
        reportError(e as Error);
      } finally {
        setSending(false);
      }
      return;
    }

    // 手动:先调脚本生成,user 确认后才提交 task
    try {
      const r = await videoGeneration.generateScript({
        video_subject: text,
        video_language: params.video_language,
        paragraph_number: params.paragraph_number,
      });
      const script = r.video_script || '';
      setScriptSlot('ai', script);
      patchParams({ video_script: script, script_source: 'ai' });
      setMessages((ms) => ms.map((m) => m.id === asstId ? {
        id: asstId, role: 'assistant', state: 'script', text: script,
      } : m));
    } catch (e) {
      setMessages((ms) => ms.map((m) => m.id === asstId ? {
        id: asstId, role: 'assistant', state: 'error',
        text: '', error: (e as Error).message || '生成脚本失败',
      } : m));
    } finally {
      setSending(false);
    }
  };

  const onGoGenerate = async (script: string) => {
    // 用当前 params + 用户编辑后 script 提交 task
    setSending(true);
    try {
      const t = await videoGeneration.submitTask(
        { ...params, video_script: script, script_source: 'manual' },
        { stop_at: 'video' },
      );
      notifySuccess(`任务已提交 ${t.task_id.slice(0, 8)}…`);
      setMessages((ms) => [
        ...ms,
        { id: newId(), role: 'assistant', state: 'script',
          text: `任务已提交。前往"我的视频"看进度。` },
      ]);
      setTimeout(goLibrary, 800);
    } catch (e) {
      reportError(e as Error, '提交任务失败');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-6 py-4">
      {/* 顶部导航条 */}
      <header className="flex items-center justify-between border-b border-[var(--cy-border-subtle)] pb-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-base font-semibold text-[var(--cy-text-primary)]">
            <MessagesSquare className="h-4 w-4" /> 视频生成 · 对话模式
          </h1>
          <p className="mt-0.5 text-xs text-[var(--cy-text-tertiary)]">
            输入主题 → LLM 生成脚本 → 选语音/字幕/素材 → 一键合成
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <button type="button" onClick={goBatch}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2.5 py-1 text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]">
            <Layers className="h-3 w-3" /> 批量
          </button>
          <button type="button" onClick={goMaterials}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2.5 py-1 text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]">
            <Library className="h-3 w-3" /> 素材
          </button>
          <button type="button" onClick={goLibrary}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2.5 py-1 text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]">
            <Video className="h-3 w-3" /> 我的视频
          </button>
        </div>
      </header>

      {/* 消息列表 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto cy-hide-scrollbar py-4"
      >
        {messages.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-8 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-[var(--cy-text-tertiary)]" />
            <p className="mt-3 text-sm text-[var(--cy-text-secondary)]">
              输入视频主题开始 — 一句话即可,LLM 会生成可编辑的脚本
            </p>
            <p className="mt-1 text-xs text-[var(--cy-text-tertiary)]">
              想批量跑多个主题?切到「批量」标签
            </p>
          </div>
        )}

        <div className="space-y-4">
          {messages.map((m) => (
            <MessageBlock
              key={m.id}
              msg={m}
              onScriptChange={(text) => {
                setMessages((ms) => ms.map((x) => x.id === m.id
                  ? (x.role === 'assistant' ? { ...x, text } : x)
                  : x));
                setScriptSlot('ai', text);
                patchParams({ video_script: text });
              }}
              onGoGenerate={onGoGenerate}
            />
          ))}
        </div>
      </div>

      {/* 底部 composer */}
      <footer className="border-t border-[var(--cy-border-subtle)] pt-3">
        {advancedOpen && (
          <div className="mb-2 grid grid-cols-2 gap-2 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-3 text-xs sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-[var(--cy-text-tertiary)]">语言</span>
              <select
                value={params.video_language}
                onChange={(e) => patchParams({ video_language: e.target.value })}
                className="rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1"
              >
                <option value="">自动判断</option>
                <option value="zh-CN">中文</option>
                <option value="en-US">英文</option>
                <option value="ja-JP">日文</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[var(--cy-text-tertiary)]">段落数</span>
              <input
                type="number" min={1} max={10}
                value={params.paragraph_number}
                onChange={(e) => patchParams({ paragraph_number: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)) })}
                className="rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[var(--cy-text-tertiary)]">画幅</span>
              <select
                value={params.video_aspect}
                onChange={(e) => patchParams({ video_aspect: e.target.value as '16:9' | '9:16' | '1:1' })}
                className="rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1"
              >
                <option value="9:16">9:16 竖屏</option>
                <option value="16:9">16:9 横屏</option>
                <option value="1:1">1:1 方形</option>
              </select>
            </label>
          </div>
        )}

        <div className="relative">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void onSend();
              }
            }}
            placeholder={autoMode
              ? "[全自动] 输入主题,LLM 一气呵成跑到视频..."
              : "输入视频主题:春天的花海 / 5 分钟读懂区块链"}
            disabled={sending}
            rows={2}
            className="w-full resize-none rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-4 py-3 pr-14 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)] disabled:opacity-60"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={sending || !draft.trim()}
            title="发送(Enter)"
            className="absolute bottom-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--cy-brand-500)] text-white shadow transition-colors hover:bg-[var(--cy-brand-600)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]"
          >
            <Settings2 className="h-3 w-3" /> 高级
          </button>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={autoMode}
              onChange={(e) => setAutoMode(e.target.checked)}
              className="accent-[var(--cy-brand-500)]"
            />
            <Zap className={'h-3 w-3 ' + (autoMode ? 'text-amber-500' : 'text-[var(--cy-text-tertiary)]')} />
            <span className="text-[var(--cy-text-secondary)]">全自动(跳过预览,直接跑完)</span>
          </label>
          <span className="ml-auto text-[var(--cy-text-tertiary)]">
            Enter 发送 · Shift+Enter 换行
          </span>
        </div>
      </footer>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// 单条消息块
// ─────────────────────────────────────────────────────────────────────

const MessageBlock: React.FC<{
  msg: Msg;
  onScriptChange: (text: string) => void;
  onGoGenerate: (script: string) => void;
}> = ({ msg, onScriptChange, onGoGenerate }) => {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-[var(--cy-brand-500)] px-4 py-2.5 text-sm text-white shadow">
          {msg.text}
        </div>
      </div>
    );
  }
  // assistant
  if (msg.state === 'loading') {
    return (
      <div className="flex">
        <div className="max-w-[80%] rounded-2xl bg-[var(--cy-surface-1)] px-4 py-3 text-sm text-[var(--cy-text-secondary)]">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在生成脚本…
          </span>
        </div>
      </div>
    );
  }
  if (msg.state === 'error') {
    return (
      <div className="flex">
        <div className="max-w-[80%] rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          脚本生成失败:{msg.error}
        </div>
      </div>
    );
  }
  // state === 'script'
  return (
    <div className="flex">
      <div className="w-full max-w-[90%] space-y-3 rounded-2xl bg-[var(--cy-surface-1)] p-4 ring-1 ring-[var(--cy-border-subtle)]">
        {/* 脚本编辑区 + 右上角字幕图标 */}
        <div className="relative">
          <textarea
            value={msg.text}
            onChange={(e) => onScriptChange(e.target.value)}
            className="w-full resize-y rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 pr-10 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]"
            rows={Math.min(8, Math.max(3, Math.ceil(msg.text.length / 50)))}
          />
          <button
            type="button"
            title="编辑字幕(N5 接入 Artifact 面板)"
            onClick={() => alert('字幕编辑 Artifact 留 N5 实现')}
            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-secondary)]"
          >
            <Edit3 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* TTS 卡(复用 VoiceStep 整块,自带 provider/voice/rate/试听)*/}
        <details className="rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--cy-text-primary)]">
            语音选择(展开调整 + 试听)
          </summary>
          <div className="mt-3">
            <VoiceStep />
          </div>
        </details>

        {/* 去生成按钮 */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onGoGenerate(msg.text)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-4 py-2 text-sm font-medium text-white shadow transition-transform hover:-translate-y-0.5"
          >
            <Sparkles className="h-4 w-4" /> 去生成视频
          </button>
        </div>
      </div>
    </div>
  );
};
