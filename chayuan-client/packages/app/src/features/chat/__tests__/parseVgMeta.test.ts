import { describe, it, expect } from 'vitest';
import { parseAndStripVgMeta } from '../parseVgMeta';

describe('parseAndStripVgMeta', () => {
  it('returns content unchanged when no sentinel', () => {
    const r = parseAndStripVgMeta('hello world');
    expect(r.text).toBe('hello world');
    expect(r.videoMeta).toBeUndefined();
  });

  it('extracts videoMeta and strips sentinel', () => {
    const input = 'hello\n\n[[VG_META]]{"videoMeta":{"renderState":"idle"}}[[/VG_META]]';
    const r = parseAndStripVgMeta(input);
    expect(r.text).toBe('hello');
    expect(r.videoMeta).toEqual({ renderState: 'idle' });
  });

  it('returns content unchanged on JSON parse error', () => {
    const input = 'hello [[VG_META]]not json[[/VG_META]]';
    const r = parseAndStripVgMeta(input);
    expect(r.text).toBe(input);
    expect(r.videoMeta).toBeUndefined();
  });

  it('handles multi-line sentinel content', () => {
    const input = 'script\n[[VG_META]]\n{"videoMeta":{"taskId":"abc","renderState":"running"}}\n[[/VG_META]]';
    const r = parseAndStripVgMeta(input);
    expect(r.text).toBe('script');
    expect(r.videoMeta?.taskId).toBe('abc');
    expect(r.videoMeta?.renderState).toBe('running');
  });

  it('extracts only first sentinel if multiple present (defensive)', () => {
    const input = 'a [[VG_META]]{"videoMeta":{"renderState":"idle"}}[[/VG_META]] b [[VG_META]]{"videoMeta":{"renderState":"running"}}[[/VG_META]]';
    const r = parseAndStripVgMeta(input);
    expect(r.videoMeta?.renderState).toBe('idle'); // 第一个匹配
  });
});
