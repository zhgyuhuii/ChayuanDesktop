// packages/publisher-core/src/__tests__/parse.test.ts
import { describe, it, expect } from 'vitest';
import { parsePackageName, unpackForExt, TIER_VARIANT } from '../parse';

describe('parsePackageName', () => {
  it('解析标准文件名', () => {
    expect(parsePackageName('chayuan-3.0.0-win-x86_64-pro.zip')).toEqual({
      product: 'chayuan', version: '3.0.0', platform: 'win-x86_64', tier: 'pro', ext: 'zip',
    });
  });
  it('解析 tar.gz 双段扩展名', () => {
    expect(parsePackageName('chayuan-3.0.0-linux-x86_64-standard.tar.gz')).toEqual({
      product: 'chayuan', version: '3.0.0', platform: 'linux-x86_64', tier: 'standard', ext: 'tar.gz',
    });
  });
  it('产品名含连字符也能从右往左解析', () => {
    expect(parsePackageName('chayuan-desktop-3.0.0-mac-arm64-lite.tar.gz')).toEqual({
      product: 'chayuan-desktop', version: '3.0.0', platform: 'mac-arm64', tier: 'lite', ext: 'tar.gz',
    });
  });
  it('semver 预发布版本', () => {
    expect(parsePackageName('chayuan-3.0.0-rc1-mac-x86_64-pro.dmg')?.version).toBe('3.0.0-rc1');
  });
  it('非白名单扩展名返回 null', () => {
    expect(parsePackageName('chayuan-3.0.0-win-x86_64-pro.txt')).toBeNull();
  });
  it('缺字段返回 null', () => {
    expect(parsePackageName('chayuan-3.0.0-pro.zip')).toBeNull();
  });
  it('非法 tier 返回 null', () => {
    expect(parsePackageName('chayuan-3.0.0-win-x86_64-ultra.zip')).toBeNull();
  });
});

describe('unpackForExt', () => {
  it('归档类返回对应解压策略', () => {
    expect(unpackForExt('zip')).toBe('zip');
    expect(unpackForExt('tar.gz')).toBe('tar.gz');
    expect(unpackForExt('tar.zst')).toBe('tar.zst');
  });
  it('可执行/镜像类返回 none', () => {
    expect(unpackForExt('exe')).toBe('none');
    expect(unpackForExt('dmg')).toBe('none');
    expect(unpackForExt('AppImage')).toBe('none');
  });
});

describe('TIER_VARIANT', () => {
  it('档位到中文显示名', () => {
    expect(TIER_VARIANT).toEqual({ lite: '轻量版', standard: '集成版', pro: '全量版' });
  });
});
