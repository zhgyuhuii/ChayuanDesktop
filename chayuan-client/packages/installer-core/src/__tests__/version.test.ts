import { describe, it, expect } from 'vitest';
import { compareVersions, isVersionNewer } from '../version';

describe('compareVersions', () => {
  it('数字段大小', () => {
    expect(compareVersions('3.0.1', '3.0.0')).toBe(1);
    expect(compareVersions('3.0.0', '3.0.1')).toBe(-1);
    expect(compareVersions('3.1.0', '3.0.9')).toBe(1);
    expect(compareVersions('3.0.0', '3.0.0')).toBe(0);
  });
  it('缺位补 0:3.0 == 3.0.0', () => {
    expect(compareVersions('3.0', '3.0.0')).toBe(0);
    expect(compareVersions('3.0.0.1', '3.0.0')).toBe(1);
  });
  it('build 元数据忽略', () => {
    expect(compareVersions('3.0.0+build9', '3.0.0')).toBe(0);
  });
  it('prerelease < release', () => {
    expect(compareVersions('3.0.0-beta', '3.0.0')).toBe(-1);
    expect(compareVersions('3.0.0', '3.0.0-beta')).toBe(1);
  });
  it('prerelease 段逐段比', () => {
    expect(compareVersions('3.0.0-beta.2', '3.0.0-beta.1')).toBe(1);
    expect(compareVersions('3.0.0-alpha', '3.0.0-beta')).toBe(-1);
  });
});

describe('isVersionNewer', () => {
  it('latest 更新返 true', () => {
    expect(isVersionNewer('3.0.1', '3.0.0')).toBe(true);
    expect(isVersionNewer('3.0.0', '3.0.0')).toBe(false);
    expect(isVersionNewer('3.0.0-beta', '3.0.0')).toBe(false);
  });
});
