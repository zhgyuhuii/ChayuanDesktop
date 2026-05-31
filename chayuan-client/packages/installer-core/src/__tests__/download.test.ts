import { describe, it, expect } from 'vitest';
import { resumeRange, verifySha, nextMirror } from '../download';

describe('resumeRange', () => {
  it('未下完 → 返回从 localBytes 起的 Range 头', () => {
    expect(resumeRange(0, 1000)).toEqual({ offset: 0, header: 'bytes=0-' });
    expect(resumeRange(400, 1000)).toEqual({ offset: 400, header: 'bytes=400-' });
  });
  it('已下完(local>=total)→ null', () => {
    expect(resumeRange(1000, 1000)).toBeNull();
    expect(resumeRange(1200, 1000)).toBeNull();
  });
  it('total 未知(0/负)→ 从 0 全量下', () => {
    expect(resumeRange(0, 0)).toEqual({ offset: 0, header: 'bytes=0-' });
  });
});

describe('verifySha', () => {
  it('期望为空 → 跳过校验视为通过', () => {
    expect(verifySha(undefined, 'abc')).toBe(true);
    expect(verifySha('', 'abc')).toBe(true);
  });
  it('大小写不敏感比对', () => {
    expect(verifySha('ABcd', 'abcd')).toBe(true);
    expect(verifySha('aaaa', 'bbbb')).toBe(false);
  });
});

describe('nextMirror', () => {
  it('返回下一个候选,越界返回 null', () => {
    const c = ['u0', 'u1'];
    expect(nextMirror(c, 0)).toBe('u1');
    expect(nextMirror(c, 1)).toBeNull();
  });
});
