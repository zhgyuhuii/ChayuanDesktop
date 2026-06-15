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
