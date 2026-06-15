import type { VgTimeline, VgOverlay } from '@chayuan/api';

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
let _seq = 0;

/** 新建叠加元素(画面中心默认框、时长 3s、起点 = atMs)。返回新时间轴 + 新元素 id。 */
export function addOverlay(t: VgTimeline, type: VgOverlay['type'], atMs: number, src?: string): { timeline: VgTimeline; id: string } {
  const id = `ov-${Math.round(atMs)}-${_seq++}`;
  const isShape = type === 'rect' || type === 'ellipse' || type === 'line' || type === 'arrow';
  const noFill = type === 'line' || type === 'arrow';
  const ov: VgOverlay = {
    id, type, track_start_ms: Math.max(0, Math.round(atMs)), duration_ms: 3000,
    x: 0.25, y: 0.4, w: isShape ? 0.3 : 0.5, h: 0.2, rotation: 0, opacity: 1, z: 0,
    text: type === 'text' ? '双击编辑文字' : '', font_size: 48,
    text_color: '#ffffff',
    stroke_color: isShape ? '#ffffff' : '#000000',
    stroke_width: isShape ? 3 : 1.5,
    align: 'center',
    fill: isShape ? (noFill ? null : '#ffffff33') : undefined,
    corner_radius: 0,
    ...(type === 'image' ? { w: 0.3, h: 0.3, stroke_width: 0, src } : {}),
    ...(type === 'mosaic' ? { w: 0.3, h: 0.2, stroke_width: 0 } : {}),
  };
  return { timeline: { ...t, overlays: [...(t.overlays || []), ov] }, id };
}

export type OverlayPatch = Partial<Omit<VgOverlay, 'id'>>;

/** 叠加元素写入唯一入口(带 clamp)。 */
export function patchOverlay(t: VgTimeline, id: string, patch: OverlayPatch): VgTimeline {
  return {
    ...t,
    overlays: (t.overlays || []).map((o) => {
      if (o.id !== id) return o;
      const n: VgOverlay = { ...o, ...patch };
      if (patch.x !== undefined) n.x = clampN(patch.x, 0, 1);
      if (patch.y !== undefined) n.y = clampN(patch.y, 0, 1);
      if (patch.w !== undefined) n.w = clampN(patch.w, 0.02, 1);
      if (patch.h !== undefined) n.h = clampN(patch.h, 0.02, 1);
      if (patch.opacity !== undefined) n.opacity = clampN(patch.opacity, 0, 1);
      if (patch.rotation !== undefined) n.rotation = clampN(patch.rotation, -180, 180);
      if (patch.duration_ms !== undefined) n.duration_ms = Math.max(200, Math.round(patch.duration_ms));
      if (patch.track_start_ms !== undefined) n.track_start_ms = Math.max(0, Math.round(patch.track_start_ms));
      return n;
    }),
  };
}

export function deleteOverlay(t: VgTimeline, id: string): VgTimeline {
  return { ...t, overlays: (t.overlays || []).filter((o) => o.id !== id) };
}

/** 关键帧间插值出当前位置(playhead);<2 关键帧返回静态 x/y。 */
export function overlayPosAt(ov: VgOverlay, playheadMs: number): { x: number; y: number; w: number; h: number } {
  const kfs = (ov.keyframes || []).slice().sort((a, b) => a.t - b.t);
  const base = { x: ov.x, y: ov.y, w: ov.w, h: ov.h };
  if (kfs.length < 2) return base;
  const kw = (k: { w?: number }) => k.w ?? ov.w;
  const kh = (k: { h?: number }) => k.h ?? ov.h;
  const rel = ov.duration_ms > 0 ? clampN((playheadMs - ov.track_start_ms) / ov.duration_ms, 0, 1) : 0;
  const first = kfs[0]!; const last = kfs[kfs.length - 1]!;
  if (rel <= first.t) return { x: first.x, y: first.y, w: kw(first), h: kh(first) };
  if (rel >= last.t) return { x: last.x, y: last.y, w: kw(last), h: kh(last) };
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!; const b = kfs[i + 1]!;
    if (a.t <= rel && rel <= b.t) {
      const f = b.t > a.t ? (rel - a.t) / (b.t - a.t) : 0;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, w: kw(a) + (kw(b) - kw(a)) * f, h: kh(a) + (kh(b) - kh(a)) * f };
    }
  }
  return base;
}

/** 在 playhead 处记录一个位置关键帧(用元素当前 x/y);同位置(t 接近)的覆盖。 */
export function addKeyframe(t: VgTimeline, id: string, playheadMs: number): VgTimeline {
  const ov = (t.overlays || []).find((o) => o.id === id);
  if (!ov) return t;
  const rel = ov.duration_ms > 0 ? clampN((playheadMs - ov.track_start_ms) / ov.duration_ms, 0, 1) : 0;
  const kfs = [...(ov.keyframes || []).filter((k) => Math.abs(k.t - rel) > 0.01), { t: rel, x: ov.x, y: ov.y, w: ov.w, h: ov.h }].sort((a, b) => a.t - b.t);
  return patchOverlay(t, id, { keyframes: kfs });
}

export function clearKeyframes(t: VgTimeline, id: string): VgTimeline {
  return patchOverlay(t, id, { keyframes: [] });
}
