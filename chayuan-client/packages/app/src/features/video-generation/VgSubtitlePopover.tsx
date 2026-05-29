/**
 * 字幕设置 — 内联参数条(对齐 TtsVoiceParamBar 视觉)。由 VgComposerToolbar
 * 在"字幕设置"chip 展开时内联渲染。
 *
 * 写 vgComposer.params 字幕样式字段。字幕 cue 列表(SRT 文本+时间戳)是另一回事
 * —— 在消息块字幕图标 → SubtitleEditorDialog 编辑。
 *
 * 导出 VgSubtitleSettings(原 VgSubtitlePopover 改名;弹窗 → 内联)。
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@chayuan/ui';
import { videoGeneration, type VgFontItem, type VgSubtitlePosition } from '@chayuan/api';
import { useVgComposer } from './store/vgComposer';

const POSITIONS: Array<{ v: VgSubtitlePosition; label: string }> = [
  { v: 'top', label: '顶部' },
  { v: 'center', label: '居中' },
  { v: 'bottom', label: '底部' },
];
const SIZE_OPTIONS = [48, 60, 72, 90] as const;

const chipCls = (active: boolean) =>
  cn(
    'inline-flex h-6 items-center rounded-md px-1.5 text-[10px] transition-colors',
    active
      ? 'bg-[var(--cy-ink-700)] text-white'
      : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]',
  );

export const VgSubtitleSettings: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const fontsQ = useQuery({
    queryKey: ['vg.fonts'],
    queryFn: () => videoGeneration.listFonts(),
    staleTime: 5 * 60 * 1000,
  });
  const fonts: VgFontItem[] = fontsQ.data?.items ?? [];
  const bgOn = params.text_background_color === true;

  // 字体走系统字体(/fonts 扫 OS 字体目录,不打包,免体积+授权风险)。
  // 当前 font_name 不在列表里(如默认 STHeitiMedium.ttc 在本机不存在)→
  // 自动选第一个可用字体,避免卡在不存在的字体导致合成失败。
  React.useEffect(() => {
    if (fonts.length === 0) return;
    if (fonts.some((f) => f.name === params.font_name)) return;
    patch({ font_name: fonts[0]!.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fonts.length]);

  return (
    <div
      role="toolbar"
      aria-label="字幕设置"
      className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--cy-text-secondary)]"
    >
      {/* 启用 */}
      <button
        type="button"
        onClick={() => patch({ subtitle_enabled: !params.subtitle_enabled })}
        aria-pressed={params.subtitle_enabled}
        className={chipCls(params.subtitle_enabled)}
      >
        {params.subtitle_enabled ? '字幕开' : '字幕关'}
      </button>

      {params.subtitle_enabled && (
        <>
          <span className="mx-1 opacity-30">·</span>
          {/* 位置 chips */}
          <span className="opacity-60">位置</span>
          <div className="flex items-center gap-0.5">
            {POSITIONS.map(({ v, label }) => (
              <button
                key={v}
                type="button"
                onClick={() => patch({ subtitle_position: v })}
                aria-pressed={params.subtitle_position === v}
                className={chipCls(params.subtitle_position === v)}
              >
                {label}
              </button>
            ))}
          </div>

          <span className="mx-1 opacity-30">·</span>

          {/* 字体 select — 限宽 ~6 字,悬停 title 显全名 */}
          <span className="opacity-60">字体</span>
          <select
            value={params.font_name}
            onChange={(e) => patch({ font_name: e.target.value })}
            title={fonts.find((f) => f.name === params.font_name)?.label ?? params.font_name}
            className={cn(
              'h-6 w-[12em] rounded-md border border-[var(--cy-border-subtle)]',
              'bg-[var(--cy-surface-1)] pl-1.5 pr-5 text-[10px] text-[var(--cy-text-primary)]',
              'focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none',
            )}
          >
            {fonts.length === 0 && (
              <option value={params.font_name}>
                {fontsQ.isLoading ? '加载中…' : '(无字体 — 请重启后端扫系统字体)'}
              </option>
            )}
            {fonts.map((f) => (
              <option
                key={f.name}
                value={f.name}
                title={f.label ?? f.name}
                // 用字体自身样式渲染选项名(family 读到时);webview2/Chromium 支持
                style={f.family ? { fontFamily: `"${f.family}"` } : undefined}
              >
                {f.label ?? f.name}
              </option>
            ))}
          </select>

          <span className="mx-1 opacity-30">·</span>

          {/* 字号 — 可自定义输入(数字框)+ 常用值 datalist 提示 */}
          <span className="opacity-60">字号</span>
          <input
            type="number"
            min={12} max={300}
            value={params.font_size}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!Number.isNaN(n)) patch({ font_size: Math.max(12, Math.min(300, n)) });
            }}
            list="vg-fontsize-presets"
            className={cn(
              'h-6 w-[7em] rounded-md border border-[var(--cy-border-subtle)]',
              'bg-[var(--cy-surface-1)] pl-1.5 pr-1 text-[10px] text-[var(--cy-text-primary)]',
              'focus-visible:border-[var(--cy-brand-400)] focus-visible:outline-none',
            )}
          />
          <datalist id="vg-fontsize-presets">
            {SIZE_OPTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>

          <span className="mx-1 opacity-30">·</span>

          {/* 颜色 + 背景 */}
          <span className="opacity-60">前景</span>
          <input
            type="color"
            value={params.text_fore_color}
            onChange={(e) => patch({ text_fore_color: e.target.value })}
            className="h-6 w-7 rounded border border-[var(--cy-border-subtle)] p-0"
            title="字幕前景色"
          />
          <span className="opacity-60">描边</span>
          <input
            type="color"
            value={params.stroke_color}
            onChange={(e) => patch({ stroke_color: e.target.value })}
            className="h-6 w-7 rounded border border-[var(--cy-border-subtle)] p-0"
            title="字幕描边色"
          />
          <button
            type="button"
            onClick={() => patch({ text_background_color: !bgOn })}
            aria-pressed={bgOn}
            className={chipCls(bgOn)}
            title="字幕黑色背景条"
          >
            {bgOn ? '黑底' : '无底'}
          </button>
        </>
      )}
    </div>
  );
};
