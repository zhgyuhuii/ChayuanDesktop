import * as React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { videoGeneration, type VgTimeline } from '@chayuan/api';
import { reportError } from '../../../store/errorDialog';

/**
 * proxy 预览播放器:渲染 previewEdl proxy 视频,上报 currentTime,接受外部 seek。
 * 受控字段:
 *  - seekMs:外部(点标尺/拖播放头)请求跳转;变化时 set video.currentTime。
 *  - playing:外部 transport 播放/暂停意图。
 *  - stale:timeline 变了,当前 proxy 过期,显"重新生成预览"。
 */
export const PreviewPlayer: React.FC<{
  timeline: VgTimeline;
  aspect: string;
  seekMs: number;
  playing: boolean;
  stale: boolean;
  onTimeMs: (ms: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onFreshGenerated: () => void;
  /** PIP 编辑浮层(P5c-2),叠在预览画面上。 */
  overlay?: React.ReactNode;
}> = ({ timeline, aspect, seekMs, playing, stale, onTimeMs, onPlayingChange, onFreshGenerated, overlay }) => {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const urlRef = React.useRef<string | null>(null);
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const generate = React.useCallback(async () => {
    if (!timeline.tracks?.some((t) => t.kind === 'video' && (t.clips?.length ?? 0) > 0)) {
      reportError(new Error('先在视频轨加入素材'));
      return;
    }
    setLoading(true);
    try {
      const { blob } = await videoGeneration.previewEdl({ timeline, aspect: aspect as never });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setUrl(urlRef.current);
      onFreshGenerated();
    } catch (e) { reportError(e as Error, '预览渲染失败'); }
    finally { setLoading(false); }
  }, [timeline, aspect, onFreshGenerated]);

  // 外部 seek → set currentTime
  React.useEffect(() => {
    const v = videoRef.current;
    if (v && Number.isFinite(seekMs)) {
      const target = seekMs / 1000;
      if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = target;
    }
  }, [seekMs]);

  // 外部 play/pause 意图
  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing && v.paused) void v.play().catch(() => undefined);
    if (!playing && !v.paused) v.pause();
  }, [playing, url]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl bg-black/90 p-2">
      <div className="relative flex max-h-full max-w-full items-center justify-center">
        {url ? (
          <video
            ref={videoRef}
            src={url}
            className="max-h-full max-w-full rounded"
            onTimeUpdate={(e) => onTimeMs(e.currentTarget.currentTime * 1000)}
            onPlay={() => onPlayingChange(true)}
            onPause={() => onPlayingChange(false)}
          />
        ) : (
          <div className="text-xs text-white/60">点「生成预览」查看画面</div>
        )}
        {/* PIP 编辑浮层覆盖在画面上(无 PIP 时为空) */}
        {overlay}
      </div>
      {(stale || !url) && (
        <button type="button" onClick={() => void generate()} disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg bg-[var(--cy-brand-500)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {url ? '重新生成预览' : '生成预览'}
        </button>
      )}
    </div>
  );
};
