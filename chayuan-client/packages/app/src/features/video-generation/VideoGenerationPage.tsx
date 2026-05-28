/**
 * 视频生成 Wizard 容器 — 顶部进度条 + 中间 step 区 + 底部上下一步。
 *
 * Step 列表来自 vgComposer.VG_WIZARD_STEPS。各 step 组件按 step 编号
 * 直接映射;切换 step 不丢字段(状态全在 vgComposer store 里)。
 *
 * M5.A3 阶段是骨架:TopicStep / ScriptStep 已有真正字段绑定;
 * Step 3-7 是 Placeholder,B 系列接入。
 */
import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Library, Video } from 'lucide-react';
import { useTabsStore } from '../../store/tabs';
import { useVgComposer, VG_WIZARD_STEPS, type VgWizardStep } from './store/vgComposer';
import { TopicStep } from './steps/TopicStep';
import { ScriptStep } from './steps/ScriptStep';
import { VoiceStep } from './steps/VoiceStep';
import { SubtitleStep } from './steps/SubtitleStep';
import { MaterialsStep } from './steps/MaterialsStep';
import { BgmOutputStep } from './steps/BgmOutputStep';
import { RenderStep } from './steps/RenderStep';

const STEP_COMPONENTS: Record<VgWizardStep, React.FC> = {
  1: TopicStep,
  2: ScriptStep,
  3: VoiceStep,
  4: SubtitleStep,
  5: MaterialsStep,
  6: BgmOutputStep,
  7: RenderStep,
};

export const VideoGenerationPage: React.FC = () => {
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.open);
  const step = useVgComposer((s) => s.step);
  const setStep = useVgComposer((s) => s.setStep);
  const next = useVgComposer((s) => s.next);
  const prev = useVgComposer((s) => s.prev);

  const StepComp = STEP_COMPONENTS[step];

  const onOpenMaterials = () => {
    openTab('/video-generation/materials', { title: '素材库', icon: 'library' });
    void navigate({ to: '/video-generation/materials' as never });
  };
  const onOpenLibrary = () => {
    openTab('/video-generation/library', { title: '我的视频', icon: 'video' });
    void navigate({ to: '/video-generation/library' as never });
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 px-6 py-8">
      {/* 顶部:标题 + 跳到素材库 / 我的视频 快捷入口 */}
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--cy-text-primary)]">视频生成</h1>
          <p className="mt-1 text-sm text-[var(--cy-text-tertiary)]">
            主题 → LLM 文案 → TTS → 字幕 → 素材 → 合成,7 步走完一支短视频
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onOpenMaterials}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-xs text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)] transition-colors"
          >
            <Library className="h-3.5 w-3.5" />
            素材库
          </button>
          <button
            type="button"
            onClick={onOpenLibrary}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-1.5 text-xs text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)] transition-colors"
          >
            <Video className="h-3.5 w-3.5" />
            我的视频
          </button>
        </div>
      </header>

      {/* 进度条 — 7 step 链 */}
      <nav aria-label="wizard 进度" className="overflow-x-auto">
        <ol className="flex min-w-max items-center gap-1.5 text-xs">
          {VG_WIZARD_STEPS.map((s, i) => {
            const active = step === s.step;
            const done = step > s.step;
            return (
              <li key={s.step} className="flex items-center">
                <button
                  type="button"
                  onClick={() => setStep(s.step)}
                  className={
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors ' +
                    (active
                      ? 'bg-[var(--cy-brand-500)] text-white font-medium'
                      : done
                        ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)] hover:bg-[var(--cy-brand-100)]'
                        : 'bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] border border-[var(--cy-border-subtle)]')
                  }
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/30 text-[10px]">
                    {s.step}
                  </span>
                  {s.label}
                </button>
                {i < VG_WIZARD_STEPS.length - 1 && (
                  <span className="px-1 text-[var(--cy-text-tertiary)]">→</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Step 内容区 */}
      <section className="min-h-[20rem]">
        <StepComp />
      </section>

      {/* 底部上一步 / 下一步 */}
      <footer className="mt-auto flex justify-between border-t border-[var(--cy-border-subtle)] pt-4">
        <button
          type="button"
          onClick={prev}
          disabled={step <= 1}
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-4 py-2 text-sm text-[var(--cy-text-secondary)] transition-colors hover:border-[var(--cy-border-strong)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
          上一步
        </button>
        <button
          type="button"
          onClick={next}
          disabled={step >= 7}
          className="inline-flex items-center gap-1 rounded-lg bg-[var(--cy-brand-500)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--cy-brand-600)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          下一步
          <ChevronRight className="h-4 w-4" />
        </button>
      </footer>
    </div>
  );
};
