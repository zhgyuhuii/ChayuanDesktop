import type { InstallerManifest, ResolvedComponent, Selection, PlatformKey } from './types';

/** 给定 (tier, os, arch),解析出实际要下载的组件列表。
 *  规则:组件 tiers 含 tier 且该平台键有资产 → 收;否则跳过(optional 与否都跳,缺资产无从下)。 */
export function resolveComponents(manifest: InstallerManifest, sel: Selection): ResolvedComponent[] {
  const key = `${sel.os}-${sel.arch}` as PlatformKey;
  const out: ResolvedComponent[] = [];
  for (const c of manifest.components) {
    if (!c.tiers.includes(sel.tier)) continue;
    const asset = c.platforms[key];
    if (!asset) continue;
    out.push({
      name: c.name,
      dest: c.dest,
      url: asset.url,
      sha256: asset.sha256,
      unpack: asset.unpack,
      sizeBytes: asset.sizeBytes,
    });
  }
  return out;
}
