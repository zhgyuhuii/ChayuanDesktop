import * as React from 'react';
import { ChevronLeft, ChevronRight, Trash2, Replace, Volume2, VolumeX, SlidersHorizontal } from 'lucide-react';
import { ClipPropertyPopover } from './ClipPropertyPopover';
import { Popover, PopoverTrigger, PopoverContent } from '@chayuan/ui';
import type { VgTimeline as VgTimelineData } from '@chayuan/api';
import { clipDurMs, deleteClip, reorderClip, setClipDuration, setClipIn, setClipStart, normalizeMontage, setClipMuted } from './timelineEdit';
import { TRANSITIONS, hasTransition } from './transitions';

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
  /** 由 clip 下标取首帧缩略图 URL(P4a 传 videoGeneration.thumbUrl 包装);不传则不显缩略图。
   *  注:thumbUrlOf 按「下标」索引主轨 clips,只适用主轨;PIP/附加轨用 clipThumb 按 clip 自身 source 取。 */
  thumbUrlOf?: (clipIndex: number) => string | null;
  /** 按 clip 自身 source 取缩略图(material_id → 素材缩略图);所有视频轨通用,PIP 轨必需。 */
  clipThumb?: (clip: { source?: { material_id?: string; url?: string } }) => string | null;
  /** 只渲染 video 轨(P4a 多轨时音频/字幕轨独立组件;默认 false 维持 P2/P3 三占位轨)。 */
  videoTrackOnly?: boolean;
  /** 选中 clip 点「替换」回调(P5b);不传则不显替换按钮。 */
  onReplaceClip?: (clipId: string) => void;
  /** clip 右键回调(P5b 右键菜单)。 */
  onClipContextMenu?: (e: React.MouseEvent, clipId: string) => void;
  /** 指定渲染哪条视频轨(P5c-2 多视频轨);不传 = 第一条 video 轨。 */
  trackId?: string;
  /** 全局选中 clip(#10:跨轨选中 + Delete 删除);命中则高亮。 */
  selectedClipId?: string | null;
  onSelectClip?: (clipId: string) => void;
  /** 点片段间转场块(#26):在切点打开转场菜单。 */
  onTransitionMenu?: (e: React.MouseEvent, clipId: string) => void;
  /** 裁剪编辑态(P2 几何):由父级管,传给 ClipPropertyPopover 的「裁剪」切换。 */
  cropEditingClipId?: string | null;
  onToggleCropClip?: (clipId: string) => void;
}> = ({ timeline, editable, onChange, onClipClick, pxPerSec, thumbUrlOf, clipThumb, videoTrackOnly, onReplaceClip, onClipContextMenu, trackId, selectedClipId, onSelectClip, onTransitionMenu, cropEditingClipId, onToggleCropClip }) => {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [propOpenId, setPropOpenId] = React.useState<string | null>(null);
  const pps = pxPerSec ?? PX_PER_SEC;
  const videoTrack = trackId
    ? (timeline.tracks || []).find((t) => t.id === trackId)
    : (timeline.tracks || []).find((t) => t.kind === 'video');
  const clips = videoTrack?.clips ?? [];
  // PIP/附加轨才显示透明度+位置/缩放。判定用 removable:主轨(第一条视频轨)恒为 removable=false,
  // 与后端 _build_pip_layers「video_tracks[1:] 为 PIP 层」在当前轨道构造下等价(主轨永远在首位且不可删)。
  const isPip = !!videoTrack?.removable;

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

  // 整块拖动:改 track_start_ms 跟随指针;松手时主轨归一成新顺序(#11)。
  // 未移动(阈值内)= 点选(#10)。点到把手/按钮的 pointerdown 已 stopPropagation,不进这里。
  const startBodyDrag = (e: React.PointerEvent, clipId: string, origStart: number) => {
    if (!onChange) return;
    if ((e.target as HTMLElement).closest('button,[data-handle]')) return;
    const startX = e.clientX;
    let moved = false;
    // 在闭包里累积最新时间轴 —— 否则 onUp 的 normalizeMontage 会用拖动前的旧 timeline,
    // 把这次拖动整个丢弃,导致「拖了等于没拖」(#30)。
    let latest = timeline;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 4) return;
      moved = true;
      const deltaMs = ((ev.clientX - startX) / pps) * 1000;
      latest = setClipStart(latest, clipId, origStart + deltaMs);
      onChange(latest);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) { setSelectedId(clipId); onSelectClip?.(clipId); }
      else if (editable) { onChange(normalizeMontage(latest)); }
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
            const selected = (editable && selectedId === s.id) || selectedClipId === s.id;
            const dur = clipDurMs(clips[s.idx]!);
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onPointerDown={(e) => startBodyDrag(e, s.id, clips[s.idx]!.track_start_ms)}
                onContextMenu={(e) => { if (onClipContextMenu) { e.preventDefault(); onClipContextMenu(e, s.id); } }}
                onKeyDown={(e) => { if (e.key === 'Enter') { setSelectedId(s.id); onSelectClip?.(s.id); if (!editable) onClipClick?.(s.id); } }}
                style={{
                  left: s.leftPx, width: s.widthPx,
                  // 优先按 clip 自身 source 取缩略图(主轨/PIP 轨通用);兜底用主轨下标式 thumbUrlOf
                  backgroundImage: (() => {
                    const u = clipThumb?.(clips[s.idx]!) ?? thumbUrlOf?.(s.idx);
                    return u ? `url(${u})` : undefined;
                  })(),
                  backgroundSize: 'cover', backgroundPosition: 'center',
                }}
                className={`absolute top-2 h-8 cursor-grab active:cursor-grabbing overflow-hidden rounded border text-[10px] ${
                  selected
                    ? 'z-20 border-[var(--cy-brand-600)] ring-2 ring-[var(--cy-brand-400)]'
                    : 'border-[var(--cy-brand-400)] bg-[var(--cy-brand-50)] text-[var(--cy-brand-700)] hover:bg-[var(--cy-brand-100)]'
                }`}
                title={`片段 ${s.idx + 1} · ${(dur / 1000).toFixed(1)}s · 拖动调顺序`}
              >
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="rounded bg-black/40 px-1 text-white">{s.idx + 1}</span>
                </span>
                {editable && (
                  <>
                    {/* 左把手:裁 in */}
                    <span data-handle
                      onPointerDown={(e) => startDrag(e, s.id, 'in', s.in_ms)}
                      className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l bg-[var(--cy-brand-500)]/60 hover:bg-[var(--cy-brand-600)]"
                      title="拖动裁剪入点"
                    />
                    {/* 右把手:改时长 */}
                    <span data-handle
                      onPointerDown={(e) => startDrag(e, s.id, 'dur', dur)}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r bg-[var(--cy-brand-500)]/60 hover:bg-[var(--cy-brand-600)]"
                      title="拖动改时长"
                    />
                  </>
                )}
                {selected && onChange && editable && (
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
                    {/* 逐片段静音原声(默认混入;成片由后端按 muted 决定是否混) */}
                    <button type="button" onClick={(e) => { e.stopPropagation(); onChange(setClipMuted(timeline, s.id, !clips[s.idx]!.muted)); }}
                      className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]"
                      title={clips[s.idx]!.muted ? '取消静音(混入该片段原声)' : '静音该片段原声'}>
                      {clips[s.idx]!.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                    </button>
                    {onChange && (
                      <Popover open={propOpenId === s.id} onOpenChange={(open) => setPropOpenId(open ? s.id : null)}>
                        <PopoverTrigger asChild>
                          <button type="button" onClick={(e) => e.stopPropagation()}
                            className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]" title="属性(透明度/音量/位置/缩放/几何)">
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent side="top" align="start" sideOffset={6} className="w-56 p-2">
                          <ClipPropertyPopover timeline={timeline} clip={clips[s.idx]!} isPip={isPip}
                            cropEditing={cropEditingClipId === clips[s.idx]!.id}
                            onToggleCrop={() => onToggleCropClip?.(clips[s.idx]!.id)}
                            onChange={onChange} />
                        </PopoverContent>
                      </Popover>
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
          {/* 片段间转场块(#26):每个切点(第 2 个片段起)一个小块,点开转场菜单 */}
          {onTransitionMenu && segs.slice(1).map((s) => {
            const tr = clips[s.idx]?.transition;
            const on = hasTransition(tr);
            const Icon = TRANSITIONS.find((o) => o.value === tr)?.icon;
            return (
              <button key={`tx-${s.id}`} type="button"
                onClick={(e) => { e.stopPropagation(); onTransitionMenu(e, s.id); }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onTransitionMenu(e, s.id); }}
                title={on ? `转场:${TRANSITIONS.find((o) => o.value === tr)?.label}` : '设置转场'}
                style={{ left: s.leftPx - 7 }}
                className={`absolute top-1/2 z-40 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-sm border text-[8px] ${
                  on ? 'border-[var(--cy-brand-600)] bg-[var(--cy-brand-500)] text-white'
                     : 'border-[var(--cy-border-strong)] bg-[var(--cy-surface-base)] text-[var(--cy-text-tertiary)] hover:border-[var(--cy-brand-400)]'}`}>
                {Icon ? <Icon className="h-2.5 w-2.5" /> : '⇄'}
              </button>
            );
          })}
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
