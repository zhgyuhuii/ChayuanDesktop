/**
 * Step 1 · 选题。
 *
 * 输入视频主题(一句话)、语言、段落数、画幅(16:9/9:16/1:1)。
 * AI 模式下"主题"必填,manual / srt 模式下可空白(直接进 step 2 粘文案/SRT)。
 *
 * 本组件 M5.A3 阶段是 placeholder:
 *   - 字段已绑定 vgComposer.params,切回来不丢内容
 *   - 操作流程跑通,但视觉细节(画幅 chip 视觉化 / 字符计数)留 M5.B1
 */
import * as React from 'react';
import { useVgComposer } from '../store/vgComposer';

export const TopicStep: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patchParams = useVgComposer((s) => s.patchParams);

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-[var(--cy-text-primary)]">
          视频主题
          <span className="ml-1 text-[var(--cy-text-tertiary)] text-xs">(AI 模式必填)</span>
        </label>
        <input
          type="text"
          className="w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]"
          placeholder="例:春天的花海 / 5 分钟读懂区块链"
          value={params.video_subject}
          onChange={(e) => patchParams({ video_subject: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--cy-text-primary)]">
            语言
          </label>
          <select
            className="w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]"
            value={params.video_language}
            onChange={(e) => patchParams({ video_language: e.target.value })}
          >
            <option value="">自动判断</option>
            <option value="zh-CN">中文</option>
            <option value="en-US">英文</option>
            <option value="ja-JP">日文</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--cy-text-primary)]">
            段落数
          </label>
          <input
            type="number"
            min={1}
            max={10}
            className="w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]"
            value={params.paragraph_number}
            onChange={(e) => patchParams({ paragraph_number: Math.max(1, Math.min(10, parseInt(e.target.value || '1', 10))) })}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--cy-text-primary)]">
            画幅
          </label>
          <div className="flex gap-1.5">
            {(['16:9', '9:16', '1:1'] as const).map((a) => (
              <button
                type="button"
                key={a}
                onClick={() => patchParams({ video_aspect: a })}
                className={
                  'flex-1 rounded-lg border px-2 py-1.5 text-xs transition-colors ' +
                  (params.video_aspect === a
                    ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                    : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')
                }
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
