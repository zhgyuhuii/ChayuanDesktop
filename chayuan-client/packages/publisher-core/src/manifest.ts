// packages/publisher-core/src/manifest.ts
import type { InstallerManifest, ManifestComponent, PlatformKey, Tier, PlatformAsset } from '@chayuan/installer-core';

export interface ManifestAsset {
  platform: PlatformKey; tier: Tier; url: string; sha256: string; sizeBytes: number; unpack: string;
}

/** 把"每平台每档一个离线包"合成用户端在线安装器清单:每档一个组件,platforms 映射到该平台的离线包。 */
export function buildInstallerManifest(input: { product: string; version: string; assets: ManifestAsset[] }): InstallerManifest {
  const { product, version, assets } = input;
  const byTier = new Map<Tier, ManifestComponent>();
  for (const a of assets) {
    let comp = byTier.get(a.tier);
    if (!comp) {
      comp = { name: `${product}-${a.tier}`, tiers: [a.tier], dest: '.', platforms: {} };
      byTier.set(a.tier, comp);
    }
    const asset: PlatformAsset = { url: a.url, sha256: a.sha256, sizeBytes: a.sizeBytes, unpack: a.unpack };
    comp.platforms[a.platform] = asset;
  }
  return { version, components: [...byTier.values()] };
}
