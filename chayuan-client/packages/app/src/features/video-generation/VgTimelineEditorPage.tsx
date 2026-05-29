import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Play, Sparkles, Film } from 'lucide-react';
import { videoGeneration } from '@chayuan/api';
import { useVgComposer } from './store/vgComposer';
import { MaterialsStep } from './steps/MaterialsStep';
import { VgTimeline } from './timeline/VgTimeline';
import { buildTimelineFromMaterials } from './timeline/buildTimeline';
import { reportError, notifySuccess } from '../../store/errorDialog';
import { useTabsStore } from '../../store/tabs';

export const VgTimelineEditorPage: React.FC = () => {
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.open);
  const params = useVgComposer((s) => s.params);
  const [previewing, setPreviewing] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const urlRef = React.useRef<string | null>(null);
  React.useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const timeline = React.useMemo(
    () => buildTimelineFromMaterials(params.video_materials ?? []),
    [params.video_materials],
  );

  const onPreview = async () => {
    if (!timeline.tracks[0]?.clips?.length) { reportError(new Error('先加入素材到轨道')); return; }
    setPreviewing(true);
    try {
      const r = await videoGeneration.previewEdl({ timeline, aspect: params.video_aspect });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(r.blob);
      setPreviewUrl(urlRef.current);
    } catch (e) { reportError(e as Error, '预览失败'); }
    finally { setPreviewing(false); }
  };

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      const t = await videoGeneration.submitTask({ ...params, timeline }, { stop_at: 'video' });
      notifySuccess(`已提交 ${t.task_id.slice(0, 8)}…`, '前往「我的视频」看进度');
      openTab('/video-generation/library', { title: '我的视频', icon: 'video' });
      void navigate({ to: '/video-generation/library' as never });
    } catch (e) { reportError(e as Error, '提交失败'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 overflow-y-auto cy-hide-scrollbar px-6 py-6">
      <header>
        <h1 className="inline-flex items-center gap-2 text-xl font-semibold text-[var(--cy-text-primary)]">
          <Film className="h-5 w-5" /> 时间轴编辑
        </h1>
        <p className="mt-1 text-sm text-[var(--cy-text-tertiary)]">加入素材到轨道 → 预览画面顺序 → 提交生成(P2:只读轨道 + 画面预览)</p>
      </header>

      <section className="rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] p-3">
        <VgTimeline timeline={timeline} />
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={() => void onPreview()} disabled={previewing}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--cy-brand-500)] px-3 text-xs font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
            {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} 预览画面
          </button>
          <button type="button" onClick={() => void onSubmit()} disabled={submitting}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 text-xs font-medium text-white shadow disabled:opacity-50">
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} 提交生成
          </button>
        </div>
        {previewUrl && (
          <video src={previewUrl} controls className="mt-2 max-h-[40vh] rounded-lg bg-black" />
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">加入轨道</h2>
        <MaterialsStep />
      </section>
    </div>
  );
};

export default VgTimelineEditorPage;
