import { describe, it, expect } from 'vitest';
import { msToPx, pxToMs, clampPxPerSec, fitPxPerSec, totalDurationMs, rulerDurationMs, PPS_MIN, PPS_MAX } from './timelineScale';
import type { VgTimeline } from '@chayuan/api';

const tl = (clips: { id: string; start: number; out: number }[], audioClips: { id: string; start: number; out: number }[] = []): VgTimeline => ({
  version: 1, duration_ms: 0,
  tracks: [
    { id: 'v', kind: 'video', clips: clips.map((c) => ({ id: c.id, source: { path: `/${c.id}.mp4` }, track_start_ms: c.start, in_ms: 0, out_ms: c.out })) },
    { id: 'a', kind: 'audio', clips: audioClips.map((c) => ({ id: c.id, source: { path: `/${c.id}.mp3` }, track_start_ms: c.start, in_ms: 0, out_ms: c.out })) },
  ],
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

it('totalDurationMs = max(audio, 片段总长, 插入音频末尾)', () => {
  expect(totalDurationMs(tl([{ id: 'a', start: 0, out: 5000 }]), 8000)).toBe(8000);
  expect(totalDurationMs(tl([{ id: 'a', start: 0, out: 6000 }, { id: 'b', start: 6000, out: 4000 }]), 3000)).toBe(10000);
  expect(totalDurationMs(tl([{ id: 'a', start: 0, out: 4000 }]), 0)).toBe(4000);
  // 插入音频在 9000 处放 4000ms → 末尾 13000,超过视频/旁白
  expect(totalDurationMs(tl([{ id: 'a', start: 0, out: 5000 }], [{ id: 's', start: 9000, out: 4000 }]), 6000)).toBe(13000);
});

it('rulerDurationMs adds small headroom, floors at 15s', () => {
  expect(rulerDurationMs(0)).toBe(15000);
  expect(rulerDurationMs(100000)).toBe(106000); // +6s headroom
});
