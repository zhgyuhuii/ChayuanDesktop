// packages/publisher-core/src/detect.ts
import { compareVersions, type Tier, type PlatformKey } from '@chayuan/installer-core';
import { parsePackageName, TIER_VARIANT } from './parse';

export interface ScannedFile { path: string; filename: string; sizeBytes: number; sha256?: string; }

export interface OnlineVersion {
  latest?: { version: string };
  platforms: Record<string, { version: string; variants: { variant: string; primary: boolean; url: string }[] }>;
}

/** 管理员 releases 列表项(从 GET /api/admin/releases 摊平,product 默认 chayuan)。 */
export interface AdminRelease { version: string; platform: string; variant: string; published: boolean; }

export type OnlineState = 'new' | 'exists-unpublished' | 'published';

export interface DetectItem {
  filename: string; path: string; sizeBytes: number;
  platform: PlatformKey | null; tier: Tier | null; version: string | null;
  parsed: 'ok' | 'needsManual';
  onlineState: OnlineState;
  selected: boolean;
}

export interface DetectionPlan {
  buildVersion: string | null;
  onlineVersion: string | null;
  status: 'ahead' | 'same' | 'behind' | 'no-online';
  items: DetectItem[];
  diagnostics: string[];
}

function mode(values: string[]): string | null {
  const count = new Map<string, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  let best: string | null = null; let bestN = 0;
  for (const [v, n] of count) if (n > bestN) { best = v; bestN = n; }
  return best;
}

export function planDetection(input: {
  scanned: ScannedFile[]; gitVersion?: string; online?: OnlineVersion; adminReleases?: AdminRelease[];
}): DetectionPlan {
  const { scanned, gitVersion, online, adminReleases } = input;
  const diagnostics: string[] = [];

  const parsedList = scanned.map((f) => ({ f, p: parsePackageName(f.filename) }));
  const fileVersions = parsedList.map((x) => x.p?.version).filter((v): v is string => !!v);
  const buildVersion = gitVersion ?? mode(fileVersions);
  const onlineVersion = online?.latest?.version ?? null;

  let status: DetectionPlan['status'];
  if (!onlineVersion || !buildVersion) status = onlineVersion ? 'behind' : 'no-online';
  else { const c = compareVersions(buildVersion, onlineVersion); status = c > 0 ? 'ahead' : c < 0 ? 'behind' : 'same'; }

  // git 版本与文件版本不一致诊断
  if (gitVersion && fileVersions.some((v) => v !== gitVersion)) {
    diagnostics.push(`本地 git 版本(${gitVersion})与部分构建包版本不一致`);
  }
  // 重复 (platform,tier) 诊断
  const seen = new Set<string>();
  for (const { p } of parsedList) {
    if (!p) continue;
    const key = `${p.platform}/${p.tier}`;
    if (seen.has(key)) diagnostics.push(`重复产物:${key} 出现多次`);
    seen.add(key);
  }

  const items: DetectItem[] = parsedList.map(({ f, p }) => {
    if (!p) {
      return { filename: f.filename, path: f.path, sizeBytes: f.sizeBytes,
        platform: null, tier: null, version: null, parsed: 'needsManual', onlineState: 'new', selected: false };
    }
    const variant = TIER_VARIANT[p.tier];
    let onlineState: OnlineState = 'new';
    if (adminReleases) {
      const rec = adminReleases.find((r) => r.version === p.version && r.platform === p.platform && r.variant === variant);
      onlineState = rec ? (rec.published ? 'published' : 'exists-unpublished') : 'new';
    } else if (online) {
      const plat = online.platforms[p.platform];
      onlineState = plat?.variants.some((v) => v.variant === variant) ? 'published' : 'new';
    }
    return { filename: f.filename, path: f.path, sizeBytes: f.sizeBytes,
      platform: p.platform, tier: p.tier, version: p.version,
      parsed: 'ok', onlineState, selected: onlineState !== 'published' };
  });

  return { buildVersion, onlineVersion, status, items, diagnostics };
}
