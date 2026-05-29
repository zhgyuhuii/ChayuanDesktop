import type { VgTimeline } from '@chayuan/api';
import { clipDurMs } from './timelineEdit';

/** zoom 范围:px/秒。下限保证长视频可见全貌,上限保证可精修。 */
export const PPS_MIN = 4;
export const PPS_MAX = 120;

export const msToPx = (ms: number, pxPerSec: number): number => (ms / 1000) * pxPerSec;
export const pxToMs = (px: number, pxPerSec: number): number => Math.round((px / pxPerSec) * 1000);

export const clampPxPerSec = (pps: number): number => Math.max(PPS_MIN, Math.min(PPS_MAX, pps));

/** 让 totalMs 时长正好填满 containerPx 宽的 px/秒(夹在合法范围)。 */
export function fitPxPerSec(totalMs: number, containerPx: number): number {
  const sec = Math.max(0.001, totalMs / 1000);
  return clampPxPerSec(containerPx / sec);
}

/** 视频轨片段总长(紧贴拼接,用 clipDurMs)。 */
function videoSumMs(t: VgTimeline): number {
  const clips = (t.tracks || []).find((tr) => tr.kind === 'video')?.clips ?? [];
  return clips.reduce((acc, c) => acc + clipDurMs(c), 0);
}

/** 插入音频轨最右 clip 的结束(track_start + clipDurMs);无则 0。 */
function audioTrackEndMs(t: VgTimeline): number {
  const clips = (t.tracks || []).find((tr) => tr.kind === 'audio')?.clips ?? [];
  return clips.reduce((acc, c) => Math.max(acc, c.track_start_ms + clipDurMs(c)), 0);
}

/** 合成内容总时长 = max(旁白音频时长, 视频片段总长, 插入音频末尾)。
 *  与后端 _timeline_audio_end_s 口径一致(含旁白取最右,不截断)。 */
export function totalDurationMs(t: VgTimeline, audioDurationMs: number): number {
  return Math.max(audioDurationMs || 0, videoSumMs(t), audioTrackEndMs(t));
}

/** 标尺富余:画布向后延伸的额外时长,让用户能把元素放到当前内容之后。 */
export const RULER_HEADROOM_MS = 15000;
const RULER_MIN_MS = 60000;

/** 标尺/画布展示时长 = max(内容末尾+富余, 最小 60s)。内容增长则画布跟着向后延伸。 */
export function rulerDurationMs(contentMs: number): number {
  return Math.max(RULER_MIN_MS, contentMs + RULER_HEADROOM_MS);
}
