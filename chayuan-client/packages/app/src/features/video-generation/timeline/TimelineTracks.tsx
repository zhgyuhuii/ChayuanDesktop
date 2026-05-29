import * as React from 'react';
import { Film, Mic, Captions, Music } from 'lucide-react';
import type { VgTimeline } from '@chayuan/api';
import type { SrtCue } from './srtParse';
import { msToPx } from './timelineScale';
import { TimeRuler } from './TimeRuler';
import { Playhead } from './Playhead';
import { TrackHeader, TRACK_H } from './TrackHeader';
import { VgTimeline as VideoTrack } from './VgTimeline';
import { AudioWaveTrack } from './AudioWaveTrack';
import { SubtitleCueTrack } from './SubtitleCueTrack';
import { BgmTrack } from './BgmTrack';

const HEADER_W = 64;
const RULER_H = 24;

export const TimelineTracks: React.FC<{
  timeline: VgTimeline;
  durationMs: number;
  pxPerSec: number;
  playheadMs: number;
  peaks: number[];
  peaksLoading?: boolean;
  cues: SrtCue[];
  bgmName: string | null;
  thumbUrlOf?: (clipIndex: number) => string | null;
  onSeekMs: (ms: number) => void;
  onTimelineChange: (t: VgTimeline) => void;
}> = ({ timeline, durationMs, pxPerSec, playheadMs, peaks, peaksLoading, cues, bgmName, thumbUrlOf, onSeekMs, onTimelineChange }) => {
  const contentWidthPx = Math.max(240, msToPx(durationMs, pxPerSec));
  const lanesH = TRACK_H * 4;

  return (
    <div className="flex rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]">
      {/* 左:固定轨道头列 */}
      <div className="shrink-0 border-r border-[var(--cy-border-subtle)]" style={{ width: HEADER_W }}>
        <div style={{ height: RULER_H }} className="border-b border-[var(--cy-border-subtle)]" />
        <TrackHeader label="视频" icon={<Film className="h-3 w-3" />} />
        <TrackHeader label="旁白" icon={<Mic className="h-3 w-3" />} />
        <TrackHeader label="字幕" icon={<Captions className="h-3 w-3" />} />
        <TrackHeader label="音乐" icon={<Music className="h-3 w-3" />} />
      </div>
      {/* 右:单横向滚动容器(ruler + lanes + playhead 共享坐标系) */}
      <div className="relative flex-1 overflow-x-auto cy-hide-scrollbar">
        <div style={{ width: contentWidthPx }}>
          <TimeRuler durationMs={durationMs} pxPerSec={pxPerSec} contentWidthPx={contentWidthPx} onSeekMs={onSeekMs} />
          <div className="relative" style={{ height: lanesH }}>
            {/* 视频轨(可编辑 + 缩略图) */}
            <div style={{ height: TRACK_H }} className="border-b border-[var(--cy-border-subtle)]">
              <VideoTrack timeline={timeline} editable videoTrackOnly pxPerSec={pxPerSec}
                thumbUrlOf={thumbUrlOf} onChange={onTimelineChange} />
            </div>
            <AudioWaveTrack peaks={peaks} contentWidthPx={contentWidthPx} loading={peaksLoading} />
            <SubtitleCueTrack cues={cues} pxPerSec={pxPerSec} contentWidthPx={contentWidthPx} />
            <BgmTrack bgmName={bgmName} contentWidthPx={contentWidthPx} />
            {/* 播放头贯穿四轨 */}
            <Playhead playheadMs={playheadMs} pxPerSec={pxPerSec} heightPx={lanesH} durationMs={durationMs} onSeekMs={onSeekMs} />
          </div>
        </div>
      </div>
    </div>
  );
};
