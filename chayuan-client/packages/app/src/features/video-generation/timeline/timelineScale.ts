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

/** 某 kind 的所有轨里「最后一个元素的结束」(track_start + clipDurMs 的最大值)。 */
function trackKindEndMs(t: VgTimeline, kind: 'video' | 'audio'): number {
  let end = 0;
  for (const tr of (t.tracks || [])) {
    if (tr.kind !== kind) continue;
    for (const c of (tr.clips || [])) end = Math.max(end, c.track_start_ms + clipDurMs(c));
  }
  return end;
}

/** 合成内容总时长 = max(旁白音频时长, 所有视频轨最后元素末尾, 所有音频轨最后元素末尾)。
 *  #24:以「最后占位元素」的末尾计,而非仅主视频轨长度。 */
export function totalDurationMs(t: VgTimeline, audioDurationMs: number): number {
  return Math.max(audioDurationMs || 0, trackKindEndMs(t, 'video'), trackKindEndMs(t, 'audio'));
}

/** 标尺富余:画布向后延伸的额外时长,让用户能把元素放到当前内容之后。 */
export const RULER_HEADROOM_MS = 6000;
const RULER_MIN_MS = 15000;

/** 标尺/画布展示时长 = 内容末尾 + 小富余(贴着内容,避免短内容被撑出大片空白)。
 *  内容增长则画布跟着延伸;空时给最小 15s 便于起步拖入。 */
export function rulerDurationMs(contentMs: number): number {
  return Math.max(RULER_MIN_MS, contentMs + RULER_HEADROOM_MS);
}
