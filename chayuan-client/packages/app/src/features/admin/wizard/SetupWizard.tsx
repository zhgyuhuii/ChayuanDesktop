/**
 * SetupWizard —— 首启配置向导外壳(D3)。
 * 仅是「步骤外壳」:进度 + 上一步/下一步/跳过/完成,逐步直接挂载现有配置页组件
 * (DB / Redis / 对象存储 / 向量库 / 模型厂商接入 / 默认模型)。
 * 每个被复用的组件自带保存按钮并自行加载/保存当前值——向导不拦截、不触发任何保存,
 * 「上一步/下一步」只做导航。
 *
 * 自动弹出/AdminPage/菜单接线在后续任务(D4)完成,本组件只提供外壳与编排。
 */
import * as React from 'react';
import { wizard } from '@chayuan/api';
import { Button, cn } from '@chayuan/ui';
import { X, ChevronLeft, ChevronRight, Check, SkipForward, FastForward } from 'lucide-react';
import { notifySuccess, reportError } from '../../../store/errorDialog';
import { WIZARD_STEPS } from './steps';

export interface SetupWizardProps {
  onClose: () => void;
  onFinish: () => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ onClose, onFinish }) => {
  const [idx, setIdx] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  // 记录访问过的步骤(仅用于轻量提示,不阻塞任何导航/完成)。
  const [visited, setVisited] = React.useState<Set<number>>(() => new Set([0]));

  const total = WIZARD_STEPS.length;
  // idx 始终经 goto 钳制在有效范围内;兜底取首个步骤满足类型收窄。
  const step = WIZARD_STEPS[idx] ?? WIZARD_STEPS[0]!;
  const isFirst = idx === 0;
  const isLast = idx === total - 1;

  const goto = React.useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(total - 1, next));
    setIdx(clamped);
    setVisited((prev) => {
      if (prev.has(clamped)) return prev;
      const n = new Set(prev);
      n.add(clamped);
      return n;
    });
  }, [total]);

  // 完成路径:写向导状态 → onFinish。失败也不困住用户,仍 onFinish。
  const finish = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await wizard.setCompleted(true);
      notifySuccess('配置向导已完成');
    } catch (e) {
      reportError(e, '保存向导状态失败');
    } finally {
      setBusy(false);
      onFinish();
    }
  }, [busy, onFinish]);

  const prev = () => goto(idx - 1);
  const next = () => goto(idx + 1);
  const skipStep = () => {
    // 每个步骤(含必填)都允许跳过:最后一步跳过等于完成。
    if (isLast) void finish();
    else next();
  };

  // 未访问的必填步骤(轻量提示用,不阻断完成)。
  const pendingRequired = WIZARD_STEPS.filter((s, i) => s.required && !visited.has(i));

  const StepComp = step.Comp;

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-primary)] shadow-xl">
        {/* 头部:标题 + 进度指示 + 关闭 */}
        <div className="border-b border-[var(--cy-border-subtle)] px-5 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">配置向导</h2>
              <p className="mt-0.5 text-xs opacity-60">
                第 {idx + 1} / {total} 步 · {step.title}
                {step.hint ? <span className="ml-2 opacity-70">{step.hint}</span> : null}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              title="关闭"
              className="rounded-md p-1.5 opacity-50 transition-colors hover:bg-[var(--cy-surface-2)] hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* 步骤 pills:完成 / 当前 / 未到,并标注必填 / 可选 */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {WIZARD_STEPS.map((s, i) => {
              const current = i === idx;
              const done = i < idx;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => goto(i)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                    current
                      ? 'bg-[var(--cy-brand-500)]/15 text-[var(--cy-brand-600)] ring-1 ring-[var(--cy-brand-400)]'
                      : done
                        ? 'bg-emerald-500/12 text-emerald-600'
                        : 'bg-[var(--cy-surface-1)] opacity-60 hover:opacity-100',
                  )}
                >
                  {done && <Check className="h-3 w-3" />}
                  <span>{i + 1}. {s.title}</span>
                  <span className="opacity-60">{s.required ? '· 必填' : '· 可选'}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 主体:直接渲染被复用的配置页组件,可滚动(配置页较高) */}
        <div className="min-h-0 flex-1 overflow-auto bg-[var(--cy-surface-base)]">
          <StepComp />
        </div>

        {/* 底部:导航控制 + 轻量必填提示 */}
        <div className="border-t border-[var(--cy-border-subtle)] px-5 py-3">
          {pendingRequired.length > 0 && (
            <div className="mb-2 text-[11px] opacity-55">
              尚未访问的必填项:{pendingRequired.map((s) => s.title).join('、')}(可随时跳过,不强制)。
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={prev} disabled={isFirst || busy}>
              <ChevronLeft className="mr-1 h-4 w-4" /> 上一步
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => void finish()} disabled={busy}>
                <FastForward className="mr-1 h-4 w-4" /> 跳过全部并完成
              </Button>
              <Button variant="outline" size="sm" onClick={skipStep} disabled={busy}>
                <SkipForward className="mr-1 h-4 w-4" /> 跳过此步
              </Button>
              {isLast ? (
                <Button size="sm" onClick={() => void finish()} disabled={busy}>
                  <Check className="mr-1 h-4 w-4" /> 完成
                </Button>
              ) : (
                <Button size="sm" onClick={next} disabled={busy}>
                  下一步 <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
