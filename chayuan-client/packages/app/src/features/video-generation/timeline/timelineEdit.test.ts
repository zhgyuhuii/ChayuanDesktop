import { describe, it, expect } from 'vitest';
import { clipDurMs, recomputeStarts, reorderClip, deleteClip, setClipDuration, setClipIn } from './timelineEdit';
import type { VgTimeline } from '@chayuan/api';

const mk = (): VgTimeline => ({
  version: 1, duration_ms: 0,
  tracks: [{ id: 'v', kind: 'video', clips: [
    { id: 'a', source: { path: '/a.mp4' }, track_start_ms: 0, in_ms: 0, out_ms: 3000 },
    { id: 'b', source: { path: '/b.mp4' }, track_start_ms: 3000, in_ms: 0, out_ms: 2000 },
    { id: 'c', source: { path: '/c.mp4' }, track_start_ms: 5000, in_ms: 1000, out_ms: 4000 },
  ] }],
});

it('clipDurMs uses out-in, falls back to duration_ms', () => {
  expect(clipDurMs({ id: 'x', source: {}, track_start_ms: 0, in_ms: 0, out_ms: 3000 })).toBe(3000);
  expect(clipDurMs({ id: 'x', source: {}, track_start_ms: 0, in_ms: 1000, out_ms: 4000 })).toBe(3000);
  expect(clipDurMs({ id: 'x', source: {}, track_start_ms: 0, in_ms: 0, out_ms: 0, duration_ms: 5000 })).toBe(5000);
});

it('recomputeStarts makes clips abut', () => {
  const c = recomputeStarts(mk()).tracks[0]!.clips!;
  expect(c.map((x) => x.track_start_ms)).toEqual([0, 3000, 5000]);
});

it('reorderClip moves c to front and recomputes', () => {
  const c = reorderClip(mk(), 'c', 0).tracks[0]!.clips!;
  expect(c.map((x) => x.id)).toEqual(['c', 'a', 'b']);
  expect(c[0]!.track_start_ms).toBe(0);
  expect(c[1]!.track_start_ms).toBe(3000); // c 时长 4000-1000=3000
});

it('deleteClip removes + recomputes', () => {
  const c = deleteClip(mk(), 'a').tracks[0]!.clips!;
  expect(c.map((x) => x.id)).toEqual(['b', 'c']);
  expect(c[0]!.track_start_ms).toBe(0);
});

it('setClipDuration sets out=in+dur and shifts later starts', () => {
  const t = setClipDuration(mk(), 'a', 1500);
  const a = t.tracks[0]!.clips!.find((x) => x.id === 'a')!;
  expect(a.out_ms! - (a.in_ms ?? 0)).toBe(1500);
  expect(t.tracks[0]!.clips![1]!.track_start_ms).toBe(1500);
});

it('setClipIn shifts in, keeps min duration', () => {
  const c = setClipIn(mk(), 'c', 2000).tracks[0]!.clips!.find((x) => x.id === 'c')!;
  expect(c.in_ms).toBe(2000);
  expect(c.out_ms).toBeGreaterThan(2000);
});
