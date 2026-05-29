import * as React from 'react';
import type { VgTimeline as VgTimelineData } from '@chayuan/api';

const PX_PER_SEC = 12;

export const VgTimeline: React.FC<{
  timeline: VgTimelineData;
  onClipClick?: (clipId: string) => void;
}> = ({ timeline, onClipClick }) => {
  const videoTrack = (timeline.tracks || []).find((t) => t.kind === 'video');
  const clips = videoTrack?.clips ?? [];
  const totalSec = Math.max(1, (timeline.duration_ms ?? 0) / 1000);
  const widthPx = Math.max(240, totalSec * PX_PER_SEC);

  const segs = clips.map((c, i) => {
    const startS = c.track_start_ms / 1000;
    const nextS = i + 1 < clips.length ? clips[i + 1]!.track_start_ms / 1000 : totalSec;
    return {
      id: c.id,
      leftPx: startS * PX_PER_SEC,
      widthPx: Math.max(24, (nextS - startS) * PX_PER_SEC),
      idx: i + 1,
    };
  });

  const trackBase =
    'relative h-12 rounded-md border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] overflow-hidden';

  return (
    <div className="overflow-x-auto cy-hide-scrollbar" style={{ minWidth: 0 }}>
      <div style={{ width: widthPx }} className="space-y-1.5">
        {/* 视频轨 */}
        <div className={trackBase}>
          <span className="absolute left-1 top-0.5 z-10 text-[9px] text-[var(--cy-text-tertiary)]">视频</span>
          {segs.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onClipClick?.(s.id)}
              style={{ left: s.leftPx, width: s.widthPx }}
              className="absolute top-3 h-8 rounded border border-[var(--cy-brand-400)] bg-[var(--cy-brand-50)] text-[10px] text-[var(--cy-brand-700)] hover:bg-[var(--cy-brand-100)]"
              title={`片段 ${s.idx}`}
            >
              {s.idx}
            </button>
          ))}
          {segs.length === 0 && (
            <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">
              从下方「加入轨道」添加素材
            </span>
          )}
        </div>
        {/* 音频轨(P2 占位) */}
        <div className={trackBase}>
          <span className="absolute left-1 top-0.5 text-[9px] text-[var(--cy-text-tertiary)]">音频</span>
          <div className="absolute inset-x-1 top-4 h-5 rounded bg-[var(--cy-surface-2)]" />
        </div>
        {/* 字幕轨(P2 占位) */}
        <div className={trackBase}>
          <span className="absolute left-1 top-0.5 text-[9px] text-[var(--cy-text-tertiary)]">字幕</span>
        </div>
      </div>
    </div>
  );
};
