import { describe, it, expect } from 'vitest';
import { clipDurMs, recomputeStarts, reorderClip, deleteClip, setClipDuration, setClipIn, setClipStart, normalizeMontage } from './timelineEdit';
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

it('appendClipFromMaterial 主轨 drop 不广播到其它视频轨(#13 回归)', () => {
  const base: VgTimeline = { version: 1, duration_ms: 0, tracks: [
    { id: 'v', kind: 'video', clips: [{ id: 'a', source: { path: '/a.mp4' }, track_start_ms: 0, in_ms: 0, out_ms: 3000 }] },
    { id: 'v2', kind: 'video', removable: true, clips: [] },
  ] };
  const r = appendClipFromMaterial(base, { materialId: 'm1', kind: 'video', durationMs: 2000 });
  expect(r.tracks[0]!.clips!.length).toBe(2); // 主轨 a + 新 clip
  expect(r.tracks[1]!.clips!.length).toBe(0); // 附加轨仍为空,不被广播
});

it('setClipDuration 改 PIP/附加轨 clip 时长 — 只改本轨 out_ms,不动主轨、不重排起点(回归)', () => {
  const base: VgTimeline = { version: 1, duration_ms: 0, tracks: [
    { id: 'v', kind: 'video', clips: [
      { id: 'a', source: { path: '/a.mp4' }, track_start_ms: 0, in_ms: 0, out_ms: 3000 },
      { id: 'b', source: { path: '/b.mp4' }, track_start_ms: 3000, in_ms: 0, out_ms: 2000 },
    ] },
    { id: 'v2', kind: 'video', removable: true, clips: [
      { id: 'p', source: { material_id: 'm1' }, track_start_ms: 1500, in_ms: 0, out_ms: 4000 },
    ] },
  ] };
  const r = setClipDuration(base, 'p', 1000);
  // PIP clip 时长改成 1000,track_start_ms 保持 1500(自由定位,不被重排到 0)
  expect(r.tracks[1]!.clips![0]!.out_ms).toBe(1000);
  expect(r.tracks[1]!.clips![0]!.track_start_ms).toBe(1500);
  // 主轨原封不动
  expect(r.tracks[0]!.clips!.map((c) => c.track_start_ms)).toEqual([0, 3000]);
});

it('setClipDuration 改主轨 clip 时长 — 顺排重算后续起点(montage 行为不变)', () => {
  const base: VgTimeline = { version: 1, duration_ms: 0, tracks: [
    { id: 'v', kind: 'video', clips: [
      { id: 'a', source: { path: '/a.mp4' }, track_start_ms: 0, in_ms: 0, out_ms: 3000 },
      { id: 'b', source: { path: '/b.mp4' }, track_start_ms: 3000, in_ms: 0, out_ms: 2000 },
    ] },
  ] };
  const r = setClipDuration(base, 'a', 5000);
  expect(r.tracks[0]!.clips![0]!.out_ms).toBe(5000);
  expect(r.tracks[0]!.clips![1]!.track_start_ms).toBe(5000); // b 顺排到 a 之后
});

