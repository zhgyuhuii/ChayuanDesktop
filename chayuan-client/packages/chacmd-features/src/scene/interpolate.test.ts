import { describe, expect, it } from 'vitest';
import { type Sample, lerp, sampleHistorical } from './interpolate';

describe('lerp', () => {
  it('端点与中点', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
  it('t 越界被 clamp 到 [0,1]', () => {
    expect(lerp(0, 10, -1)).toBe(0);
    expect(lerp(0, 10, 2)).toBe(10);
  });
});

describe('sampleHistorical', () => {
  const buf: Sample[] = [
    { t: 0, value: 0 },
    { t: 10, value: 100 },
    { t: 20, value: 100 },
  ];

  it('空缓冲 → undefined', () => {
    expect(sampleHistorical([], 5)).toBeUndefined();
  });

  it('单点 → 该点值', () => {
    expect(sampleHistorical([{ t: 5, value: 42 }], 999)).toBe(42);
  });

  it('now 早于首点 → 首点值（clamp）', () => {
    expect(sampleHistorical(buf, -5)).toBe(0);
  });

  it('now 晚于末点 → 末点值（clamp）', () => {
    expect(sampleHistorical(buf, 999)).toBe(100);
  });

  it('区间内线性插值', () => {
    expect(sampleHistorical(buf, 5)).toBe(50);
    expect(sampleHistorical(buf, 2.5)).toBe(25);
  });

  it('相邻同时间戳不除零', () => {
    const b: Sample[] = [
      { t: 10, value: 1 },
      { t: 10, value: 2 },
    ];
    expect(Number.isFinite(sampleHistorical(b, 10) as number)).toBe(true);
  });
});
