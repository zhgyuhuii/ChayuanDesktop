// packages/publisher-core/src/__tests__/manifest.test.ts
import { describe, it, expect } from 'vitest';
import { buildInstallerManifest } from '../manifest';
import { resolveComponents } from '@chayuan/installer-core';

describe('buildInstallerManifest', () => {
  const assets = [
    { platform: 'win-x86_64' as const, tier: 'pro' as const, url: '/d/win-pro.zip', sha256: 'a', sizeBytes: 9, unpack: 'zip' },
    { platform: 'mac-arm64' as const, tier: 'pro' as const, url: '/d/mac-pro.tar.gz', sha256: 'b', sizeBytes: 8, unpack: 'tar.gz' },
    { platform: 'win-x86_64' as const, tier: 'lite' as const, url: '/d/win-lite.zip', sha256: 'c', sizeBytes: 3, unpack: 'zip' },
  ];

  it('按档位分组,每档一个组件', () => {
    const m = buildInstallerManifest({ product: 'chayuan', version: '3.1.0', assets });
    expect(m.version).toBe('3.1.0');
    const names = m.components.map((c) => c.name).sort();
    expect(names).toEqual(['chayuan-lite', 'chayuan-pro']);
    const pro = m.components.find((c) => c.name === 'chayuan-pro')!;
    expect(pro.tiers).toEqual(['pro']);
    expect(pro.platforms['win-x86_64']).toEqual({ url: '/d/win-pro.zip', sha256: 'a', sizeBytes: 9, unpack: 'zip' });
    expect(pro.platforms['mac-arm64']).toEqual({ url: '/d/mac-pro.tar.gz', sha256: 'b', sizeBytes: 8, unpack: 'tar.gz' });
  });

  it('产物可被 installer-core 的 resolveComponents 消费', () => {
    const m = buildInstallerManifest({ product: 'chayuan', version: '3.1.0', assets });
    const resolved = resolveComponents(m, { tier: 'pro', os: 'win', arch: 'x86_64' });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].url).toBe('/d/win-pro.zip');
  });
});
