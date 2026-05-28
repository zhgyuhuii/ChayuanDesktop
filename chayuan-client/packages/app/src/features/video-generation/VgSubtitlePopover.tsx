/**
 * Toolbar Aa 字幕 chip — 弹 popover 配置全局默认字幕样式。
 *
 * 写 vgComposer.params 的字幕样式字段(subtitle_enabled / subtitle_position /
 * font_name / font_size / text_fore_color / stroke_color / stroke_width /
 * text_background_color)。
 *
 * 字幕 cue 列表(SRT 文本+时间戳)是另一回事 — 在消息块 ✎ 字幕图标
 * 弹 SubtitleEditorDialog 编辑。
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Type } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@chayuan/ui';
import { videoGeneration, type VgFontItem, type VgSubtitlePosition } from '@chayuan/api';
import { useVgComposer } from './store/vgComposer';

export const VgSubtitlePopover: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const fontsQ = useQuery({
    queryKey: ['vg.fonts'],
    queryFn: () => videoGeneration.listFonts(),
    staleTime: 5 * 60 * 1000,
  });
  const fonts: VgFontItem[] = fontsQ.data?.items ?? [];

  const bgValue =
    typeof params.text_background_color === 'string'
      ? 'custom'
      : params.text_background_color
      ? 'on'
      : 'off';

  const posLabel =
    params.subtitle_position === 'bottom' ? '底部'
    : params.subtitle_position === 'top'  ? '顶部'
    : params.subtitle_position === 'center' ? '居中'
    : '自定义';
  const summary = params.subtitle_enabled
    ? `${params.font_name} · ${params.font_size} · ${posLabel}`
    : '关闭';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-xs hover:border-[var(--cy-border-strong)]"
          title="全局字幕样式默认"
        >
          <Type className="h-3 w-3 text-[var(--cy-brand-500)]" />
          <span className="max-w-[14rem] truncate">{summary}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[360px] p-3 text-xs">
        <label className="mb-2 flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={params.subtitle_enabled}
            onChange={(e) => patch({ subtitle_enabled: e.target.checked })}
          />
          启用字幕
        </label>
        {params.subtitle_enabled && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="mb-0.5 text-[var(--cy-text-tertiary)]">位置</p>
                <select
                  value={params.subtitle_position}
                  onChange={(e) =>
                    patch({
                      subtitle_position: e.target.value as VgSubtitlePosition,
                    })
                  }
                  className="w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1"
                >
                  <option value="top">顶部</option>
                  <option value="center">居中</option>
                  <option value="bottom">底部</option>
                  <option value="custom">自定义</option>
                </select>
              </div>
              <div>
                <p className="mb-0.5 text-[var(--cy-text-tertiary)]">字体</p>
                <select
                  value={params.font_name}
                  onChange={(e) => patch({ font_name: e.target.value })}
                  className="w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1"
                >
                  {fonts.length === 0 && (
                    <option value={params.font_name}>{params.font_name}</option>
                  )}
                  {fonts.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="mb-0.5 text-[var(--cy-text-tertiary)]">字号</p>
                <input
                  type="number"
                  min={20} max={200}
                  value={params.font_size}
                  onChange={(e) => patch({ font_size: parseInt(e.target.value, 10) || 60 })}
                  className="w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1"
                />
              </div>
              <div>
                <p className="mb-0.5 text-[var(--cy-text-tertiary)]">描边粗细</p>
                <input
                  type="number"
                  min={0} max={10} step={0.5}
                  value={params.stroke_width}
                  onChange={(e) => patch({ stroke_width: parseFloat(e.target.value) || 1.5 })}
                  className="w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className="mb-0.5 text-[var(--cy-text-tertiary)]">前景</p>
                <input
                  type="color"
                  value={params.text_fore_color}
                  onChange={(e) => patch({ text_fore_color: e.target.value })}
                  className="h-6 w-full rounded border border-[var(--cy-border-subtle)]"
                />
              </div>
              <div>
                <p className="mb-0.5 text-[var(--cy-text-tertiary)]">描边</p>
                <input
                  type="color"
                  value={params.stroke_color}
                  onChange={(e) => patch({ stroke_color: e.target.value })}
                  className="h-6 w-full rounded border border-[var(--cy-border-subtle)]"
                />
              </div>
              <div>
                <p className="mb-0.5 text-[var(--cy-text-tertiary)]">背景</p>
                <select
                  value={bgValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'on') patch({ text_background_color: true });
                    else if (v === 'off') patch({ text_background_color: false });
                  }}
                  className="w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1 py-0.5"
                >
                  <option value="on">黑底</option>
                  <option value="off">无</option>
                </select>
              </div>
            </div>
          </div>
        )}
        <p className="mt-2 text-[10px] text-[var(--cy-text-tertiary)]">
          这是全局默认。每条任务的 SRT cue 列表(文字+时间戳)在消息块字幕图标 - SubtitleEditorDialog 编辑。
        </p>
      </PopoverContent>
    </Popover>
  );
};
