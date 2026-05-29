import { describe, it, expect } from 'vitest';
import { msToPx, pxToMs, clampPxPerSec, fitPxPerSec, totalDurationMs, PPS_MIN, PPS_MAX } from './timelineScale';
import type { VgTimeline } from '@chayuan/api';

const tl = (clips: { id: string; start: number; out: number }[]): VgTimeline => ({
  version: 1, duration_ms: 0,
  tracks: [{ id: 'v', kind: 'video', clips: clips.map((c) => ({ id: c.id, source: { path: `/${c.id}.mp4` }, track_start_ms: c.start, in_ms: 0, out_ms: c.out })) }],
});

it('msToPx / pxToMs round-trip', () => {
  expect(msToPx(5000, 12)).toBe(60);
  expect(pxToMs(60, 12)).toBe(5000);
});

it('clampPxPerSec bounds', () => {
  expect(clampPxPerSec(1)).toBe(PPS_MIN);
  expect(clampPxPerSec(9999)).toBe(PPS_MAX);
  expect(clampPxPerSec(20)).toBe(20);
});

it('fitPxPerSec fills container for total duration', () => {
  expect(fitPxPerSec(30000, 600)).toBe(20);
  expect(fitPxPerSec(100, 600)).toBe(PPS_MAX);
});

it('totalDurationMs = max(audio, 片段总长)', () => {
  expect(totalDurationMs(tl([{ id: 'a', start: 0, out: 5000 }]), 8000)).toBe(8000);
  expect(totalDurationMs(tl([{ id: 'a', start: 0, out: 6000 }, { id: 'b', start: 6000, out: 4000 }]), 3000)).toBe(10000);
  expect(totalDurationMs(tl([{ id: 'a', start: 0, out: 4000 }]), 0)).toBe(4000);
});