it('setClipStart 自由移动任意轨 clip;normalizeMontage 按 start 重排紧贴', () => {
  const base: VgTimeline = { version: 1, duration_ms: 0, tracks: [
    { id: 'v', kind: 'video', clips: [
      { id: 'a', source: {}, track_start_ms: 0, in_ms: 0, out_ms: 3000 },
      { id: 'b', source: {}, track_start_ms: 3000, in_ms: 0, out_ms: 2000 },
    ] },
  ] };
  const moved = setClipStart(base, 'a', 9999); // a 拖到 b 之后
  const norm = normalizeMontage(moved).tracks[0]!.clips!;
  expect(norm.map((c) => c.id)).toEqual(['b', 'a']);
  expect(norm.map((c) => c.track_start_ms)).toEqual([0, 2000]);
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

import { appendClipFromMaterial } from './timelineEdit';

it('appendClipFromMaterial: image default 3000ms, video default 5000ms', () => {
  const empty = { version: 1, duration_ms: 0, tracks: [{ id: 'v', kind: 'video' as const, clips: [] }] };
  const t1 = appendClipFromMaterial(empty, { materialId: 'm1', kind: 'image' });
  const c1 = t1.tracks[0]!.clips![0]!;
  expect(c1.source).toEqual({ material_id: 'm1' });
  expect(c1.out_ms).toBe(3000);
  const t2 = appendClipFromMaterial(empty, { url: 'http://e/v.mp4', kind: 'video' });
  const c2 = t2.tracks[0]!.clips![0]!;
  expect(c2.source).toEqual({ url: 'http://e/v.mp4' });
  expect(c2.out_ms).toBe(0);
});

it('appendClipFromMaterial: explicit durationMs wins, appends + recomputes starts', () => {
  const base = { version: 1, duration_ms: 0, tracks: [{ id: 'v', kind: 'video' as const, clips: [
    { id: 'a', source: { path: '/a.mp4' }, track_start_ms: 0, in_ms: 0, out_ms: 4000 },
  ] }] };
  const t = appendClipFromMaterial(base, { materialId: 'm2', kind: 'image', durationMs: 2000 });
  const clips = t.tracks[0]!.clips!;
  expect(clips).toHaveLength(2);
  expect(clips[1]!.out_ms).toBe(2000);
  expect(clips[1]!.track_start_ms).toBe(4000);
});

it('appendClipFromMaterial: atIndex inserts', () => {
  const base = { version: 1, duration_ms: 0, tracks: [{ id: 'v', kind: 'video' as const, clips: [
    { id: 'a', source: { path: '/a.mp4' }, track_start_ms: 0, in_ms: 0, out_ms: 4000 },
  ] }] };
  const t = appendClipFromMaterial(base, { url: 'http://e/x.mp4', kind: 'video' }, 0);
  expect(t.tracks[0]!.clips!.map((c) => c.source)).toEqual([{ url: 'http://e/x.mp4' }, { path: '/a.mp4' }]);
});

import { replaceClipSource, appendAudioClip } from './timelineEdit';

it('replaceClipSource swaps source, keeps timing', () => {
  const t = { version: 1, duration_ms: 0, tracks: [{ id: 'v', kind: 'video' as const, clips: [
    { id: 'a', source: { path: '/a.mp4' }, track_start_ms: 0, in_ms: 500, out_ms: 4000 },
  ] }] };
  const r = replaceClipSource(t, 'a', { material_id: 'm9' });
  const c = r.tracks[0]!.clips!.find((x) => x.id === 'a')!;
  expect(c.source).toEqual({ material_id: 'm9' });
  expect(c.in_ms).toBe(500);
  expect(c.out_ms).toBe(4000);
});

it('appendAudioClip adds to audio track at end', () => {
  const t = { version: 1, duration_ms: 0, tracks: [{ id: 'v', kind: 'video' as const, clips: [] }] };
  const r = appendAudioClip(t, { materialId: 'snd1', kind: 'audio', durationMs: 3000 });
  const atr = r.tracks.find((x) => x.kind === 'audio')!;
  expect(atr.clips).toHaveLength(1);
  expect(atr.clips![0]!.source).toEqual({ material_id: 'snd1' });
  expect(atr.clips![0]!.out_ms).toBe(3000);
  const r2 = appendAudioClip(r, { url: 'http://e/s2.mp3', kind: 'audio', durationMs: 2000 });
  const atr2 = r2.tracks.find((x) => x.kind === 'audio')!;
  expect(atr2.clips![1]!.track_start_ms).toBe(3000);
});

import { deleteAnyClip } from './timelineEdit';

it('deleteAnyClip removes from audio track too', () => {
  const t = { version: 1, duration_ms: 0, tracks: [
    { id: 'v', kind: 'video' as const, clips: [{ id: 'a', source: { path: '/a.mp4' }, track_start_ms: 0, in_ms: 0, out_ms: 3000 }] },
    { id: 'au', kind: 'audio' as const, clips: [{ id: 's1', source: { url: 'x' }, track_start_ms: 0, in_ms: 0, out_ms: 2000 }] },
  ] };
  const r = deleteAnyClip(t, 's1');
  expect(r.tracks.find((x) => x.kind === 'audio')!.clips).toHaveLength(0);
  expect(r.tracks.find((x) => x.kind === 'video')!.clips).toHaveLength(1);
});

import { patchClip } from './timelineEdit';

const tlPip = (): VgTimeline => ({
  version: 1, duration_ms: 0,
  tracks: [
    { id: 'v', kind: 'video', clips: [{ id: 'a', source: {}, track_start_ms: 0, in_ms: 0, out_ms: 3000 }] },
    { id: 'v2', kind: 'video', removable: true, clips: [{ id: 'b', source: {}, track_start_ms: 0, in_ms: 0, out_ms: 2000, x: 0.5, y: 0.1, scale: 0.4, z: 1 }] },
  ],
});

it('patchClip 设 opacity 并 clamp 到 [0,1]', () => {
  expect(patchClip(tlPip(), 'b', { opacity: 1.5 }).tracks[1]!.clips![0]!.opacity).toBe(1);
  expect(patchClip(tlPip(), 'b', { opacity: -0.3 }).tracks[1]!.clips![0]!.opacity).toBe(0);
});

it('patchClip clamp scale[0.05,1] / x,y[0,1] / z 取整', () => {
  const c = patchClip(tlPip(), 'b', { scale: 2, x: -0.2, y: 1.4, z: 2.7 }).tracks[1]!.clips![0]!;
  expect(c.scale).toBe(1);
  expect(c.x).toBe(0);
  expect(c.y).toBe(1);
  expect(c.z).toBe(3);
});

it('patchClip volume clamp 到 [0,1.5]', () => {
  expect(patchClip(tlPip(), 'a', { volume: 5 }).tracks[0]!.clips![0]!.volume).toBe(1.5);
});

it('patchClip 只改目标 clip,其它 clip/轨不动', () => {
  const r = patchClip(tlPip(), 'b', { muted: true });
  expect(r.tracks[0]!.clips![0]).toEqual(tlPip().tracks[0]!.clips![0]);
  expect(r.tracks[1]!.clips![0]!.muted).toBe(true);
});
