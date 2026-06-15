import { describe, it, expect } from 'vitest';
import { mergeUnifiedVideos } from './unifiedVideos';

const vg = [
  { video_id: 'a', task_id: 'ta', title: '图文', path: '/x/final.mp4', duration_ms: 1000,
    width: 1080, height: 1920, created_at: 2000, params_snapshot: {}, owner_id: null, thumbnail_path: null },
] as any;
const dh = { items: [
  { task_id: 'd1', state: 'complete', progress: 100, created_at: 3, name: '数人A', result_path: '/y.mp4', error: '' },
  { task_id: 'd2', state: 'processing', progress: 63, created_at: 1, name: '数人B', result_path: '', error: '' },
] } as any;

describe('mergeUnifiedVideos', () => {
  it('已完成按 createdAt 倒序混排(DH 秒→毫秒)', () => {
    const { completed } = mergeUnifiedVideos(vg, dh);
    expect(completed.map((v) => v.key)).toEqual(['dh:d1', 'vg:a']); // d1=3000ms > a=2000ms
    expect(completed[0]!.source).toBe('dh');
  });
  it('进行中的数字人任务进 active 区', () => {
    const { active } = mergeUnifiedVideos(vg, dh);
    expect(active.map((v) => v.key)).toEqual(['dh:d2']);
    expect(active[0]!.progress).toBe(63);
    expect(active[0]!.state).toBe('processing');
  });
  it('source 可用于筛选', () => {
    const { completed } = mergeUnifiedVideos(vg, dh);
    expect(completed.filter((v) => v.source === 'vg').length).toBe(1);
    expect(completed.filter((v) => v.source === 'dh').length).toBe(1);
  });
});
