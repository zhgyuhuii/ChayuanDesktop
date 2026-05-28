/**
 * Output section -- subtitle style + render params (from steps/BgmOutputStep.tsx).
 * Data from vgComposerStore params.
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { videoGeneration, type VgFontItem } from '@chayuan/api';
import { useVgComposer } from '../store/vgComposer';

export const OutputSection: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const fontsQ = useQuery({
    queryKey: ['vg.fonts'],
    queryFn: () => videoGeneration.listFonts(),
    staleTime: 5 * 60 * 1000,
  });
  const fonts: VgFontItem[] = fontsQ.data?.items ?? [];
  return (
    <section className="space-y-4">
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--cy-text-primary)]">
          {'字幕样式'}
          <label className="flex items-center gap-1 text-xs font-normal text-[var(--cy-text-secondary)]">
            <input type="checkbox" checked={params.subtitle_enabled}
              onChange={(e) => patch({ subtitle_enabled: e.target.checked })} />
            {'启用'}
          </label>
        </h3>
        {params.subtitle_enabled && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-xs text-[var(--cy-text-tertiary)]">{'位置'}</label>
              <select value={params.subtitle_position}
                onChange={(e) => patch({ subtitle_position: e.target.value as 'top' | 'bottom' | 'center' | 'custom' })}
                className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs">
                <option value="top">{'顶部'}</option>
                <option value="center">{'居中'}</option>
                <option value="bottom">{'底部'}</option>
                <option value="custom">{'自定义'}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--cy-text-tertiary)]">{'字体'}</label>
              <select value={params.font_name} onChange={(e) => patch({ font_name: e.target.value })}
                className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs">
                {fonts.length === 0 && <option value={params.font_name}>{params.font_name}</option>}
                {fonts.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--cy-text-tertiary)]">{'字号'}</label>
              <input type="number" min={20} max={200} value={params.font_size}
                onChange={(e) => patch({ font_size: parseInt(e.target.value, 10) || 60 })}
                className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs" />
            </div>
            <div>
              <label className="block text-xs text-[var(--cy-text-tertiary)]">{'前景'}</label>
              <input type="color" value={params.text_fore_color}
                onChange={(e) => patch({ text_fore_color: e.target.value })}
                className="mt-1 h-7 w-full rounded border border-[var(--cy-border-subtle)]" />
            </div>
          </div>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">{'渲染参数'}</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-xs text-[var(--cy-text-tertiary)]">{'份数'}</label>
            <input type="number" min={1} max={5} value={params.video_count}
              onChange={(e) => patch({ video_count: parseInt(e.target.value, 10) || 1 })}
              className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs" />
          </div>
          <div>
            <label className="block text-xs text-[var(--cy-text-tertiary)]">{'单段最长 (s)'}</label>
            <input type="number" min={1} max={60} value={params.video_clip_duration}
              onChange={(e) => patch({ video_clip_duration: parseInt(e.target.value, 10) || 5 })}
              className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs" />
          </div>
          <div>
            <label className="block text-xs text-[var(--cy-text-tertiary)]">{'拼接'}</label>
            <select value={params.video_concat_mode}
              onChange={(e) => patch({ video_concat_mode: e.target.value as 'random' | 'sequential' })}
              className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs">
              <option value="random">{'随机'}</option>
              <option value="sequential">{'顺序'}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--cy-text-tertiary)]">{'转场'}</label>
            <select value={params.video_transition_mode}
              onChange={(e) => patch({ video_transition_mode: e.target.value as '' | 'Shuffle' | 'FadeIn' | 'FadeOut' | 'SlideIn' | 'SlideOut' })}
              className="mt-1 w-full rounded border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1 text-xs">
              <option value="">{'无'}</option>
              <option value="FadeIn">FadeIn</option>
              <option value="FadeOut">FadeOut</option>
              <option value="SlideIn">SlideIn</option>
              <option value="SlideOut">SlideOut</option>
              <option value="Shuffle">Shuffle</option>
            </select>
          </div>
        </div>
      </div>
    </section>
  );
};
