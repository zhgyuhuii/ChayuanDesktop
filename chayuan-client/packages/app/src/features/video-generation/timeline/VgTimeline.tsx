import * as React from 'react';
import { ChevronLeft, ChevronRight, Trash2, Replace } from 'lucide-react';
import type { VgTimeline as VgTimelineData } from '@chayuan/api';
import { clipDurMs, deleteClip, reorderClip, setClipDuration, setClipIn } from './timelineEdit';

const PX_PER_SEC = 12;
const MIN_SEG_PX = 24;

export const VgTimeline: React.FC<{
  timeline: VgTimelineData;
  /** 只读(P2):点片段触发 onClipClick;editable(P3):显示编辑控件,改动走 onChange。 */
  editable?: boolean;
  onChange?: (t: VgTimelineData) => void;
  onClipClick?: (clipId: string) => void;
  /** 外部统一 px/秒(P4a 多轨共用);不传则用内部默认 PX_PER_SEC。 */
  pxPerSec?: number;
  /** 由 clip 下标取首帧缩略图 URL(P4a 传 videoGeneration.thumbUrl 包装);不传则不显缩略图。 */
  thumbUrlOf?: (clipIndex: number) => string | null;
  /** 只渲染 video 轨(P4a 多轨时音频/字幕轨独立组件;默认 false 维持 P2/P3 三占位轨)。 */
  videoTrackOnly?: boolean;
  /** 选中 clip 点「替换」回调(P5b);不传则不显替换按钮。 */
  onReplaceClip?: (clipId: string) => void;
  /** clip 右键回调(P5b 右键菜单)。 */
  onClipContextMenu?: (e: React.MouseEvent, clipId: string) => void;
  /** 指定渲染哪条视频轨(P5c-2 多视频轨);不传 = 第一条 video 轨。 */
  trackId?: string;
}> = ({ timeline, editable, onChange, onClipClick, pxPerSec, thumbUrlOf, videoTrackOnly, onReplaceClip, onClipContextMenu, trackId }) => {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const pps = pxPerSec ?? PX_PER_SEC;
  const videoTrack = trackId
    ? (timeline.tracks || []).find((t) => t.id === trackId)
    : (timeline.tracks || []).find((t) => t.kind === 'video');
  const clips = videoTrack?.clips ?? [];

  // editable 下用 clipDurMs(out-in / duration_ms)算宽,编辑后更准;
  // 只读沿用相邻 start 差。轨道总宽取两者最大,保证拖宽后容器跟着撑开。
  const totalSec = Math.max(1, (timeline.duration_ms ?? 0) / 1000);
  const sumDurSec = clips.reduce((acc, c) => acc + clipDurMs(c) / 1000, 0);
  const widthPx = Math.max(240, Math.max(totalSec, sumDurSec) * pps);

  const segs = clips.map((c, i) => {
    const startS = c.track_start_ms / 1000;
    const durS = editable
      ? clipDurMs(c) / 1000
      : (i + 1 < clips.length ? clips[i + 1]!.track_start_ms / 1000 : totalSec) - startS;
    return { id: c.id, leftPx: startS * pps, widthPx: Math.max(MIN_SEG_PX, durS * pps), idx: i, in_ms: c.in_ms ?? 0 };
  });

  // pointer 拖拽:右把手改时长 / 左把手裁 in。起拖记录起始 x + 起始值,move 实时套算子。
  const startDrag = (e: React.PointerEvent, clipId: string, mode: 'dur' | 'in', startVal: number) => {
    if (!editable || !onChange) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
    const onMove = (ev: PointerEvent) => {
      const deltaMs = ((ev.clientX - startX) / pps) * 1000;
      onChange(mode === 'dur'
        ? setClipDuration(timeline, clipId, startVal + deltaMs)
        : setClipIn(timeline, clipId, startVal + deltaMs));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const trackBase =
    'relative h-12 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] overflow-x-auto cy-hide-scrollbar';

  return (
    <div className={videoTrackOnly ? 'relative h-full w-full' : 'overflow-x-auto cy-hide-scrollbar'} style={videoTrackOnly ? undefined : { minWidth: 0 }}>
      <div style={videoTrackOnly ? undefined : { width: widthPx }} className={videoTrackOnly ? 'relative h-full' : 'space-y-1.5'}>
        {/* 视频轨 */}
        <div className={videoTrackOnly ? 'relative h-full w-full' : trackBase} style={{ overflow: 'visible' }}>
          {!videoTrackOnly && <span className="absolute left-1 top-0.5 z-10 text-[9px] text-[var(--cy-text-tertiary)]">视频</span>}
          {segs.map((s) => {
            const selected = editable && selectedId === s.id;
            const dur = clipDurMs(clips[s.idx]!);
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => (editable ? setSelectedId(s.id) : onClipClick?.(s.id))}
                onContextMenu={(e) => { if (onClipContextMenu) { e.preventDefault(); onClipContextMenu(e, s.id); } }}
                onKeyDown={(e) => { if (e.key === 'Enter') (editable ? setSelectedId(s.id) : onClipClick?.(s.id)); }}
                style={{
                  left: s.leftPx, width: s.widthPx,
                  backgroundImage: thumbUrlOf?.(s.idx) ? `url(${thumbUrlOf(s.idx)})` : undefined,
                  backgroundSize: 'cover', backgroundPosition: 'center',
                }}
                className={`absolute top-3 h-8 cursor-pointer overflow-hidden rounded border text-[10px] ${
                  selected
                    ? 'z-20 border-[var(--cy-brand-600)] ring-2 ring-[var(--cy-brand-400)]'
                    : 'border-[var(--cy-brand-400)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)] hover:bg-[var(--cy-brand-100)]'
                }`}
                title={`片段 ${s.idx + 1} · ${(dur / 1000).toFixed(1)}s`}
              >
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="rounded bg-black/40 px-1 text-white">{s.idx + 1}</span>
                </span>
                {editable && (
                  <>
                    {/* 左把手:裁 in */}
                    <span
                      onPointerDown={(e) => startDrag(e, s.id, 'in', s.in_ms)}
                      className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l bg-[var(--cy-brand-500)]/60 hover:bg-[var(--cy-brand-600)]"
                      title="拖动裁剪入点"
                    />
                    {/* 右把手:改时长 */}
                    <span
                      onPointerDown={(e) => startDrag(e, s.id, 'dur', dur)}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r bg-[var(--cy-brand-500)]/60 hover:bg-[var(--cy-brand-600)]"
                      title="拖动改时长"
                    />
                  </>
                )}
                {selected && onChange && (
                  <div className="absolute -top-6 left-0 z-30 flex items-center gap-0.5 rounded bg-[var(--cy-surface-base)] p-0.5 shadow ring-1 ring-[var(--cy-border-subtle)]">
                    <button type="button" onClick={(e) => { e.stopPropagation(); onChange(reorderClip(timeline, s.id, s.idx - 1)); }}
                      disabled={s.idx === 0}
                      className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-30" title="左移">
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); onChange(reorderClip(timeline, s.id, s.idx + 1)); }}
                      disabled={s.idx >= clips.length - 1}
                      className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] disabled:opacity-30" title="右移">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                    {onReplaceClip && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); onReplaceClip(s.id); }}
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]" title="替换素材">
                        <Replace className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedId(null); onChange(deleteClip(timeline, s.id)); }}
                      className="inline-flex h-5 w-5 items-center justify-center rounded text-rose-600 hover:bg-rose-50" title="删除片段">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {segs.length === 0 && (
            <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">
              从下方「加入轨道」添加素材
            </span>
          )}
        </div>
        {!videoTrackOnly && (
          <>
            {/* 音频轨(P2 占位) */}
            <div className={trackBase}>
              <span className="absolute left-1 top-0.5 text-[9px] text-[var(--cy-text-tertiary)]">音频</span>
              <div className="absolute inset-x-1 top-4 h-5 rounded bg-[var(--cy-surface-2)]" />
            </div>
            {/* 字幕轨(P2 占位) */}
            <div className={trackBase}>
              <span className="absolute left-1 top-0.5 text-[9px] text-[var(--cy-text-tertiary)]">字幕</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
