/**
 * Step 2 · 脚本(三模式 chip 切换)。
 *
 * 模式:
 *   - ai      LLM 流式生成 + 可编辑
 *   - manual  用户手写 / 粘贴纯文本
 *   - srt     用户粘贴 SRT/VTT(后端解析 + 校验)
 *
 * 本组件 M5.A3 阶段是 placeholder:三 chip + 各模式 textarea 占位。
 * LLM 流式生成 / SRT 解析校验 等留 M5.B1 接入。
 */
import * as React from 'react';
import type { VgScriptSource } from '@chayuan/api';
import { useVgComposer } from '../store/vgComposer';

const TABS: Array<{ id: VgScriptSource; label: string; hint: string }> = [
  { id: 'ai', label: 'AI 生成', hint: '主题 → LLM 生成文案,可编辑' },
  { id: 'manual', label: '我自己写', hint: '粘贴纯文本,TTS 自然朗读' },
  { id: 'srt', label: '粘贴字幕', hint: 'SRT/VTT,字幕时间已固化' },
];

export const ScriptStep: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const slots = useVgComposer((s) => s.scriptSlots);
  const setScriptSource = useVgComposer((s) => s.setScriptSource);
  const setScriptSlot = useVgComposer((s) => s.setScriptSlot);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => setScriptSource(t.id)}
            className={
              'rounded-full border px-3 py-1.5 text-xs transition-colors ' +
              (params.script_source === t.id
                ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')
            }
          >
            {t.label}
          </button>
        ))}
        <span className="text-xs text-[var(--cy-text-tertiary)] self-center">
          {TABS.find((t) => t.id === params.script_source)?.hint}
        </span>
      </div>

      {params.script_source === 'ai' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-[var(--cy-text-tertiary)]">
            <span>主题:{params.video_subject || '(未填,请回 step 1 填写)'}</span>
            <button
              type="button"
              disabled
              className="ml-auto rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs opacity-60"
              title="M5.B1 接入 LLM 流式生成"
            >
              生成脚本 (placeholder)
            </button>
          </div>
          <textarea
            className="h-64 w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]"
            placeholder="LLM 生成的文案会流式落在这里,可手动编辑"
            value={slots.ai}
            onChange={(e) => setScriptSlot('ai', e.target.value)}
          />
        </div>
      )}

      {params.script_source === 'manual' && (
        <textarea
          className="h-64 w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]"
          placeholder="在这里粘贴或手写视频文案 — TTS 会按自然节奏朗读"
          value={slots.manual}
          onChange={(e) => setScriptSlot('manual', e.target.value)}
        />
      )}

      {params.script_source === 'srt' && (
        <div className="space-y-2">
          <textarea
            className="h-64 w-full rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-3 py-2 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--cy-brand-500)]"
            placeholder={'1\n00:00:00,000 --> 00:00:03,500\n春天的花海如诗如画\n\n2\n00:00:03,500 --> 00:00:07,000\n万物复苏的季节'}
            value={slots.srt}
            onChange={(e) => setScriptSlot('srt', e.target.value)}
          />
          <p className="text-xs text-[var(--cy-text-tertiary)]">
            支持 SRT / VTT,字符编码 UTF-8。解析校验留 M5.B1。
          </p>
        </div>
      )}
    </div>
  );
};
