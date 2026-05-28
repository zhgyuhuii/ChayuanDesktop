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
  Edit3, Settings2, Zap, Link2, Paperclip, X, FileText, Image as ImageIcon,
} from 'lucide-react';
import { videoGeneration, type VgMaterialInfo } from '@chayuan/api';
import { useTabsStore } from '../../store/tabs';
import { useVgComposer } from './store/vgComposer';
import { VoiceStep } from './steps/VoiceStep';
import { SubtitleEditorDialog } from './SubtitleEditorDialog';
import { MaterialsDrawer } from './MaterialsDrawer';
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
  // N5:字幕编辑器 / 素材抽屉的开关
  const [subtitleOpen, setSubtitleOpen] = React.useState(false);
  const [materialsOpen, setMaterialsOpen] = React.useState(false);
  // 暂存"去生成"按钮触发的脚本,等用户在 MaterialsDrawer 确认后才真提交
  const pendingScriptRef = React.useRef<string>('');
  const scrollRef = React.useRef<HTMLDivElement>(null);
  // N6:附件预览(用户拖/选的文件,上传到 vg_materials 后显示在 composer 顶部)
  const [pendingAttachments, setPendingAttachments] = React.useState<Array<{
    id: string; name: string; size: number; kind: 'image' | 'video' | 'other';
    material_id?: string;  // 上传完成后写
    uploading?: boolean;
  }>>([]);
  // N6:URL 输入弹出 popover
  const [urlOpen, setUrlOpen] = React.useState(false);
  const [urlDraft, setUrlDraft] = React.useState('');
  const [urlLoading, setUrlLoading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

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

  // N6.b 上传附件 → vg_materials,material_id 进 pendingAttachments
  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const f of Array.from(files)) {
      const localId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const kind: 'image' | 'video' | 'other' =
        f.type.startsWith('image/') ? 'image'
        : f.type.startsWith('video/') ? 'video'
        : 'other';
      setPendingAttachments((a) => [
        ...a, { id: localId, name: f.name, size: f.size, kind, uploading: true },
      ]);
      try {
        const m = await videoGeneration.uploadMaterial({ file: f });
        // 同时把素材塞进 vgComposer.params.video_materials,提交任务时一并带上
        const existing = useVgComposer.getState().params.video_materials ?? [];
        const item: VgMaterialInfo = {
          provider: m.source, url: m.path, duration: Math.round(m.duration_ms / 1000),
        };
        patchParams({ video_materials: [...existing, item] });
        setPendingAttachments((a) =>
          a.map((x) => x.id === localId
            ? { ...x, material_id: m.material_id, uploading: false }
            : x));
      } catch (e) {
        setPendingAttachments((a) => a.filter((x) => x.id !== localId));
        reportError(e as Error, '附件上传失败');
      }
    }
  };

  const removeAttachment = (id: string) => {
    const a = pendingAttachments.find((x) => x.id === id);
    setPendingAttachments((arr) => arr.filter((x) => x.id !== id));
    // 同时把 video_materials 中对应 path 移除
    if (a?.material_id) {
      const existing = useVgComposer.getState().params.video_materials ?? [];
      patchParams({
        video_materials: existing.filter((m) => !m.url.endsWith(a.name)),
      });
    }
  };

  // N6.a 抽 URL 内容当主题素材(append 到 draft)
  const onExtractUrl = async () => {
    const u = urlDraft.trim();
    if (!u) return;
    setUrlLoading(true);
    try {
      const r = await videoGeneration.extractUrl(u);
      const snippet = r.text.slice(0, 600);
      setDraft((d) => (d
        ? `${d}\n\n[来自 ${u}]\n${snippet}${r.truncated ? '\n…(已截)' : ''}`
        : `[来自 ${u}]\n${snippet}${r.truncated ? '\n…(已截)' : ''}`));
      notifySuccess(`已抽取 URL 内容 (${r.content_type}, ${r.text.length} 字)`);
      setUrlOpen(false);
      setUrlDraft('');
    } catch (e) {
      reportError(e as Error, 'URL 抽取失败');
    } finally {
      setUrlLoading(false);
    }
  };

  const onSend = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setDraft('');
    // 附件描述加到 user message(可选展示)
    const attachSummary = pendingAttachments.length > 0
      ? ` · 附 ${pendingAttachments.length} 个素材`
      : '';
    const userMsg: Msg = { id: newId(), role: 'user', text: text + attachSummary };
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

  /** 点"去生成":先弹素材抽屉让用户挑(或跳过自动选),用户确认后再 submitTask */
  const onGoGenerate = (script: string) => {
    pendingScriptRef.current = script;
    setMaterialsOpen(true);
  };

  /** MaterialsDrawer 用户点"确认"回调:用 vgComposer.params(含用户选的
   *  video_materials)+ pending script 提交任务 */
  const onMaterialsConfirmed = async () => {
    const script = pendingScriptRef.current;
    pendingScriptRef.current = '';
    if (!script) return;
    setSending(true);
    try {
      const t = await videoGeneration.submitTask(
        { ...useVgComposer.getState().params,
          video_script: script,
          script_source: 'manual' },
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
              onEditSubtitle={() => setSubtitleOpen(true)}
            />
          ))}
        </div>
      </div>

      {/* N5:字幕编辑器 + 素材抽屉 */}
      <SubtitleEditorDialog open={subtitleOpen} onOpenChange={setSubtitleOpen} />
      <MaterialsDrawer
        open={materialsOpen}
        onOpenChange={setMaterialsOpen}
        onConfirm={onMaterialsConfirmed}
      />

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

        {/* N6.b 附件预览 chip 行 */}
        {pendingAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pendingAttachments.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 py-1 text-xs text-[var(--cy-text-secondary)]"
              >
                {a.kind === 'image' ? <ImageIcon className="h-3 w-3" />
                  : a.kind === 'video' ? <Video className="h-3 w-3" />
                  : <FileText className="h-3 w-3" />}
                <span className="max-w-[12rem] truncate" title={a.name}>{a.name}</span>
                {a.uploading && <Loader2 className="h-3 w-3 animate-spin text-[var(--cy-text-tertiary)]" />}
                <button type="button" onClick={() => removeAttachment(a.id)}
                  className="text-[var(--cy-text-tertiary)] hover:text-rose-500">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div
          className="relative"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onPickFiles(e.dataTransfer.files);
          }}
        >
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
              : "输入视频主题 / 拖文件入对话(自动入素材库)/ 点 🔗 粘 URL 解析"}
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

        {/* N6.a URL 输入 popover */}
        {urlOpen && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 py-1.5">
            <Link2 className="h-3.5 w-3.5 text-[var(--cy-text-tertiary)]" />
            <input
              type="url"
              autoFocus
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void onExtractUrl(); }}
              placeholder="https://example.com/article 或 article.pdf"
              disabled={urlLoading}
              className="flex-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--cy-brand-500)] disabled:opacity-60"
            />
            <button
              type="button"
              onClick={onExtractUrl}
              disabled={urlLoading || !urlDraft.trim()}
              className="inline-flex items-center gap-1 rounded bg-[var(--cy-brand-500)] px-2 py-1 text-[10px] font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50"
            >
              {urlLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : '抽取'}
            </button>
            <button type="button" onClick={() => setUrlOpen(false)}
              className="text-[var(--cy-text-tertiary)] hover:text-[var(--cy-text-secondary)]">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,application/pdf,text/*"
          multiple
          className="hidden"
          onChange={(e) => void onPickFiles(e.target.files)}
        />

        <div className="mt-2 flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="上传附件 — 自动入素材库"
            className="inline-flex items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]"
          >
            <Paperclip className="h-3 w-3" /> 附件
          </button>
          <button
            type="button"
            onClick={() => setUrlOpen((v) => !v)}
            title="粘 URL 解析 — text/HTML/PDF 抽内容当主题素材"
            className={
              'inline-flex items-center gap-1 rounded-md border px-2 py-1 ' +
              (urlOpen
                ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')
            }
          >
            <Link2 className="h-3 w-3" /> URL
          </button>
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
  onEditSubtitle: () => void;
}> = ({ msg, onScriptChange, onGoGenerate, onEditSubtitle }) => {
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
            title="编辑字幕 — 行级表格 + 拖时间 + 拆/合"
            onClick={onEditSubtitle}
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
