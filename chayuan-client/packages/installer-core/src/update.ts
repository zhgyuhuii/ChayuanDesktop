import { isVersionNewer } from './version';

/** version-routes 响应里一个平台的发布信息。 */
export interface VersionPlatform {
  version: string;
  primaryUrl: string;
  variants: { variant: string; primary: boolean; url: string; notes: string }[];
}
export interface VersionResponse {
  product: string;
  latest: { version: string };
  platforms: Record<string, VersionPlatform>;
}

export interface UpdateOpts {
  currentVersion: string;
  os: 'linux' | 'mac' | 'win';
  arch: 'x86_64' | 'arm64';
  preferVariant?: string;
}
export interface UpdateDecision {
  available: boolean;
  latestVersion?: string;
  downloadUrl?: string;
  variant?: string;
  notes?: string;
}

/** layout 维度 (os,arch) → website 发布平台键。 */
export function toReleasePlatform(os: 'linux' | 'mac' | 'win', arch: 'x86_64' | 'arm64'): string {
  const osMap: Record<string, string> = { win: 'windows', mac: 'mac', linux: 'linux' };
  const archMap: Record<string, Record<string, string>> = {
    win: { x86_64: 'amd64', arm64: 'arm64' },
    mac: { x86_64: 'x64', arm64: 'arm64' },
    linux: { x86_64: 'amd64', arm64: 'arm64' },
  };
  return `${osMap[os]}-${archMap[os][arch]}`;
}

/** 给定 version-routes 响应 + 本地版本/平台 → 是否有更新 + 下载链接。 */
export function decideUpdate(resp: VersionResponse, opts: UpdateOpts): UpdateDecision {
  const key = toReleasePlatform(opts.os, opts.arch);
  const plat = resp.platforms?.[key];
  if (!plat) return { available: false };
  if (!isVersionNewer(plat.version, opts.currentVersion)) return { available: false };
  let chosen = plat.variants.find((v) => v.primary) ?? plat.variants[0];
  if (opts.preferVariant) {
    const pref = plat.variants.find((v) => v.variant === opts.preferVariant);
    if (pref) chosen = pref;
  }
  return {
    available: true,
    latestVersion: plat.version,
    downloadUrl: chosen?.url ?? plat.primaryUrl,
    variant: chosen?.variant,
    notes: chosen?.notes,
  };
}
