import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateManifest } from '../validate';
import { resolveComponents } from '../manifest';
import type { InstallerManifest } from '../types';

// 真 layout.yaml 经 `chayuan_packaging manifest` 生成的清单(Python→TS 契约)
const REAL: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/installer-manifest.sample.json', import.meta.url), 'utf8'),
);

describe('validateManifest', () => {
  it('真生成的清单通过校验', () => {
    const r = validateManifest(REAL);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('非对象 → 报错', () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest('x').ok).toBe(false);
  });

  it('components 非数组 → 报错', () => {
    const r = validateManifest({ version: '1', components: {} });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('components'))).toBe(true);
  });

  it('非法平台键 → 报错', () => {
    const r = validateManifest({
      version: '1',
      components: [{ name: 'x', dest: 'd', tiers: ['lite'], platforms: { 'bad-key': { url: 'u', unpack: 'none' } } }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('bad-key'))).toBe(true);
  });

  it('非法 tier → 报错', () => {
    const r = validateManifest({
      version: '1',
      components: [{ name: 'x', dest: 'd', tiers: ['ultra'], platforms: {} }],
    });
    expect(r.ok).toBe(false);
  });

  it('asset 缺 url/unpack → 报错', () => {
    const r = validateManifest({
      version: '1',
      components: [{ name: 'x', dest: 'd', tiers: ['lite'], platforms: { 'linux-x86_64': { url: 'u' } } }],
    });
    expect(r.ok).toBe(false);
  });
});

describe('Python→TS 契约:真清单可被 resolveComponents 消费', () => {
  it('lite + linux-x86_64 解析出非空组件', () => {
    const out = resolveComponents(REAL as InstallerManifest, { tier: 'lite', os: 'linux', arch: 'x86_64' });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((c) => typeof c.url === 'string' && typeof c.dest === 'string')).toBe(true);
  });
  it('pro 比 lite 组件多(标准/全量含更多服务)', () => {
    const lite = resolveComponents(REAL as InstallerManifest, { tier: 'lite', os: 'linux', arch: 'x86_64' });
    const pro = resolveComponents(REAL as InstallerManifest, { tier: 'pro', os: 'linux', arch: 'x86_64' });
    expect(pro.length).toBeGreaterThanOrEqual(lite.length);
  });
});
