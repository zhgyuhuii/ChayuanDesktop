/**
 * 全局应用底部状态栏。
 *
 * 视觉:
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ 北京智灵鸟科技中心出品 · aidooo.com   ●对话 ●嵌入 ●重排 ●ASR ●图 ●OCR │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * - 左:版权 + 主站链接
 * - 右:6 个本地能力运行状态点 + 中文 label
 *     · chat / embedding / rerank / asr / image-embedding — 来自 useLocalRuntimeStore.statuses
 *     · OCR — chayuan-server 进程内 onnxruntime,后端 reachable 即视为 OK
 *
 * 颜色规则:
 *   🟢 emerald  state=ready (运行中)
 *   🟡 amber    state=starting/stopping (过渡中)
 *   🔴 rose     state=failed 或 !reachable (异常)
 *   ⚫ neutral  state=stopped/null (未启动)
 */

import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { cn } from '@chayuan/ui';
import type { LocalRuntimeCapability, LocalRuntimeStatus, RuntimeOcrHealth } from '@chayuan/api';
import { runtimeOcr } from '@chayuan/api';
import { useLocalRuntimeStore } from '../../store/localRuntime';

interface CapabilityIndicator {
  key: LocalRuntimeCapability | 'ocr';
  label: string;
}

const INDICATORS: CapabilityIndicator[] = [
  { key: 'chat',             label: '对话' },
  { key: 'embedding',        label: '文本嵌入' },
  { key: 'rerank',           label: '重排' },
  { key: 'asr',              label: '语音识别' },
  { key: 'image-embedding',  label: '图像嵌入' },
  { key: 'ocr',              label: 'OCR' },
];

type Tone = 'ready' | 'pending' | 'failed' | 'idle';

const TONE_DOT: Record<Tone, string> = {
  ready:   'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.55)]',
  pending: 'bg-amber-400  shadow-[0_0_4px_rgba(245,158,11,0.55)] animate-pulse',
  failed:  'bg-rose-500   shadow-[0_0_4px_rgba(244,63,94,0.55)]',
  idle:    'bg-zinc-400/60',
};

const TONE_LABEL: Record<Tone, string> = {
  ready:   'text-emerald-700 dark:text-emerald-300',
  pending: 'text-amber-700  dark:text-amber-300',
  failed:  'text-rose-700   dark:text-rose-300',
  idle:    'text-[var(--cy-text-tertiary)]',
};

const TONE_HINT: Record<Tone, string> = {
  ready:   '运行中',
  pending: '启停中…',
  failed:  '异常',
  idle:    '未启动',
};

function toneOf(state: LocalRuntimeStatus['state'] | null | undefined): Tone {
  switch (state) {
    case 'ready':      return 'ready';
    case 'starting':
    case 'restarting': return 'pending';
    case 'failed':     return 'failed';
    case 'stopped':
    default:           return 'idle';
  }
}

export const AppFooter: React.FC = () => {
  const statuses = useLocalRuntimeStore((s) => s.statuses);
  const reachable = useLocalRuntimeStore((s) => s.reachable);
  const navigate = useNavigate();

  // OCR 健康检查:走 /runtime/ocr/health 真实探测(rapidocr pkg + ONNX 模型齐全)。
  // 30s 拉一次,后端 reachable 翻 false 时不重试避免狂打 404。
  const [ocrHealth, setOcrHealth] = React.useState<RuntimeOcrHealth | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      if (!reachable) {
        if (!cancelled) setOcrHealth(null);
        return;
      }
      try {
        const h = await runtimeOcr.health();
        if (!cancelled) setOcrHealth(h);
      } catch {
        if (!cancelled) setOcrHealth({ state: 'failed', reason: 'OCR health endpoint 不可达' });
      }
    };
    void pull();
    const t = window.setInterval(pull, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [reachable]);

  const ocrTone: Tone =
    !reachable ? 'failed'
    : ocrHealth?.state === 'ready' ? 'ready'
    : ocrHealth?.state === 'failed' ? 'failed'
    : 'idle';

  const onClickIndicator = (cap: LocalRuntimeCapability | 'ocr') => {
    // 跳到设置页的「本地模型服务」section,带 hash 锚到具体 capability row。
    // SettingsAsPage 会在 mount 时读 location.hash 并 scroll 到 #local-runtime-<cap>。
    void navigate({ to: '/settings', hash: `local-runtime-${cap}` });
  };

  return (
    <footer
      data-shell="footer"
      className={cn(
        'flex h-7 min-h-7 items-center justify-between gap-4 border-t px-3',
        'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]',
        'text-[11px] text-[var(--cy-text-tertiary)] select-none',
      )}
    >
      {/* 左:版权 + 主站 */}
      <div className="flex min-w-0 items-center gap-1.5 truncate">
        <span>北京智灵鸟科技中心 出品</span>
        <span aria-hidden="true" className="text-[var(--cy-text-tertiary)] opacity-60">·</span>
        <a
          href="https://aidooo.com"
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'inline-flex items-center gap-0.5 font-medium',
            'text-[var(--cy-text-secondary)] hover:text-[var(--cy-text-primary)]',
            'transition-colors underline-offset-2 hover:underline',
          )}
        >
          aidooo.com
        </a>
      </div>

      {/* 右:6 个 capability 状态点 */}
      <div className="flex shrink-0 items-center gap-3">
        {INDICATORS.map((ind) => {
          const tone =
            ind.key === 'ocr'
              ? ocrTone
              : toneOf(statuses[ind.key]?.state);

          const status =
            ind.key === 'ocr'
              ? (reachable ? { endpoint: '内嵌 (chayuan-server)' } : null)
              : statuses[ind.key];

          // 鼠标悬停 title:状态 + endpoint/model_id + 「点击跳设置」提示
          const titleParts: string[] = [`${ind.label}: ${TONE_HINT[tone]}`];
          if (status && 'endpoint' in status && status.endpoint) {
            titleParts.push(String(status.endpoint));
          }
          if (ind.key !== 'ocr' && statuses[ind.key]?.model_id) {
            titleParts.push(`模型: ${statuses[ind.key]?.model_id}`);
          }
          if (ind.key === 'ocr' && ocrHealth?.reason) {
            titleParts.push(ocrHealth.reason);
          }
          titleParts.push('点击 → 设置页本地模型服务');
          const title = titleParts.join('\n');

          return (
            <button
              type="button"
              key={ind.key}
              title={title}
              onClick={() => onClickIndicator(ind.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-1 py-0.5',
                '-mx-1 cursor-pointer transition-colors',
                'hover:bg-[var(--cy-surface-2)] focus-visible:outline-none',
                'focus-visible:ring-1 focus-visible:ring-[var(--cy-border-focus,#0ea5e9)]',
              )}
              aria-label={`${ind.label}: ${TONE_HINT[tone]},点击跳转到设置页本地模型服务`}
            >
              <span
                aria-hidden="true"
                className={cn('h-1.5 w-1.5 rounded-full transition-colors', TONE_DOT[tone])}
              />
              <span className={cn('whitespace-nowrap transition-colors', TONE_LABEL[tone])}>
                {ind.label}
              </span>
            </button>
          );
        })}
      </div>
    </footer>
  );
};

export default AppFooter;
