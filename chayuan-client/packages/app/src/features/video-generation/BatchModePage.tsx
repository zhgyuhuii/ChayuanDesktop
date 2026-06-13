/**
 * 批量任务页 — 由 wizard 改造,服务"多主题 + 统一参数 + 一键并发跑"场景。
 *
 * 设计:
 *   - 顶部:主题列表(可加/删行,每行一个 video_subject)
 *   - 中部:统一参数(画幅 / TTS / 字幕样式 / BGM / 渲染数量),沿用 wizard
 *          step 6 BgmOutputStep 风格但合并展示
 *   - 底部:"全部并发提交"按钮,后端 /tasks/batch 一次性接收
 *
 * 提交后跳"我的视频"页查进度(每个 task 独立 SSE 进度条)。
 *
 * vgComposer.params 服务参数共享部分;批量场景 script_source 强制 'ai',
 * srt/manual 模式仅单任务才有意义。
 */

import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, Trash2, Layers, Sparkles, Loader2, MessagesSquare, Library, Video, ChevronDown,
} from 'lucide-react';
import { videoGeneration, models, type RawModelItem } from '@chayuan/api';
import { useTabsStore } from '../../store/tabs';
import { useVgComposer } from './store/vgComposer';
import { BgmOutputStep } from './steps/BgmOutputStep';
import { VoiceStep } from './steps/VoiceStep';
import { TopicStep } from './steps/TopicStep';
import { reportError, notifySuccess } from '../../store/errorDialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@chayuan/ui';
import { ModelMenuList, displayLabel } from '../composer/ModelMenuList';
import { CHAT_CAPABILITIES } from '../composer/modelCapabilityChip';
import { useResolveLogo } from '../catalog/useLogos';

/** 脚本模型存为 `platform_name::id`(无 platform 退化裸 id),与后端路由一致。 */
function encodeModel(m: RawModelItem): string {
  return m.platform_name ? `${m.platform_name}::${m.id}` : m.id;
}
function decodeModel(v: string | null): { platform?: string; id: string } {
  if (!v) return { id: '' };
  const i = v.indexOf('::');
  return i >= 0 ? { platform: v.slice(0, i), id: v.slice(i + 2) } : { id: v };
}

