/**
 * BGM section — bgm_type(无/随机/指定)+ 指定时下拉选 bundled/上传 BGM,
 * 带内嵌 <audio> 试听 + 上传按钮。数据来自 vgComposerStore params。
 */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Upload } from 'lucide-react';
import { videoGeneration, vgBgmFileUrl, type VgBgmItem } from '@chayuan/api';
import { useVgComposer } from '../store/vgComposer';
import { reportError } from '../../../store/errorDialog';

export const BgmSection: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const qc = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState(false);

  const bgmQ = useQuery({
    queryKey: ['vg.bgm'],
    queryFn: () => videoGeneration.listBgm(),
    staleTime: 5 * 60 * 1000,
  });
  const items: VgBgmItem[] = bgmQ.data?.items ?? [];
  const selected = items.find((b) => b.path === params.bgm_file);

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const r = await videoGeneration.uploadBgm(file);
      await qc.invalidateQueries({ queryKey: ['vg.bgm'] });
      patch({ bgm_type: 'file', bgm_file: r.path });
    } catch (e) {
      reportError(e as Error, 'BGM 上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">背景音乐</h3>
      <div className="flex flex-wrap items-center gap-2">
        {(['none', 'random', 'file'] as const).map((t) => (
          <button type="button" key={t} onClick={() => patch({ bgm_type: t })}
            className={'rounded-full border px-3 py-1.5 text-xs transition-colors ' +
              (params.bgm_type === t ? 'border-[var(--cy-brand-500)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)]'
                                     : 'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] text-[var(--cy-text-secondary)] hover:border-[var(--cy-border-strong)]')}>
            {t === 'none' ? '无' : t === 'random' ? '随机' : '指定'}
          </button>
        ))}
        {params.bgm_type === 'file' && (
          <select value={params.bgm_file} onChange={(e) => patch({ bgm_file: e.target.value })}
            className="min-w-[14rem] rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1.5 text-xs">
            <option value="">（选择 BGM）</option>
            {items.map((b) => <option key={b.path} value={b.path}>{b.name} · {b.source}</option>)}
          </select>
        )}
        {params.bgm_type === 'file' && selected && (
          <audio src={vgBgmFileUrl(selected.name)} controls className="h-8" />
        )}
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 py-1.5 text-xs hover:border-[var(--cy-border-strong)] disabled:opacity-50">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} 上传 BGM
        </button>
        <input ref={inputRef} type="file" accept="audio/*" className="hidden"
          onChange={(e) => void onUpload(e.target.files?.[0])} />
      </div>
      {params.bgm_type !== 'none' && (
        <div className="mt-2">
          <label className="flex items-center justify-between text-xs text-[var(--cy-text-tertiary)]">
            BGM 音量 <span>{Math.round(params.bgm_volume * 100)}%</span>
          </label>
          <input type="range" min={0} max={1} step={0.05} value={params.bgm_volume}
            onChange={(e) => patch({ bgm_volume: parseFloat(e.target.value) })}
            className="mt-1 w-full max-w-md accent-[var(--cy-brand-500)]" />
        </div>
      )}
    </section>
  );
};
