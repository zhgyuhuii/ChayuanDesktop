import { describe, it, expect } from 'vitest';
import { addTrack, removeTrack, setClipTransform } from './timelineTracks';

const tl = () => ({ version: 1, duration_ms: 0, tracks: [
  { id: 'v', kind: 'video' as const, clips: [{ id: 'a', source: { path: '/a.mp4' }, track_start_ms: 0, in_ms: 0, out_ms: 0 }] },
] });

it('addTrack appends a removable empty track of given kind', () => {
  const t = addTrack(tl(), 'video');
  const added = t.tracks[t.tracks.length - 1]!;
  expect(added.kind).toBe('video');
  expect(added.clips).toEqual([]);
  expect(added.removable).toBe(true);
});

it('removeTrack removes only removable tracks', () => {
  const t = addTrack(tl(), 'audio');
  const addedId = t.tracks[t.tracks.length - 1]!.id;
  const r = removeTrack(t, addedId);
  expect(r.tracks.some((x) => x.id === addedId)).toBe(false);
  const r2 = removeTrack(r, 'v');
  expect(r2.tracks.some((x) => x.id === 'v')).toBe(true);
});

it('setClipTransform clamps x/y in [0,1], scale in [0.05,1]', () => {
  const base = { version: 1, duration_ms: 0, tracks: [
    { id: 'v2', kind: 'video' as const, removable: true, clips: [{ id: 'p', source: { path: '/p.mp4' }, track_start_ms: 0, in_ms: 0, out_ms: 0 }] },
  ] };
  const r = setClipTransform(base, 'p', { x: 1.5, y: -0.2, scale: 2 });
  const c = r.tracks[0]!.clips!.find((x) => x.id === 'p')!;
  expect(c.x).toBe(1); expect(c.y).toBe(0); expect(c.scale).toBe(1);
  const r2 = setClipTransform(base, 'p', { scale: 0.01 });
  expect(r2.tracks[0]!.clips!.find((x) => x.id === 'p')!.scale).toBe(0.05);
});
