/**
 * 输出框架设置:背景色(人人可用)+ 片头/片尾(付费会员可设,全局默认+项目覆盖)。
 * 项目值留空 = 跟随全局默认;「设为默认」把当前背景/片头/片尾存为全局默认(记住)。
 * 付费判定 = counts>0 或 timeExpireAt 未过期(不含每日免费),对齐后端 is_paid_member。
 */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Upload } from 'lucide-react';
import { videoGeneration, type VgIntroOutroItem } from '@chayuan/api';
import { useVgComposer } from '../store/vgComposer';
import { useLicenseStore } from '../../license/licenseStore';
import { reportError } from '../../../store/errorDialog';

function usePaidMember(): boolean {
  const sv = useLicenseStore((s) => s.statusByApp['video']);
  const se = useLicenseStore((s) => s.statusByApp['video_edit']);
  const ok = (s?: { counts?: number; timeExpireAt?: string | null }) => {
    if (!s) return false;
    const timeValid = !!s.timeExpireAt && new Date(s.timeExpireAt).getTime() > Date.now();
    return (s.counts ?? 0) > 0 || timeValid;
  };
  return ok(sv) || ok(se);
}

export const OutputFramingSection: React.FC = () => {
  const params = useVgComposer((s) => s.params);
  const patch = useVgComposer((s) => s.patchParams);
  const qc = useQueryClient();
  const paid = usePaidMember();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploadingFor, setUploadingFor] = React.useState<'intro' | 'outro' | null>(null);
  const [savedTip, setSavedTip] = React.useState(false);

  const ioQ = useQuery({
    queryKey: ['vg.introOutro'],
    queryFn: () => videoGeneration.listIntroOutro(),
    staleTime: 5 * 60 * 1000,
  });
  const items: VgIntroOutroItem[] = ioQ.data?.items ?? [];

  const onUpload = async (file: File | undefined) => {
    const slot = uploadingFor;
    if (!file || !slot) return;
    try {
      const r = await videoGeneration.uploadIntroOutro(file);
      await qc.invalidateQueries({ queryKey: ['vg.introOutro'] });
      patch(slot === 'intro' ? { intro_clip: r.name } : { outro_clip: r.name });
    } catch (e) {
      reportError(e as Error, '片头/片尾上传失败');
    } finally {
      setUploadingFor(null);
    }
  };

  const saveDefault = async () => {
    try {
      await videoGeneration.setOutputDefaults({
        background_color: params.background_color,
        intro_clip: params.intro_clip ?? null,
        outro_clip: params.outro_clip ?? null,
      });
      setSavedTip(true);
      window.setTimeout(() => setSavedTip(false), 1800);
    } catch (e) {
      reportError(e as Error, '保存默认失败');
    }
  };

  const selCls =
    'h-7 min-w-[10rem] rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed';

  const clipRow = (slot: 'intro' | 'outro', label: string) => {
    const cur = slot === 'intro' ? params.intro_clip : params.outro_clip;
    return (
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-xs text-[var(--cy-text-tertiary)]">{label}</span>
        <select
          value={cur ?? ''}
          disabled={!paid}
          onChange={(e) => patch(slot === 'intro' ? { intro_clip: e.target.value || null } : { outro_clip: e.target.value || null })}
          className={selCls}
        >
          <option value="">（跟随默认 / 无）</option>
          {items.map((it) => (
            <option key={it.name} value={it.name}>{it.name} · {it.kind === 'image' ? '图' : '视频'}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={!paid || uploadingFor !== null}
          onClick={() => { setUploadingFor(slot); inputRef.current?.click(); }}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] px-2 text-xs hover:border-[var(--cy-border-strong)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploadingFor === slot ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} 上传
        </button>
        {cur && paid && (
          <button type="button" onClick={() => patch(slot === 'intro' ? { intro_clip: null } : { outro_clip: null })}
            className="text-xs text-[var(--cy-text-tertiary)] hover:text-rose-600">清除</button>
        )}
      </div>
    );
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-xs text-[var(--cy-text-tertiary)]">背景</span>
        <input type="color" value={params.background_color}
          onChange={(e) => patch({ background_color: e.target.value })}
          className="h-7 w-9 rounded border border-[var(--cy-border-subtle)] bg-transparent p-0" title="画面空白处背景色" />
        {['#000000', '#ffffff', '#1f2937'].map((c) => (
          <button key={c} type="button" title={c} onClick={() => patch({ background_color: c })}
            className="h-5 w-5 rounded border border-[var(--cy-border-subtle)]" style={{ background: c }} />
        ))}
      </div>

      <div className={paid ? '' : 'opacity-60'}>
        {!paid && (
          <p className="mb-1 text-[11px] text-amber-600">片头/片尾为会员功能;非会员成片自动添加察元片尾。</p>
        )}
        {clipRow('intro', '片头')}
        <div className="mt-1.5">{clipRow('outro', '片尾')}</div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={saveDefault}
          className="inline-flex h-7 items-center rounded-md border border-[var(--cy-brand-400)] bg-[var(--cy-brand-50)] px-2 text-xs text-[var(--cy-brand-700)] hover:bg-[var(--cy-brand-100)]">
          设为默认(记住)
        </button>
        {savedTip && <span className="text-[11px] text-[var(--cy-text-tertiary)]">已保存为全局默认</span>}
        <span className="text-[10px] text-[var(--cy-text-tertiary)]">片头/片尾在导出成片体现,预览不含</span>
      </div>

      <input ref={inputRef} type="file" accept="video/*,image/*" className="hidden"
        onChange={(e) => void onUpload(e.target.files?.[0])} />
    </section>
  );
};
