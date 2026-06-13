// packages/publisher-core/src/parse.ts
import type { Tier, PlatformKey } from '@chayuan/installer-core';

export interface ParsedPackage {
  product: string; version: string; platform: PlatformKey; tier: Tier; ext: string;
}

export const TIER_VARIANT: Record<Tier, string> = { lite: '轻量版', standard: '集成版', pro: '全量版' };

const TIERS: Tier[] = ['lite', 'standard', 'pro'];
const OSES = ['linux', 'mac', 'win'];
const ARCHES = ['x86_64', 'arm64'];
const EXTS = ['tar.gz', 'tar.zst', 'zip', 'exe', 'dmg', 'AppImage']; // 双段在前,优先匹配

/** 'zip'|'tar.gz'|'tar.zst' → 解压策略;其余(exe/dmg/AppImage)→ 'none'。 */
export function unpackForExt(ext: string): string {
  if (ext === 'zip' || ext === 'tar.gz' || ext === 'tar.zst') return ext;
  return 'none';
}

/** <product>-<version>-<os>-<arch>-<tier>.<ext>,从右往左解析,失败返回 null。 */
export function parsePackageName(filename: string): ParsedPackage | null {
  const ext = EXTS.find((e) => filename.toLowerCase().endsWith('.' + e.toLowerCase()));
  if (!ext) return null;
  const stem = filename.slice(0, filename.length - ext.length - 1); // 去掉 .ext
  const parts = stem.split('-');
  // 末尾依次: tier, arch, os
  if (parts.length < 5) return null;
  const tier = parts[parts.length - 1] as Tier;
  const arch = parts[parts.length - 2];
  const os = parts[parts.length - 3];
  if (!TIERS.includes(tier) || !ARCHES.includes(arch) || !OSES.includes(os)) return null;
  const platform = `${os}-${arch}` as PlatformKey;
  // 剩下 parts[0..n-3) = product + version;version 是最后一段(可能含 -rcN,但 rcN 不会被吃,
  // 因为 os/arch/tier 在更右侧)。从右往左找第一个"看起来像 semver 主体"的段作为 version 起点。
  const head = parts.slice(0, parts.length - 3); // product... + version...
  // version 可能是 '3.0.0' 或 '3.0.0' + 'rc1'(被 '-' 分成两段)。先尝试单段。
  const verIdx = head.findIndex((seg) => /^\d+\.\d+\.\d+/.test(seg));
  if (verIdx < 0) return null;
  const product = head.slice(0, verIdx).join('-');
  if (!product) return null;
  const version = head.slice(verIdx).join('-'); // 3.0.0 或 3.0.0-rc1
  return { product, version, platform, tier, ext };
}
