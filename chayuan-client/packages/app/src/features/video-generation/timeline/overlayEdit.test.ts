import { describe, it, expect } from 'vitest';
import { addOverlay, patchOverlay, deleteOverlay } from './overlayEdit';

const t0 = { version: 1, duration_ms: 0, tracks: [] } as any;

describe('overlayEdit', () => {
  it('addOverlay 加文字默认 3s', () => {
    const { timeline, id } = addOverlay(t0, 'text', 1000);
    expect(timeline.overlays!.length).toBe(1);
    expect(timeline.overlays![0]!.duration_ms).toBe(3000);
    expect(timeline.overlays![0]!.track_start_ms).toBe(1000);
    expect(id).toBeTruthy();
  });
  it('patchOverlay clamp', () => {
    const { timeline, id } = addOverlay(t0, 'text', 0);
    const o = patchOverlay(timeline, id, { x: 2, opacity: -1, w: 0, duration_ms: 50 }).overlays![0]!;
    expect(o.x).toBe(1); expect(o.opacity).toBe(0); expect(o.w).toBe(0.02); expect(o.duration_ms).toBe(200);
  });
  it('deleteOverlay', () => {
    const { timeline, id } = addOverlay(t0, 'text', 0);
    expect(deleteOverlay(timeline, id).overlays!.length).toBe(0);
  });
});
