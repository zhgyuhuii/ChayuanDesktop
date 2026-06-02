import { describe, it, expect } from 'vitest';
import { estimateDurationMs } from './estimateDuration';

describe('estimateDurationMs', () => {
  it('counts chars / (4.5*rate)', () => {
    expect(estimateDurationMs('九个字的一段话啊', 1)).toBe(Math.round((8 / 4.5) * 1000));
  });
  it('faster rate → shorter', () => {
    expect(estimateDurationMs('一二三四五六七八九', 1.5)).toBeLessThan(
      estimateDurationMs('一二三四五六七八九', 1),
    );
  });
  it('empty → 0', () => {
    expect(estimateDurationMs('', 1)).toBe(0);
  });
});
