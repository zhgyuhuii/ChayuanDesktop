/**
 * Step 6 · 配乐 + 输出参数。
 *
 * - BGM:无 / 随机 / 指定文件(下拉 from /bgm 内置+用户上传合并)+ 音量
 * - 字幕样式:开关 + 位置 + 字体 + 字号 + 颜色 + 描边
 * - 渲染参数:数量(1-5 同主题多份)+ 转场 + 拼接模式 + 单段最长时长
 *
 * 设计:不做实时预览(留 B5 RenderStep 那一步用真合成的视频带字幕看效果),
 * 这一步只配参数 + 简单数值显示。
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  videoGeneration,
  vgBgmFileUrl,
  type VgBgmItem,
  type VgFontItem,
} from '@chayuan/api';
import { useVgComposer } from '../store/vgComposer';

export const BgmOutputStep: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patchParams = useVgComposer((s) => s.patchParams);

  const bgmQ = useQuery({
    queryKey: ['vg.bgm'],
    queryFn: () => videoGeneration.listBgm(),
    staleTime: 5 * 60 * 1000,
  });
  const fontsQ = useQuery({
    queryKey: ['vg.fonts'],
    queryFn: () => videoGeneration.listFonts(),
    staleTime: 5 * 60 * 1000,
  });
  const bgmItems: VgBgmItem[] = bgmQ.data?.items ?? [];
  const fontItems: VgFontItem[] = fontsQ.data?.items ?? [];

  return (
    <div className="space-y-5">
      {/* BGM */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">背景音乐</h3>
        <div className="flex flex-wrap items-center gap-2">
          {(['none', 'random', 'file'] as const).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => patchParams({ bgm_type: t })}
              className={
                'rounded-full border px-3 py-1.5 text-xs transition-colors ' +
                (params.bgm_type === t
                  ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                  : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')
              }
            >
              {t === 'none' ? '无' : t === 'random' ? '随机' : '指定文件'}
            </button>
          ))}
          {params.bgm_type === 'file' && (
            <select
              className="min-w-[14rem] rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1.5 text-xs"
              value={params.bgm_file}
              onChange={(e) => patchParams({ bgm_file: e.target.value })}
            >
              <option value="">(选择 BGM)</option>
              {bgmItems.map((b) => (
                <option key={b.path} value={b.path}>
                  {b.name} · {b.source}
                </option>
              ))}
            </select>
          )}
          {params.bgm_type === 'file' && (() => {
            const sel = bgmItems.find((b) => b.path === params.bgm_file);
            return sel ? <audio src={vgBgmFileUrl(sel.name)} controls className="h-8" /> : null;
          })()}
        </div>
        {params.bgm_type !== 'none' && (
          <div className="mt-2">
            <label className="flex items-center justify-between text-xs text-[var(--cy-text-tertiary)]">
              BGM 音量
              <span>{Math.round(params.bgm_volume * 100)}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={params.bgm_volume}
              onChange={(e) => patchParams({ bgm_volume: parseFloat(e.target.value) })}
              className="mt-1 w-full max-w-md accent-[var(--cy-brand-500)]"
            />
          </div>
        )}
      </section>

      {/* 字幕样式 */}
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--cy-text-primary)]">
          字幕样式
          <label className="flex items-center gap-1 text-xs font-normal text-[var(--cy-text-secondary)]">
            <input
              type="checkbox"
              checked={params.subtitle_enabled}
              onChange={(e) => patchParams({ subtitle_enabled: e.target.checked })}
            />
            启用字幕
          </label>
        </h3>
        {params.subtitle_enabled && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-xs text-[var(--cy-text-tertiary)]">位置</label>
              <select
                className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs"
                value={params.subtitle_position}
                onChange={(e) => patchParams({ subtitle_position: e.target.value as 'top' | 'bottom' | 'center' | 'custom' })}
              >
                <option value="top">顶部</option>
                <option value="center">居中</option>
                <option value="bottom">底部</option>
                <option value="custom">自定义</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--cy-text-tertiary)]">字体</label>
              <select
                className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs"
                value={params.font_name}
                onChange={(e) => patchParams({ font_name: e.target.value })}
              >
                {fontItems.length === 0 && <option value={params.font_name}>{params.font_name}</option>}
                {fontItems.map((f) => (
                  <option key={f.name} value={f.name}>{f.name} · {f.source}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--cy-text-tertiary)]">字号</label>
              <input
                type="number"
                min={20}
                max={200}
                value={params.font_size}
                onChange={(e) => patchParams({ font_size: parseInt(e.target.value, 10) || 60 })}
                className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--cy-text-tertiary)]">前景色</label>
              <input
                type="color"
                value={params.text_fore_color}
                onChange={(e) => patchParams({ text_fore_color: e.target.value })}
                className="mt-1 h-7 w-full rounded border border-[var(--cy-border-subtle)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--cy-text-tertiary)]">描边色</label>
              <input
                type="color"
                value={params.stroke_color}
                onChange={(e) => patchParams({ stroke_color: e.target.value })}
                className="mt-1 h-7 w-full rounded border border-[var(--cy-border-subtle)]"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--cy-text-tertiary)]">描边宽度</label>
              <input
                type="number"
                min={0}
                max={10}
                step={0.5}
                value={params.stroke_width}
                onChange={(e) => patchParams({ stroke_width: parseFloat(e.target.value) || 1.5 })}
                className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--cy-text-tertiary)]">背景</label>
              <select
                className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs"
                value={typeof params.text_background_color === 'string' ? 'custom' : params.text_background_color ? 'on' : 'off'}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'on') patchParams({ text_background_color: true });
                  else if (v === 'off') patchParams({ text_background_color: false });
                  // 'custom' 时不动 — 用户用色板/写自己的字符串
                }}
              >
                <option value="on">黑底</option>
                <option value="off">无背景</option>
              </select>
            </div>
          </div>
        )}
      </section>

      {/* 渲染参数 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">渲染参数</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-xs text-[var(--cy-text-tertiary)]">视频数量</label>
            <input
              type="number"
              min={1}
              max={5}
              value={params.video_count}
              onChange={(e) => patchParams({ video_count: parseInt(e.target.value, 10) || 1 })}
              className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--cy-text-tertiary)]">单段最长 (s)</label>
            <input
              type="number"
              min={1}
              max={60}
              value={params.video_clip_duration}
              onChange={(e) => patchParams({ video_clip_duration: parseInt(e.target.value, 10) || 5 })}
              className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--cy-text-tertiary)]">拼接顺序</label>
            <select
              className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs"
              value={params.video_concat_mode}
              onChange={(e) => patchParams({ video_concat_mode: e.target.value as 'random' | 'sequential' })}
            >
              <option value="random">随机</option>
              <option value="sequential">顺序</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--cy-text-tertiary)]">转场</label>
            <select
              className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs"
              value={params.video_transition_mode}
              onChange={(e) => patchParams({ video_transition_mode: e.target.value as '' | 'Shuffle' | 'FadeIn' | 'FadeOut' | 'SlideIn' | 'SlideOut' })}
            >
              <option value="">无</option>
              <option value="Shuffle">Shuffle</option>
              <option value="FadeIn">FadeIn</option>
              <option value="FadeOut">FadeOut</option>
              <option value="SlideIn">SlideIn</option>
              <option value="SlideOut">SlideOut</option>
            </select>
          </div>
        </div>
      </section>
    </div>
  );
};
