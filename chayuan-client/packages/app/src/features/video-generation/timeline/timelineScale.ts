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

/** 时间轴画布总时长 = max(旁白音频时长, 视频片段总长)。 */
export function totalDurationMs(t: VgTimeline, audioDurationMs: number): number {
  return Math.max(audioDurationMs || 0, videoSumMs(t));
}
