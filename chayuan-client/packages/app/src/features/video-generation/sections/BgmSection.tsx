/**
 * BGM section -- from steps/BgmOutputStep.tsx.
 * Data from vgComposerStore params (bgm_type / bgm_file / bgm_volume).
 */
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { videoGeneration, type VgBgmItem } from '@chayuan/api';
import { useVgComposer } from '../store/vgComposer';

export const BgmSection: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const bgmQ = useQuery({
    queryKey: ['vg.bgm'],
    queryFn: () => videoGeneration.listBgm(),
    staleTime: 5 * 60 * 1000,
  });
  const items: VgBgmItem[] = bgmQ.data?.items ?? [];
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">
        {'背景音乐'}
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        {(['none', 'random', 'file'] as const).map((t) => (
          <button type="button" key={t} onClick={() => patch({ bgm_type: t })}
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
          <select value={params.bgm_file} onChange={(e) => patch({ bgm_file: e.target.value })}
            className="min-w-[14rem] rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1.5 text-xs">
            <option value="">{'（选择 BGM）'}</option>
            {items.map((b) => <option key={b.path} value={b.path}>{b.name} {'·'} {b.source}</option>)}
          </select>
        )}
      </div>
      {params.bgm_type !== 'none' && (
        <div className="mt-2">
          <label className="flex items-center justify-between text-xs text-[var(--cy-text-tertiary)]">
            {'BGM 音量'} <span>{Math.round(params.bgm_volume * 100)}%</span>
          </label>
          <input type="range" min={0} max={1} step={0.05} value={params.bgm_volume}
            onChange={(e) => patch({ bgm_volume: parseFloat(e.target.value) })}
            className="mt-1 w-full max-w-md accent-[var(--cy-brand-500)]" />
        </div>
      )}
    </section>
  );
};