export const BatchModePage: React.FC = () => {
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.open);
  const params = useVgComposer((s) => s.params);
  const patchParams = useVgComposer((s) => s.patchParams);

  // 脚本模型列表(/v1/models 的 llm 类)。批量必须显式带 model,否则后端
  // generate_script 回落到未配的 chat 默认(glm4-chat)→ 脚本生成失败。
  const modelsQ = useQuery({ queryKey: ['v1.models'], queryFn: () => models.list(), staleTime: 5 * 60 * 1000 });
  const llmModels: RawModelItem[] = (modelsQ.data ?? []).filter((m) => !m.model_type || m.model_type === 'llm');
  // 脚本模型选择器(复用对话框那套 ModelMenuList:分组折叠 + 厂商图标)
  const [pickOpen, setPickOpen] = React.useState(false);
  const resolveLogo = useResolveLogo();
  const curM = decodeModel(params.model ?? null);
  const currentM = llmModels.find((m) => m.id === curM.id && (curM.platform ? m.platform_name === curM.platform : true));
  const currentModelLabel = currentM ? displayLabel(currentM) : (curM.id || (modelsQ.isLoading ? '加载中…' : '默认模型'));
  const currentModelLogo = resolveLogo(currentM?.platform_name ?? undefined, currentM?.id);
  React.useEffect(() => {
    if (!params.model && llmModels.length > 0) {
      const m = llmModels[0]!;
      patchParams({ model: m.platform_name ? `${m.platform_name}::${m.id}` : m.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llmModels.length]);

  // 多主题列表(本页独有状态;不进 vgComposer.persist 避免下次顶着上次主题)
  const [subjects, setSubjects] = React.useState<string[]>(['']);
  const [submitting, setSubmitting] = React.useState(false);

  const addRow = () => setSubjects((s) => [...s, '']);
  const removeRow = (i: number) =>
    setSubjects((s) => (s.length <= 1 ? [''] : s.filter((_, idx) => idx !== i)));
  const updateRow = (i: number, v: string) =>
    setSubjects((s) => s.map((t, idx) => (idx === i ? v : t)));

  const validSubjects = subjects.map((s) => s.trim()).filter(Boolean);

  const onSubmit = async () => {
    if (validSubjects.length === 0) {
      reportError(new Error('至少填一个主题'));
      return;
    }
    setSubmitting(true);
    try {
      const r = await videoGeneration.submitBatch({
        subjects: validSubjects,
        shared_params: params,
      });
      notifySuccess(
        `已提交 ${r.submitted} 个任务${r.skipped ? `,跳过 ${r.skipped} 个空主题` : ''}`,
        '前往"我的视频"查看进度',
      );
      // 跳"我的视频"看 N 个 task 进度
      openTab('/video-generation/library', { title: '我的视频', icon: 'video' });
      void navigate({ to: '/video-generation/library' as never });
    } catch (e) {
      reportError(e as Error, '批量提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const goChat = () => {
    openTab('/video-generation', { title: '视频生成', icon: 'video' });
    void navigate({ to: '/video-generation' as never });
  };
  const goMaterials = () => {
    openTab('/video-generation/materials', { title: '素材库', icon: 'library' });
    void navigate({ to: '/video-generation/materials' as never });
  };
  const goLibrary = () => {
    openTab('/video-generation/library', { title: '我的视频', icon: 'video' });
    void navigate({ to: '/video-generation/library' as never });
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto cy-hide-scrollbar px-6 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-xl font-semibold text-[var(--cy-text-primary)]">
            <Layers className="h-5 w-5" /> 批量生成
          </h1>
          <p className="mt-1 text-sm text-[var(--cy-text-tertiary)]">
            一次输入 N 个主题 + 一套统一参数,后端并发跑;script 走 AI 全自动
            (后端 worker 池默认 4 并发,可调)
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button type="button" onClick={goChat}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]">
            <MessagesSquare className="h-3.5 w-3.5" /> 对话模式
          </button>
          <button type="button" onClick={goMaterials}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]">
            <Library className="h-3.5 w-3.5" /> 素材库
          </button>
          <button type="button" onClick={goLibrary}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]">
            <Video className="h-3.5 w-3.5" /> 我的视频
          </button>
        </div>
      </header>

      {/* 1. 主题列表 */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--cy-text-primary)]">
            主题列表 <span className="ml-1 text-xs font-normal text-[var(--cy-text-tertiary)]">
              ({validSubjects.length} 条有效 / 共 {subjects.length} 行)
            </span>
          </h2>
          <button type="button" onClick={addRow}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]">
            <Plus className="h-3 w-3" /> 加一行
          </button>
        </div>
        <ul className="space-y-1.5">
          {subjects.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-6 text-xs text-[var(--cy-text-tertiary)] text-right">{i + 1}.</span>
              <input
                type="text"
                value={s}
                onChange={(e) => updateRow(i, e.target.value)}
                placeholder={`主题 ${i + 1}:例如 春天的花海 / 5 分钟读懂区块链`}
                className="flex-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                title="删除"
                className="inline-flex h-7 w-7 items-center justify-center rounded text-rose-500 hover:bg-rose-50 disabled:opacity-40"
                disabled={subjects.length <= 1 && !s}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* 2. 统一参数:脚本模型 + 语言 / 段落 / 画幅 */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">
          统一参数 — 脚本模型 / 语言 / 段落 / 画幅
        </h2>
        <div className="rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-4 space-y-3">
          {/* 脚本模型 — 必须选,否则后端回落到未配的默认模型(glm4-chat)导致脚本生成失败 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--cy-text-tertiary)]">脚本模型</span>
            <DropdownMenu open={pickOpen} onOpenChange={setPickOpen}>
              <DropdownMenuTrigger asChild>
                <button type="button"
                  className="inline-flex h-8 min-w-[16em] items-center gap-1.5 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-xs text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]"
                  title={currentM?.id || currentModelLabel}>
                  {currentModelLogo
                    ? <img src={currentModelLogo} alt="" className="h-4 w-4 shrink-0 rounded-sm object-contain" />
                    : <span className="h-4 w-4 shrink-0 rounded-sm bg-[var(--cy-surface-2)]" />}
                  <span className="max-w-[200px] truncate">{currentModelLabel}</span>
                  <ChevronDown className="ml-auto h-3 w-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={6} collisionPadding={12} className="z-[260] w-80 overflow-hidden p-0">
                <ModelMenuList
                  models={llmModels}
                  currentId={curM.id}
                  currentPlatform={curM.platform}
                  allowCapabilities={CHAT_CAPABILITIES}
                  resolveLogo={resolveLogo}
                  emptyLabel={modelsQ.isLoading ? '加载中…' : '无可用模型'}
                  onPick={(m) => { if (m.available === false) return; patchParams({ model: encodeModel(m) }); setPickOpen(false); }}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <TopicStep hideSubject />
        </div>
      </section>

      {/* 3. 统一语音 */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">
          统一参数 — 语音
        </h2>
        <div className="rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-4">
          <VoiceStep />
        </div>
      </section>

      {/* 4. 统一字幕/配乐/输出(复用 BgmOutputStep 整块) */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">
          统一参数 — 字幕 + 配乐 + 输出
        </h2>
        <div className="rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-4">
          <BgmOutputStep />
        </div>
      </section>

      {/* 5. 提交 */}
      <footer className="sticky bottom-0 -mx-6 mt-4 border-t border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]/95 px-6 py-3 backdrop-blur">
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || validSubjects.length === 0}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-6 py-3 text-base font-medium text-white shadow transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" /> 提交中…
            </>
          ) : (
            <>
              <Sparkles className="h-5 w-5" />
              批量提交 {validSubjects.length} 个任务 · 一键跑到底
            </>
          )}
        </button>
        <p className="mt-2 text-center text-[10px] text-[var(--cy-text-tertiary)]">
          ✨ 全自动模式:LLM 生成各主题脚本 → TTS 合成 → 自动选素材 → moviepy 合成
        </p>
      </footer>
    </div>
  );
};
