import * as React from 'react';
import { Loader2, RefreshCw, Pencil } from 'lucide-react';
import { videoGeneration, type VgTimeline, type VgOverlay } from '@chayuan/api';
import { reportError } from '../../../store/errorDialog';
import { LivePreviewCanvas } from './LivePreviewCanvas';
import type { SrtCue } from './srtParse';
import { cuesToSrt } from './subtitleEdit';

/**
 * 预览区:默认「实时画布」(LivePreviewCanvas)——拖素材进视频轨立即出画,
 * PIP 可拖动调位/缩放,只显当前 playhead 帧(scrub),不依赖服务端渲染。
 * 「精确预览」按钮按需生成 proxy mp4 可连续播放;再点「回到编辑」回实时画布。
 * 受控字段:
 *  - seekMs:外部(点标尺/拖播放头)请求跳转;proxy 模式下 set video.currentTime。
 *  - playing:外部 transport 播放/暂停意图(仅 proxy 模式生效)。
 *  - stale:timeline 变了,当前 proxy 过期。
 */
export const PreviewPlayer: React.FC<{
  timeline: VgTimeline;
  aspect: string;
  width?: number | null;
  height?: number | null;
  playheadMs: number;
  seekMs: number;
  playing: boolean;
  stale: boolean;
  onTimeMs: (ms: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onFreshGenerated: () => void;
  onTransform: (clipId: string, tf: { x?: number; y?: number; scale?: number; rotation?: number; flip_h?: boolean; flip_v?: boolean; opacity?: number }) => void;
  cropEditingClipId: string | null;
  onCrop: (clipId: string, crop: { x: number; y: number; w: number; h: number }) => void;
  selectedClipId: string | null;
  onSelectClip: (clipId: string | null) => void;
  backgroundColor: string;
  overlays?: VgOverlay[];
  selectedOverlayId?: string | null;
  onSelectOverlay?: (id: string | null) => void;
  onOverlayTransform?: (id: string, tf: Partial<VgOverlay>) => void;
  /** 模式上提:父组件据此决定是否跑实时播放引擎(proxy 模式由 proxy <video> 自己驱动)。 */
  onModeChange?: (mode: 'live' | 'proxy') => void;
  /** 字幕 cues:实时画布按 playhead 叠当前字幕;精确预览时也烧进 proxy。 */
  cues?: SrtCue[];
  /** #25 精确预览要带旁白/BGM/字幕:旁白任务 + 合成参数。 */
  taskId?: string | null;
  audioFileName?: string | null;
  composeParams?: unknown;
}> = ({ timeline, aspect, width, height, playheadMs, seekMs, playing, stale, onTimeMs, onPlayingChange, onFreshGenerated, onTransform, cropEditingClipId, onCrop, selectedClipId, onSelectClip, backgroundColor, overlays, selectedOverlayId, onSelectOverlay, onOverlayTransform, onModeChange, cues, taskId, audioFileName, composeParams }) => {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const urlRef = React.useRef<string | null>(null);
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [mode, setModeRaw] = React.useState<'live' | 'proxy'>('live');
  const setMode = React.useCallback((m: 'live' | 'proxy') => { setModeRaw(m); onModeChange?.(m); }, [onModeChange]);

  React.useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  React.useEffect(() => { onModeChange?.('live'); }, []); // 初始上报 live

  const generate = React.useCallback(async () => {
    if (!timeline.tracks?.some((t) => t.kind === 'video' && (t.clips?.length ?? 0) > 0)) {
      reportError(new Error('先在视频轨加入素材'));
      return;
    }
    setLoading(true);
    try {
      const { blob } = await videoGeneration.previewEdl({
        timeline, aspect: aspect as never, width, height,
        taskId, audioFile: audioFileName,
        subtitle: cues && cues.length ? cuesToSrt(cues) : null,
        params: composeParams,
      });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setUrl(urlRef.current);
      setMode('proxy');
      onFreshGenerated();
    } catch (e) { reportError(e as Error, '预览渲染失败'); }
    finally { setLoading(false); }
  }, [timeline, aspect, width, height, taskId, audioFileName, cues, composeParams, onFreshGenerated]);

  // 外部 seek → set currentTime(proxy 模式)
  React.useEffect(() => {
    const v = videoRef.current;
    if (mode === 'proxy' && v && Number.isFinite(seekMs)) {
      const target = seekMs / 1000;
      if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = target;
    }
  }, [seekMs, mode]);

  // 外部 play/pause 意图(proxy 模式)
  React.useEffect(() => {
    const v = videoRef.current;
    if (mode !== 'proxy' || !v) return;
    if (playing && v.paused) void v.play().catch(() => undefined);
    if (!playing && !v.paused) v.pause();
  }, [playing, url, mode]);

  const ratio = (width && height && width > 0 && height > 0)
    ? `${width} / ${height}`
    : aspect === '16:9' ? '16 / 9' : aspect === '1:1' ? '1 / 1' : '9 / 16';
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl bg-[var(--cy-surface-2)] p-2">
      {/* 固定画幅黑框:实时画布 / proxy 视频都在框内(坐标与成片一致) */}
      <div className="relative max-h-full overflow-hidden rounded bg-black"
        style={{ aspectRatio: ratio, height: '100%', maxWidth: '100%' }}>
        {mode === 'proxy' && url ? (
          <video
            ref={videoRef}
            src={url}
            className="h-full w-full object-contain"
            onTimeUpdate={(e) => onTimeMs(e.currentTarget.currentTime * 1000)}
            onPlay={() => onPlayingChange(true)}
            onPause={() => onPlayingChange(false)}
          />
        ) : (
          <LivePreviewCanvas timeline={timeline} playheadMs={playheadMs} playing={playing} onTransform={onTransform} cropEditingClipId={cropEditingClipId} onCrop={onCrop} selectedClipId={selectedClipId} onSelectClip={onSelectClip} backgroundColor={backgroundColor} overlays={overlays} selectedOverlayId={selectedOverlayId} onSelectOverlay={onSelectOverlay} onOverlayTransform={onOverlayTransform} cues={cues} />
        )}
      </div>
      <div className="flex items-center gap-2">
        {mode === 'proxy' ? (
          <button type="button" onClick={() => setMode('live')}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--cy-border-strong)] px-3 py-1.5 text-xs font-medium text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-1)]">
            <Pencil className="h-3.5 w-3.5" /> 回到编辑
          </button>
        ) : null}
        <button type="button" onClick={() => void generate()} disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg bg-[var(--cy-brand-500)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {url && stale ? '重新生成精确预览' : url ? '精确预览' : '生成精确预览'}
        </button>
      </div>
    </div>
  );
};
