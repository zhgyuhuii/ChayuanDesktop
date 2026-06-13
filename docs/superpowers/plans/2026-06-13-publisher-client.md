# 察元发布客户端(Publisher) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给维护者一个跨平台桌面 App,登录(用户名/密码/验证码)→ 检测本地构建的各平台各档安装包并对比线上 → 分块上传(带进度/续传)→ 发布 → 生成在线安装器清单。

**Architecture:** 纯 TS 包 `packages/publisher-core`(vitest 全测,无 IO,IO 注入)承载 parse/detect/manifest/publish 逻辑,复用 `@chayuan/installer-core` 的类型/compareVersions/planUpload;`apps/publisher`(Tauri)瘦 Rust 壳只做本地 IO + 网络原语,React 五步向导消费 publisher-core;website 后端零改动,纯复用现成接口。

**Tech Stack:** TypeScript、vitest、React 19、Tauri 2、Rust(reqwest cookie jar / sha2 / tokio)。

**Spec:** `docs/superpowers/specs/2026-06-13-publisher-client-design.md`

**沙箱可验范围:** `packages/publisher-core` 的 vitest + typecheck、`apps/publisher` 的 tsconfig typecheck。**`[BUILD-VERIFY]`**(需 Rust 工具链 + 目标平台,沙箱不可编):Rust 命令、Tauri 窗口、真登录/上传/进度。

**提交纪律(本仓特有):** 此仓 root 所有 + 大量 mode-bit 噪音。每次提交用 `sudo git add <精确文件>` 只暂存改动文件,再 `sudo git commit`,分支 main。完成后 `sudo git push origin main`。

---

## 阶段 A — publisher-core 脚手架 + parse.ts

### Task A1: 建包脚手架(package.json / tsconfig)

**Files:**
- Create: `packages/publisher-core/package.json`
- Create: `packages/publisher-core/tsconfig.json`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "@chayuan/publisher-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest --run"
  },
  "dependencies": {
    "@chayuan/installer-core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: 写 tsconfig.json**(镜像 installer-core,关 noUncheckedIndexedAccess)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "lib": ["ES2023"],
    "noUncheckedIndexedAccess": false
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 安装依赖软链**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm install`
Expected: 成功,`packages/publisher-core/node_modules/@chayuan/installer-core` 软链就位(或 root 级 symlink)。

- [ ] **Step 4: Commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/publisher-core/package.json packages/publisher-core/tsconfig.json pnpm-lock.yaml
sudo git commit -m "chore(publisher-core): 建纯 TS 包脚手架(依赖 installer-core)"
```

---

### Task A2: parse.ts — parsePackageName + unpackForExt + TIER_VARIANT

**Files:**
- Create: `packages/publisher-core/src/parse.ts`
- Test: `packages/publisher-core/src/__tests__/parse.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm vitest --run packages/publisher-core/src/__tests__/parse.test.ts`
Expected: FAIL（`Cannot find module '../parse'`）。

- [ ] **Step 3: 写实现**

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm vitest --run packages/publisher-core/src/__tests__/parse.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: Commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/publisher-core/src/parse.ts packages/publisher-core/src/__tests__/parse.test.ts
sudo git commit -m "feat(publisher-core): parsePackageName 文件名规约解析 + unpackForExt + TIER_VARIANT"
```

---

## 阶段 B — detect.ts(planDetection)

### Task B1: detect.ts — planDetection

**Files:**
- Create: `packages/publisher-core/src/detect.ts`
- Test: `packages/publisher-core/src/__tests__/detect.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/publisher-core/src/__tests__/detect.test.ts
import { describe, it, expect } from 'vitest';
import { planDetection } from '../detect';

const scanned = [
  { path: '/b/chayuan-3.1.0-win-x86_64-pro.zip', filename: 'chayuan-3.1.0-win-x86_64-pro.zip', sizeBytes: 100 },
  { path: '/b/chayuan-3.1.0-linux-x86_64-lite.tar.gz', filename: 'chayuan-3.1.0-linux-x86_64-lite.tar.gz', sizeBytes: 50 },
];

describe('planDetection', () => {
  it('无线上数据时 status=no-online,buildVersion 取 git', () => {
    const p = planDetection({ scanned, gitVersion: '3.1.0' });
    expect(p.status).toBe('no-online');
    expect(p.buildVersion).toBe('3.1.0');
    expect(p.onlineVersion).toBeNull();
    expect(p.items).toHaveLength(2);
  });

  it('本地比线上新 → ahead,未发布项默认勾选', () => {
    const p = planDetection({
      scanned, gitVersion: '3.1.0',
      online: { latest: { version: '3.0.0' }, platforms: {} },
    });
    expect(p.status).toBe('ahead');
    expect(p.items.every((i) => i.selected)).toBe(true);
    expect(p.items.every((i) => i.onlineState === 'new')).toBe(true);
  });

  it('版本相同 → same', () => {
    const p = planDetection({ scanned, gitVersion: '3.1.0', online: { latest: { version: '3.1.0' }, platforms: {} } });
    expect(p.status).toBe('same');
  });

  it('本地比线上旧 → behind', () => {
    const p = planDetection({ scanned, gitVersion: '2.0.0', online: { latest: { version: '3.0.0' }, platforms: {} } });
    expect(p.status).toBe('behind');
  });

  it('已发布项 onlineState=published 且不默认勾选', () => {
    const p = planDetection({
      scanned, gitVersion: '3.1.0',
      adminReleases: [{ version: '3.1.0', platform: 'win-x86_64', variant: '全量版', published: true }],
    });
    const win = p.items.find((i) => i.platform === 'win-x86_64')!;
    expect(win.onlineState).toBe('published');
    expect(win.selected).toBe(false);
  });

  it('已上传未发布 onlineState=exists-unpublished(仍默认勾选)', () => {
    const p = planDetection({
      scanned, gitVersion: '3.1.0',
      adminReleases: [{ version: '3.1.0', platform: 'win-x86_64', variant: '全量版', published: false }],
    });
    const win = p.items.find((i) => i.platform === 'win-x86_64')!;
    expect(win.onlineState).toBe('exists-unpublished');
    expect(win.selected).toBe(true);
  });

  it('解析失败的文件标 needsManual 且不勾选', () => {
    const p = planDetection({ scanned: [{ path: '/b/weird.zip', filename: 'weird.zip', sizeBytes: 1 }] });
    expect(p.items[0].parsed).toBe('needsManual');
    expect(p.items[0].selected).toBe(false);
  });

  it('git 版本与文件版本不一致 → 诊断', () => {
    const p = planDetection({ scanned, gitVersion: '9.9.9' });
    expect(p.diagnostics.some((d) => d.includes('不一致'))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm vitest --run packages/publisher-core/src/__tests__/detect.test.ts`
Expected: FAIL（`Cannot find module '../detect'`）。

- [ ] **Step 3: 写实现**

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm vitest --run packages/publisher-core/src/__tests__/detect.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/publisher-core/src/detect.ts packages/publisher-core/src/__tests__/detect.test.ts
sudo git commit -m "feat(publisher-core): planDetection 检测计划(平台档位矩阵+线上对比+诊断)"
```

---

## 阶段 C — manifest.ts(buildInstallerManifest)

### Task C1: manifest.ts — buildInstallerManifest

**Files:**
- Create: `packages/publisher-core/src/manifest.ts`
- Test: `packages/publisher-core/src/__tests__/manifest.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm vitest --run packages/publisher-core/src/__tests__/manifest.test.ts`
Expected: FAIL（`Cannot find module '../manifest'`）。

- [ ] **Step 3: 写实现**

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm vitest --run packages/publisher-core/src/__tests__/manifest.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/publisher-core/src/manifest.ts packages/publisher-core/src/__tests__/manifest.test.ts
sudo git commit -m "feat(publisher-core): buildInstallerManifest 合成在线安装器清单(每档一组件,可被 resolveComponents 消费)"
```

---

## 阶段 D — publish.ts(runPublish,IO 注入)

### Task D1: publish.ts — runPublish

**Files:**
- Create: `packages/publisher-core/src/publish.ts`
- Test: `packages/publisher-core/src/__tests__/publish.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/publisher-core/src/__tests__/publish.test.ts
import { describe, it, expect } from 'vitest';
import { runPublish, type PublishIO } from '../publish';
import type { DetectItem } from '../detect';

function item(over: Partial<DetectItem>): DetectItem {
  return { filename: 'f', path: '/p', sizeBytes: 8, platform: 'win-x86_64', tier: 'pro',
    version: '3.1.0', parsed: 'ok', onlineState: 'new', selected: true, ...over };
}

function fakeIO(log: string[], opts: { failFinalizeFor?: string } = {}): PublishIO {
  return {
    async initUpload(meta) { log.push(`init:${meta.filename}`); return { uploadId: 'u-' + meta.filename, chunkSize: 4, totalChunks: 2 }; },
    async getReceived() { return []; },
    async putChunk(uploadId, index, isLast) { log.push(`chunk:${uploadId}:${index}:${isLast}`); },
    async finalize(uploadId, body) {
      if (opts.failFinalizeFor && uploadId.includes(opts.failFinalizeFor)) throw new Error('finalize boom');
      log.push(`finalize:${uploadId}:${body.variant}`);
      return { url: '/d/' + uploadId, sha256: 'sh', sizeBytes: 8 };
    },
    async publish(p, v, plat, variant) { log.push(`publish:${plat}:${variant}`); },
    async setPrimary(p, v, plat, variant) { log.push(`setPrimary:${plat}:${variant}`); },
  };
}

describe('runPublish', () => {
  it('单项: init→chunks→finalize→publish 顺序,返回 published 含 url/sha/size', async () => {
    const log: string[] = [];
    const res = await runPublish([item({ filename: 'a' })], fakeIO(log), { product: 'chayuan', version: '3.1.0' });
    expect(res.published).toHaveLength(1);
    expect(res.published[0]).toMatchObject({ platform: 'win-x86_64', tier: 'pro', url: '/d/u-a', sha256: 'sh', sizeBytes: 8 });
    expect(res.failed).toHaveLength(0);
    expect(log).toEqual(['init:a', 'chunk:u-a:0:false', 'chunk:u-a:1:true', 'finalize:u-a:全量版', 'publish:win-x86_64:全量版']);
  });

  it('variant 用档位中文名', async () => {
    const log: string[] = [];
    await runPublish([item({ filename: 'b', tier: 'lite' })], fakeIO(log), { product: 'chayuan', version: '3.1.0' });
    expect(log).toContain('finalize:u-b:轻量版');
  });

  it('某项 finalize 失败不阻断其它项,进 failed', async () => {
    const log: string[] = [];
    const res = await runPublish(
      [item({ filename: 'a' }), item({ filename: 'bad', platform: 'mac-arm64' })],
      fakeIO(log, { failFinalizeFor: 'bad' }), { product: 'chayuan', version: '3.1.0' });
    expect(res.published.map((x) => x.platform)).toEqual(['win-x86_64']);
    expect(res.failed).toEqual([{ filename: 'bad', error: 'finalize boom' }]);
  });

  it('跳过未勾选与 needsManual 项', async () => {
    const log: string[] = [];
    const res = await runPublish(
      [item({ filename: 'a' }), item({ filename: 'skip', selected: false }), item({ filename: 'm', parsed: 'needsManual' })],
      fakeIO(log), { product: 'chayuan', version: '3.1.0' });
    expect(res.published).toHaveLength(1);
    expect(log.some((l) => l.includes('skip') || l.includes(':m'))).toBe(false);
  });

  it('primary 指定时调 setPrimary', async () => {
    const log: string[] = [];
    await runPublish([item({ filename: 'a' })], fakeIO(log), { product: 'chayuan', version: '3.1.0', primaryKeys: ['win-x86_64/pro'] });
    expect(log).toContain('setPrimary:win-x86_64:全量版');
  });

  it('续传: getReceived 返回已收块则跳过', async () => {
    const log: string[] = [];
    const io = fakeIO(log); io.getReceived = async () => [0];
    await runPublish([item({ filename: 'a' })], io, { product: 'chayuan', version: '3.1.0' });
    expect(log).toContain('chunk:u-a:1:true');
    expect(log).not.toContain('chunk:u-a:0:false');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm vitest --run packages/publisher-core/src/__tests__/publish.test.ts`
Expected: FAIL（`Cannot find module '../publish'`）。

- [ ] **Step 3: 写实现**

```ts
// packages/publisher-core/src/publish.ts
import { planUpload, type PlatformKey, type Tier } from '@chayuan/installer-core';
import { TIER_VARIANT } from './parse';
import type { DetectItem } from './detect';

export interface FinalizeResult { url: string; sha256: string; sizeBytes: number; }

export interface PublishIO {
  initUpload(meta: { product: string; version: string; platform: string; filename: string; size: number; sha256?: string }):
    Promise<{ uploadId: string; chunkSize: number; totalChunks: number }>;
  getReceived(uploadId: string): Promise<number[]>;
  /** 读盘第 index 块并 PATCH 上传;isLast 标记末块。 */
  putChunk(uploadId: string, index: number, isLast: boolean): Promise<void>;
  finalize(uploadId: string, body: { variant: string; primary: boolean; notes?: string }): Promise<FinalizeResult>;
  publish(product: string, version: string, platform: string, variant: string): Promise<void>;
  setPrimary(product: string, version: string, platform: string, variant: string): Promise<void>;
  onProgress?(ev: { filename: string; received: number; total: number }): void;
}

export interface PublishedAsset {
  platform: PlatformKey; tier: Tier; url: string; sha256: string; sizeBytes: number; unpack: string;
}
export interface PublishResult {
  published: PublishedAsset[];
  failed: { filename: string; error: string }[];
}

/** 逐项 init→(续传跳块)→putChunk→finalize→publish→(可选 setPrimary)。单项失败隔离进 failed。 */
export async function runPublish(
  items: DetectItem[], io: PublishIO,
  opts: { product: string; version: string; notes?: string; primaryKeys?: string[] },
): Promise<PublishResult> {
  const published: PublishedAsset[] = [];
  const failed: { filename: string; error: string }[] = [];
  const primaryKeys = new Set(opts.primaryKeys ?? []);

  for (const it of items) {
    if (!it.selected || it.parsed !== 'ok' || !it.platform || !it.tier) continue;
    const variant = TIER_VARIANT[it.tier];
    const key = `${it.platform}/${it.tier}`;
    const primary = primaryKeys.has(key);
    try {
      const { uploadId, chunkSize, totalChunks } = await io.initUpload({
        product: opts.product, version: opts.version, platform: it.platform, filename: it.filename, size: it.sizeBytes,
      });
      const plan = planUpload(it.sizeBytes, chunkSize);
      const received = new Set(await io.getReceived(uploadId));
      let done = received.size;
      for (const c of plan.chunks) {
        if (received.has(c.index)) continue;
        await io.putChunk(uploadId, c.index, c.index === totalChunks - 1);
        done++;
        io.onProgress?.({ filename: it.filename, received: done, total: totalChunks });
      }
      const fin = await io.finalize(uploadId, { variant, primary, notes: opts.notes });
      await io.publish(opts.product, opts.version, it.platform, variant);
      if (primary) await io.setPrimary(opts.product, opts.version, it.platform, variant);
      published.push({ platform: it.platform, tier: it.tier, url: fin.url, sha256: fin.sha256, sizeBytes: fin.sizeBytes, unpack: 'none' });
    } catch (e) {
      failed.push({ filename: it.filename, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { published, failed };
}
```

注:`published[].unpack` 这里给占位 `'none'`,UI 层在合成清单前用 `unpackForExt(ext)` 按文件名补正确值(见 Task G)。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm vitest --run packages/publisher-core/src/__tests__/publish.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/publisher-core/src/publish.ts packages/publisher-core/src/__tests__/publish.test.ts
sudo git commit -m "feat(publisher-core): runPublish 编排上传/发布(IO 注入,续传跳块,失败隔离,primary)"
```

---

## 阶段 E — index.ts 导出 + 全绿 + vitest alias

### Task E1: index.ts + vitest alias + 全量验证

**Files:**
- Create: `packages/publisher-core/src/index.ts`
- Modify: `vitest.config.ts`（加 `@chayuan/installer-core` + `@chayuan/publisher-core` alias 指向源码）

- [ ] **Step 1: 写 index.ts**

```ts
// packages/publisher-core/src/index.ts
export { parsePackageName, unpackForExt, TIER_VARIANT, type ParsedPackage } from './parse';
export {
  planDetection,
  type ScannedFile, type OnlineVersion, type AdminRelease, type OnlineState,
  type DetectItem, type DetectionPlan,
} from './detect';
export { buildInstallerManifest, type ManifestAsset } from './manifest';
export {
  runPublish,
  type PublishIO, type FinalizeResult, type PublishedAsset, type PublishResult,
} from './publish';
```

- [ ] **Step 2: 给 vitest.config.ts 加 alias**(避免 publisher-core import installer-core 时预构建)

在 `vitest.config.ts` 的 `resolve.alias` 对象里追加两行：

```ts
      '@chayuan/installer-core': resolve(__dirname, 'packages/installer-core/src/index.ts'),
      '@chayuan/publisher-core': resolve(__dirname, 'packages/publisher-core/src/index.ts'),
```

- [ ] **Step 3: 跑 publisher-core 全量测试**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm vitest --run packages/publisher-core`
Expected: PASS（parse + detect + manifest + publish 全部）。

- [ ] **Step 4: 跑 publisher-core typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/publisher-core typecheck`
Expected: 退出码 0,无错误。

- [ ] **Step 5: 确认不破坏既有全量测试**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm vitest --run`
Expected: 全绿(含 installer-core 既有用例)。

- [ ] **Step 6: Commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add packages/publisher-core/src/index.ts vitest.config.ts
sudo git commit -m "feat(publisher-core): 桶导出 + vitest alias 指向 installer-core/publisher-core 源码"
```

---

## 阶段 F — apps/publisher Tauri 壳(瘦 Rust)`[BUILD-VERIFY]`

> 本阶段 Rust 与 Tauri 窗口沙箱不可编译,标 `[BUILD-VERIFY]`。TS/配置文件可在沙箱写就并 typecheck。

### Task F1: apps/publisher 前端脚手架

**Files:**
- Create: `apps/publisher/package.json`
- Create: `apps/publisher/index.html`
- Create: `apps/publisher/vite.config.ts`
- Create: `apps/publisher/tsconfig.json`
- Create: `apps/publisher/src/main.tsx`

- [ ] **Step 1: package.json**(镜像 installer,加 publisher-core 依赖,端口区分)

```json
{
  "name": "@chayuan/publisher-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "tauri": "tauri"
  },
  "dependencies": {
    "@chayuan/installer-core": "workspace:*",
    "@chayuan/publisher-core": "workspace:*",
    "@tauri-apps/api": "^2.11.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.1.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.2",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: index.html**

```html
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8" /><title>察元发布客户端</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

- [ ] **Step 3: vite.config.ts**(端口 3921,避开 installer 的 3920)

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 3921, strictPort: true },
});
```

- [ ] **Step 4: tsconfig.json**(镜像 installer,只 include src → 不会拉依赖测试)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 5: src/main.tsx**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 6: Commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add apps/publisher/package.json apps/publisher/index.html apps/publisher/vite.config.ts apps/publisher/tsconfig.json apps/publisher/src/main.tsx
sudo git commit -m "chore(publisher-app): 前端脚手架(vite/tsconfig/html/main,端口 3921)"
```

---

### Task F2: src-tauri Rust 壳(命令原语)`[BUILD-VERIFY]`

**Files:**
- Create: `apps/publisher/src-tauri/Cargo.toml`
- Create: `apps/publisher/src-tauri/build.rs`
- Create: `apps/publisher/src-tauri/tauri.conf.json`
- Create: `apps/publisher/src-tauri/src/main.rs`
- Create: `apps/publisher/src-tauri/src/lib.rs`

- [ ] **Step 1: Cargo.toml**(在 installer 依赖基础上加 cookie jar + 无头版 reqwest features)

```toml
[package]
name = "chayuan-publisher"
version = "0.1.0"
edition = "2021"
rust-version = "1.77"

[lib]
name = "chayuan_publisher_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2.0.0", features = [] }

[dependencies]
tauri = { version = "2.11", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", features = ["json", "cookies", "stream", "multipart"] }
tokio = { version = "1", features = ["full"] }
sha2 = "0.10"
futures-util = "0.3"
```

- [ ] **Step 2: build.rs**

```rust
fn main() { tauri_build::build() }
```

- [ ] **Step 3: tauri.conf.json**(产品名/标识/端口对齐 3921)

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "察元发布客户端",
  "version": "0.1.0",
  "identifier": "com.chayuan.publisher",
  "build": { "frontendDist": "../dist", "devUrl": "http://localhost:3921", "beforeDevCommand": "pnpm dev", "beforeBuildCommand": "pnpm build" },
  "app": { "windows": [{ "title": "察元发布客户端", "width": 980, "height": 720 }], "security": { "csp": null } },
  "bundle": { "active": true, "targets": "all", "icon": ["icons/icon.png"] }
}
```

- [ ] **Step 4: src/main.rs**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() { chayuan_publisher_lib::run() }
```

- [ ] **Step 5: src/lib.rs**(命令原语;cookie jar 单例 client)`[BUILD-VERIFY]`

```rust
use std::sync::OnceLock;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Window};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

fn website_base() -> String {
    std::env::var("CHAYUAN_PUBLISHER_BASE").unwrap_or_else(|_| "https://aidooo.com".to_string())
}

// 带 cookie jar 的全局 client,登录 cookie 自动随后续请求。
fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| reqwest::Client::builder().cookie_store(true).build().unwrap())
}

#[derive(Serialize)]
struct Captcha { #[serde(rename = "captchaId")] captcha_id: String, svg: String }

#[tauri::command]
async fn get_captcha() -> Result<Value, String> {
    let url = format!("{}/api/admin/captcha", website_base());
    let r = client().get(&url).send().await.map_err(|e| e.to_string())?;
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    Ok(v)
}

#[tauri::command]
async fn login(username: String, password: String, captcha_id: String, captcha_code: String) -> Result<(), String> {
    let url = format!("{}/api/admin/login", website_base());
    let body = json!({ "username": username, "password": password, "captchaId": captcha_id, "captchaCode": captcha_code });
    let r = client().post(&url).json(&body).send().await.map_err(|e| e.to_string())?;
    if r.status().is_success() { Ok(()) } else {
        let code = r.status().as_u16();
        let v: Value = r.json().await.unwrap_or(json!({}));
        Err(format!("{}:{}", code, v.get("error").and_then(|x| x.as_str()).unwrap_or("login_failed")))
    }
}

#[derive(Serialize)]
struct GitInfo { version: String, changelog: String }

#[tauri::command]
async fn read_git_version(repo: String) -> Result<GitInfo, String> {
    // 优先 VERSION 文件
    let vf = std::path::Path::new(&repo).join("VERSION");
    let version = if let Ok(s) = std::fs::read_to_string(&vf) {
        s.trim().to_string()
    } else {
        let out = std::process::Command::new("git").args(["-C", &repo, "describe", "--tags", "--always"]).output()
            .map_err(|e| e.to_string())?;
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    };
    let log = std::process::Command::new("git").args(["-C", &repo, "log", "-n", "20", "--pretty=format:%h %s"]).output()
        .map_err(|e| e.to_string())?;
    let changelog = String::from_utf8_lossy(&log.stdout).to_string();
    Ok(GitInfo { version, changelog })
}

#[derive(Serialize)]
struct ScannedFile { path: String, filename: String, #[serde(rename = "sizeBytes")] size_bytes: u64 }

#[tauri::command]
async fn scan_build_dir(dir: String) -> Result<Vec<ScannedFile>, String> {
    let mut out = vec![];
    let rd = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for e in rd.flatten() {
        let md = match e.metadata() { Ok(m) => m, Err(_) => continue };
        if !md.is_file() { continue; }
        let filename = e.file_name().to_string_lossy().to_string();
        out.push(ScannedFile { path: e.path().to_string_lossy().to_string(), filename, size_bytes: md.len() });
    }
    Ok(out)
}

#[tauri::command]
async fn hash_file(path: String) -> Result<String, String> {
    let mut f = tokio::fs::File::open(&path).await.map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = f.read(&mut buf).await.map_err(|e| e.to_string())?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

// 通用 JSON 请求:init/finalize/publish/set-primary/version/releases。
#[tauri::command]
async fn http_json(method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    let url = format!("{}{}", website_base(), path);
    let c = client();
    let mut req = match method.to_uppercase().as_str() {
        "GET" => c.get(&url), "POST" => c.post(&url), "PATCH" => c.patch(&url), "DELETE" => c.delete(&url),
        m => return Err(format!("unsupported method {}", m)),
    };
    if let Some(b) = body { req = req.json(&b); }
    let r = req.send().await.map_err(|e| e.to_string())?;
    let status = r.status().as_u16();
    let v: Value = r.json().await.unwrap_or(json!({}));
    if (200..300).contains(&status) { Ok(v) } else { Err(format!("{}:{}", status, v)) }
}

// 上传一个文件的指定块集合(续传时只传缺的),每块后 emit upload-progress。
#[tauri::command]
async fn upload_chunks(window: Window, upload_id: String, upload_path: String, file_path: String,
                       chunk_size: u64, total_chunks: u32, indices: Vec<u32>) -> Result<(), String> {
    let base = website_base();
    let url = format!("{}{}/{}/chunk", base, upload_path, upload_id); // upload_path = /api/admin/uploads
    let mut f = tokio::fs::File::open(&file_path).await.map_err(|e| e.to_string())?;
    let total = indices.len();
    for (done, idx) in indices.into_iter().enumerate() {
        let start = idx as u64 * chunk_size;
        f.seek(std::io::SeekFrom::Start(start)).await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; chunk_size as usize];
        let n = f.read(&mut buf).await.map_err(|e| e.to_string())?;
        buf.truncate(n);
        let r = client().patch(&url)
            .header("X-Chunk-Index", idx.to_string())
            .header("Content-Type", "application/octet-stream")
            .body(buf).send().await.map_err(|e| e.to_string())?;
        if !r.status().is_success() { return Err(format!("chunk {} failed: {}", idx, r.status())); }
        let _ = window.emit("upload-progress", json!({
            "uploadId": upload_id, "received": done + 1, "total": total, "totalChunks": total_chunks,
        }));
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_captcha, login, read_git_version, scan_build_dir, hash_file, http_json, upload_chunks
        ])
        .run(tauri::generate_context!())
        .expect("error while running publisher");
}
```

- [ ] **Step 6: 写 typecheck-only 验证(沙箱可做的部分)**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm install && pnpm --filter @chayuan/publisher-app typecheck`
Expected: 退出码 0(此刻 App.tsx 还没写,会因缺 App 报错 → 把本步骤放到 Task G 之后跑;此处仅 `pnpm install` 让 workspace 链接成立)。

- [ ] **Step 7: Commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add apps/publisher/src-tauri pnpm-lock.yaml
sudo git commit -m "feat(publisher-app): Tauri 瘦 Rust 壳(captcha/login cookie jar/git/scan/hash/http_json/upload_chunks) [BUILD-VERIFY]"
```

---

## 阶段 G — apps/publisher React 五步向导

### Task G1: tauri IO 适配层(把 Rust 命令包成 publisher-core 的 PublishIO)

**Files:**
- Create: `apps/publisher/src/tauriIO.ts`
- Create: `apps/publisher/src/api.ts`

- [ ] **Step 1: api.ts**(包 Rust 命令为 TS 函数)

```ts
// apps/publisher/src/api.ts
import { invoke } from '@tauri-apps/api/core';
import type { ScannedFile, AdminRelease, OnlineVersion } from '@chayuan/publisher-core';

export const getCaptcha = () => invoke<{ captchaId: string; svg: string }>('get_captcha');
export const login = (username: string, password: string, captchaId: string, captchaCode: string) =>
  invoke<void>('login', { username, password, captchaId, captchaCode });
export const readGitVersion = (repo: string) => invoke<{ version: string; changelog: string }>('read_git_version', { repo });
export const scanBuildDir = (dir: string) => invoke<ScannedFile[]>('scan_build_dir', { dir });
export const hashFile = (path: string) => invoke<string>('hash_file', { path });

export const httpJson = <T = unknown>(method: string, path: string, body?: unknown) =>
  invoke<T>('http_json', { method, path, body: body ?? null });

export const fetchOnlineVersion = () => httpJson<OnlineVersion>('GET', '/api/version/chayuan');
export const fetchAdminReleases = async (): Promise<AdminRelease[]> => {
  // GET /api/admin/releases 返回 {products:{chayuan:{ver:{plat:[{variant,published}]}}}},摊平成 AdminRelease[]
  const raw = await httpJson<{ products?: Record<string, Record<string, Record<string, { variant: string; published: boolean }[]>>> }>(
    'GET', '/api/admin/releases');
  const out: AdminRelease[] = [];
  const cy = raw.products?.chayuan ?? {};
  for (const version of Object.keys(cy)) {
    for (const platform of Object.keys(cy[version])) {
      for (const e of cy[version][platform]) out.push({ version, platform, variant: e.variant, published: e.published });
    }
  }
  return out;
};
```

- [ ] **Step 2: tauriIO.ts**(组装 PublishIO,上传走 upload_chunks + emit 进度)

```ts
// apps/publisher/src/tauriIO.ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { PublishIO } from '@chayuan/publisher-core';

const UPLOAD_PATH = '/api/admin/uploads';

/** filePathByName: filename → 本地绝对路径(检测阶段得到)。onProgress 透传给 UI。 */
export function makePublishIO(
  filePathByName: Record<string, string>,
  onProgress: (ev: { filename: string; received: number; total: number }) => void,
): PublishIO {
  let currentFilename = '';
  return {
    async initUpload(meta) {
      currentFilename = meta.filename;
      return invoke('http_json', { method: 'POST', path: `${UPLOAD_PATH}/init`, body: {
        product: meta.product, version: meta.version, platform: meta.platform,
        filename: meta.filename, size: meta.size, sha256: meta.sha256 ?? null,
      } });
    },
    async getReceived(uploadId) {
      const v = await invoke<{ received: number[] }>('http_json', { method: 'GET', path: `${UPLOAD_PATH}/${uploadId}`, body: null });
      return v.received ?? [];
    },
    async putChunk() { /* 实际批量上传见下方 runUpload,这里不单块调用 */ },
    async finalize(uploadId, body) {
      const v = await invoke<{ entry?: { path: string; sha256: string; size: number } }>('http_json', {
        method: 'POST', path: `${UPLOAD_PATH}/${uploadId}/finalize`, body });
      const e = v.entry!;
      return { url: '/downloads/' + e.path, sha256: e.sha256, sizeBytes: e.size };
    },
    async publish(product, version, platform, variant) {
      await invoke('http_json', { method: 'POST',
        path: `/api/admin/releases/${product}/${version}/${platform}/${encodeURIComponent(variant)}/publish`, body: null });
    },
    async setPrimary(product, version, platform, variant) {
      await invoke('http_json', { method: 'POST',
        path: `/api/admin/releases/${product}/${version}/${platform}/${encodeURIComponent(variant)}/set-primary`, body: null });
    },
    onProgress,
    // 暴露给 App:真正的分块上传(绕过 putChunk 逐块,用 Rust 批量 upload_chunks)
    _runUpload: async (uploadId: string, filename: string, chunkSize: number, totalChunks: number, missing: number[]) => {
      const filePath = filePathByName[filename];
      const un = await listen<{ uploadId: string; received: number; total: number }>('upload-progress', (ev) => {
        if (ev.payload.uploadId === uploadId) onProgress({ filename, received: ev.payload.received, total: ev.payload.total });
      });
      try {
        await invoke('upload_chunks', { uploadId, uploadPath: UPLOAD_PATH, filePath, chunkSize, totalChunks, indices: missing });
      } finally { un(); }
    },
  } as PublishIO & { _runUpload: (id: string, fn: string, cs: number, tc: number, missing: number[]) => Promise<void> };
}
```

> 说明:publisher-core 的 `runPublish` 逐块调 `putChunk` 适合纯逻辑测试;真实 app 为减少 JS↔Rust 往返,改用 Rust 端批量 `upload_chunks`。因此 App.tsx **不直接用 runPublish**,而是用 publisher-core 的 `planUpload`(经 installer-core)+ 上面的 `_runUpload` 自行编排上传,再调 IO 的 finalize/publish/setPrimary。`runPublish` 仍作为可测的参考实现与单测覆盖保留。

- [ ] **Step 3: Commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add apps/publisher/src/api.ts apps/publisher/src/tauriIO.ts
sudo git commit -m "feat(publisher-app): Rust 命令 TS 适配层(api + PublishIO,批量 upload_chunks 进度)"
```

---

### Task G2: App.tsx 五步向导 UI

**Files:**
- Create: `apps/publisher/src/App.tsx`

- [ ] **Step 1: 写 App.tsx**(五步:登录→检测→上传→发布→清单)

```tsx
// apps/publisher/src/App.tsx
import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  planDetection, buildInstallerManifest, parsePackageName, unpackForExt, TIER_VARIANT,
  type DetectionPlan, type DetectItem, type PublishedAsset, type ManifestAsset,
} from '@chayuan/publisher-core';
import * as api from './api';
import { makePublishIO } from './tauriIO';

type Step = 1 | 2 | 3 | 4 | 5;

export function App() {
  const [step, setStep] = React.useState<Step>(1);
  // 登录
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [captcha, setCaptcha] = React.useState<{ captchaId: string; svg: string } | null>(null);
  const [captchaCode, setCaptchaCode] = React.useState('');
  const [err, setErr] = React.useState('');
  // 检测
  const [repo, setRepo] = React.useState(() => localStorage.getItem('cy.pub.repo') ?? '');
  const [buildDir, setBuildDir] = React.useState(() => localStorage.getItem('cy.pub.dir') ?? '');
  const [plan, setPlan] = React.useState<DetectionPlan | null>(null);
  // 上传/发布
  const [progress, setProgress] = React.useState<Record<string, { received: number; total: number }>>({});
  const [published, setPublished] = React.useState<PublishedAsset[]>([]);
  const [busy, setBusy] = React.useState(false);

  const refreshCaptcha = React.useCallback(async () => {
    try { setCaptcha(await api.getCaptcha()); } catch (e) { setErr(String(e)); }
  }, []);
  React.useEffect(() => { void refreshCaptcha(); }, [refreshCaptcha]);

  async function doLogin() {
    setErr('');
    try {
      await api.login(username, password, captcha?.captchaId ?? '', captchaCode);
      setStep(2);
    } catch (e) {
      const msg = String(e);
      if (msg.startsWith('429')) setErr('登录过于频繁,请稍后再试');
      else if (msg.includes('captcha')) setErr('验证码错误');
      else setErr('用户名或密码错误');
      void refreshCaptcha();
    }
  }

  async function doDetect() {
    setErr(''); setBusy(true);
    try {
      localStorage.setItem('cy.pub.repo', repo); localStorage.setItem('cy.pub.dir', buildDir);
      const [git, scanned, online, adminReleases] = await Promise.all([
        repo ? api.readGitVersion(repo).catch(() => ({ version: '', changelog: '' })) : Promise.resolve({ version: '', changelog: '' }),
        api.scanBuildDir(buildDir),
        api.fetchOnlineVersion().catch(() => undefined),
        api.fetchAdminReleases().catch(() => undefined),
      ]);
      setPlan(planDetection({ scanned, gitVersion: git.version || undefined, online, adminReleases }));
      setStep(2);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  function toggle(idx: number) {
    if (!plan) return;
    const items = plan.items.map((it, i) => i === idx ? { ...it, selected: !it.selected } : it);
    setPlan({ ...plan, items });
  }
  function setManual(idx: number, patch: Partial<DetectItem>) {
    if (!plan) return;
    const items = plan.items.map((it, i) => i === idx ? { ...it, ...patch, parsed: 'ok' as const } : it);
    setPlan({ ...plan, items });
  }

  async function doUploadPublish() {
    if (!plan || !plan.buildVersion) { setErr('缺少构建版本'); return; }
    setBusy(true); setErr(''); setStep(3);
    const selected = plan.items.filter((it) => it.selected && it.parsed === 'ok' && it.platform && it.tier);
    const filePathByName: Record<string, string> = {};
    for (const it of selected) filePathByName[it.filename] = it.path;
    const io = makePublishIO(filePathByName, (ev) =>
      setProgress((p) => ({ ...p, [ev.filename]: { received: ev.received, total: ev.total } })));
    const out: PublishedAsset[] = [];
    const version = plan.buildVersion;
    for (const it of selected) {
      try {
        const variant = TIER_VARIANT[it.tier!];
        const sha = await api.hashFile(it.path);
        const init = await io.initUpload({ product: 'chayuan', version, platform: it.platform!, filename: it.filename, size: it.sizeBytes, sha256: sha });
        const received = await io.getReceived(init.uploadId);
        const missing = Array.from({ length: init.totalChunks }, (_, i) => i).filter((i) => !received.includes(i));
        // 批量上传缺失块(Rust 端 emit 进度)
        await (io as unknown as { _runUpload: (id: string, fn: string, cs: number, tc: number, m: number[]) => Promise<void> })
          ._runUpload(init.uploadId, it.filename, init.chunkSize, init.totalChunks, missing);
        const fin = await io.finalize(init.uploadId, { variant, primary: it.onlineState === 'new', notes: '' });
        await io.publish('chayuan', version, it.platform!, variant);
        const ext = parsePackageName(it.filename)?.ext ?? '';
        out.push({ platform: it.platform!, tier: it.tier!, url: fin.url, sha256: fin.sha256, sizeBytes: fin.sizeBytes, unpack: unpackForExt(ext) });
      } catch (e) { setErr((prev) => prev + `\n${it.filename}: ${String(e)}`); }
    }
    setPublished(out); setBusy(false); setStep(4);
  }

  async function doManifest() {
    if (!plan?.buildVersion || published.length === 0) return;
    setBusy(true);
    try {
      const assets: ManifestAsset[] = published.map((p) => ({ ...p }));
      const manifest = buildInstallerManifest({ product: 'chayuan', version: plan.buildVersion, assets });
      const json = JSON.stringify(manifest, null, 2);
      const bytes = new TextEncoder().encode(json);
      // 经上传通道把 installer-manifest.json 放到 public/downloads
      const init = await invoke<{ uploadId: string; chunkSize: number; totalChunks: number }>('http_json', {
        method: 'POST', path: '/api/admin/uploads/init',
        body: { product: 'chayuan', version: plan.buildVersion, platform: '_meta', filename: 'installer-manifest.json', size: bytes.length },
      });
      // 单块直传(清单很小):写临时文件再 upload_chunks,或后端允许 finalize 携带内容。
      // 简化:此处复用 upload_chunks 需本地文件,故先让 Rust 写临时文件——交由 Task F 的扩展命令处理。
      await invoke('http_json', { method: 'POST', path: `/api/admin/uploads/${init.uploadId}/finalize`,
        body: { variant: 'manifest', primary: true, notes: '' } });
      setStep(5);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  // ---- 渲染(精简,核心结构;样式可后续打磨)----
  return (
    <div style={{ fontFamily: 'system-ui', padding: 20, maxWidth: 920, margin: '0 auto' }}>
      <h2>察元发布客户端</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['登录', '检测', '上传', '发布', '清单'] as const).map((label, i) => (
          <span key={label} style={{ fontWeight: step === i + 1 ? 700 : 400, color: step >= i + 1 ? '#2563eb' : '#999' }}>
            {i + 1}.{label}
          </span>
        ))}
      </div>
      {err && <pre style={{ color: '#dc2626', whiteSpace: 'pre-wrap' }}>{err}</pre>}

      {step === 1 && (
        <div style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
          <input placeholder="用户名" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input placeholder="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input placeholder="验证码" value={captchaCode} onChange={(e) => setCaptchaCode(e.target.value)} />
            <span onClick={refreshCaptcha} style={{ cursor: 'pointer' }} dangerouslySetInnerHTML={{ __html: captcha?.svg ?? '' }} />
          </div>
          <button onClick={doLogin}>登录</button>
        </div>
      )}

      {step === 2 && (
        <div>
          <div style={{ display: 'grid', gap: 8, maxWidth: 560, marginBottom: 12 }}>
            <input placeholder="git 仓路径(取版本/changelog)" value={repo} onChange={(e) => setRepo(e.target.value)} />
            <input placeholder="构建产物目录" value={buildDir} onChange={(e) => setBuildDir(e.target.value)} />
            <button onClick={doDetect} disabled={busy || !buildDir}>检测</button>
          </div>
          {plan && (
            <>
              <p>本地 {plan.buildVersion ?? '?'} ↔ 线上 {plan.onlineVersion ?? '无'}（{plan.status}）</p>
              {plan.diagnostics.map((d, i) => <p key={i} style={{ color: '#d97706' }}>⚠ {d}</p>)}
              <table style={{ width: '100%', fontSize: 13 }}>
                <thead><tr><th></th><th>文件</th><th>平台</th><th>档位</th><th>线上</th></tr></thead>
                <tbody>
                  {plan.items.map((it, i) => (
                    <tr key={it.filename}>
                      <td><input type="checkbox" checked={it.selected} onChange={() => toggle(i)} /></td>
                      <td>{it.filename}</td>
                      <td>{it.platform ?? <input placeholder="平台" onBlur={(e) => setManual(i, { platform: e.target.value as DetectItem['platform'] })} />}</td>
                      <td>{it.tier ?? <select onChange={(e) => setManual(i, { tier: e.target.value as DetectItem['tier'] })}>
                        <option value="">选档</option><option value="lite">轻量版</option><option value="standard">集成版</option><option value="pro">全量版</option></select>}</td>
                      <td>{it.onlineState}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={doUploadPublish} disabled={busy}>上传并发布勾选项</button>
            </>
          )}
        </div>
      )}

      {step === 3 && (
        <div>
          <h3>上传中…</h3>
          {Object.entries(progress).map(([fn, p]) => (
            <div key={fn}>{fn}: {p.received}/{p.total}
              <progress value={p.received} max={p.total} style={{ width: '100%' }} /></div>
          ))}
        </div>
      )}

      {step === 4 && (
        <div>
          <h3>已发布 {published.length} 个离线包</h3>
          <ul>{published.map((p) => <li key={p.platform + p.tier}>{p.platform} / {TIER_VARIANT[p.tier]} → {p.url}</li>)}</ul>
          <button onClick={doManifest} disabled={busy}>生成并发布在线安装器清单</button>
        </div>
      )}

      {step === 5 && (
        <div>
          <h3>✅ 完成</h3>
          <p>本次离线包已发布,在线安装器清单已更新。</p>
          <ul>{published.map((p) => <li key={p.platform + p.tier}>{p.url}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm install && pnpm --filter @chayuan/publisher-app typecheck`
Expected: 退出码 0。若报 `@tauri-apps/api/core` 缺类型,确认 `@tauri-apps/api` 已在 deps 且 `pnpm install` 过。

- [ ] **Step 3: Commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add apps/publisher/src/App.tsx pnpm-lock.yaml
sudo git commit -m "feat(publisher-app): 五步向导 UI(登录/检测矩阵/上传进度/发布/生成清单)"
```

---

### Task G3: 清单上传需要的 Rust 扩展命令 `[BUILD-VERIFY]`

> App.tsx 的 `doManifest` 需把内存里的 JSON 字节经上传通道落地。最简做法:加一个 Rust 命令把字节写临时文件,再走 upload_chunks。

**Files:**
- Modify: `apps/publisher/src-tauri/src/lib.rs`

- [ ] **Step 1: 加 write_temp + 注册**

在 lib.rs 加命令并加入 invoke_handler:

```rust
#[tauri::command]
async fn write_temp(filename: String, contents: Vec<u8>) -> Result<String, String> {
    let dir = std::env::temp_dir().join("chayuan-publisher");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join(&filename);
    std::fs::write(&p, &contents).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().to_string())
}
```

`invoke_handler` 追加 `write_temp`：

```rust
.invoke_handler(tauri::generate_handler![
    get_captcha, login, read_git_version, scan_build_dir, hash_file, http_json, upload_chunks, write_temp
])
```

- [ ] **Step 2: App.tsx doManifest 用 write_temp + upload_chunks 实传清单**

把 `doManifest` 里 init 之后、finalize 之前补上真实上传：

```tsx
      const tmpPath = await invoke<string>('write_temp', { filename: 'installer-manifest.json', contents: Array.from(bytes) });
      await invoke('upload_chunks', { uploadId: init.uploadId, uploadPath: '/api/admin/uploads', filePath: tmpPath,
        chunkSize: init.chunkSize, totalChunks: init.totalChunks, indices: Array.from({ length: init.totalChunks }, (_, i) => i) });
```

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/publisher-app typecheck`
Expected: 退出码 0。

- [ ] **Step 4: Commit**

```bash
cd /work/chayuan-desktop/chayuan-client
sudo git add apps/publisher/src-tauri/src/lib.rs apps/publisher/src/App.tsx
sudo git commit -m "feat(publisher-app): write_temp 命令 + 清单经上传通道实传 [BUILD-VERIFY]"
```

---

## 阶段 H — 收尾验证

### Task H1: 全量验证 + 不回归

- [ ] **Step 1: publisher-core 全测**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm vitest --run packages/publisher-core`
Expected: 全绿。

- [ ] **Step 2: 全 workspace 测试不回归**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm vitest --run`
Expected: 全绿。

- [ ] **Step 3: 全 workspace typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm -r typecheck`
Expected: 全绿(apps/publisher、publisher-core、apps/web、apps/desktop、apps/installer 均过)。

- [ ] **Step 4: `[BUILD-VERIFY]` 清单(交构建机)**

记录到最终汇报,需在有 Rust 工具链 + 各目标平台的机器验:
- `cd apps/publisher && pnpm tauri build`(各平台);
- 真实登录(验证码)、检测本地目录、分块上传带进度、发布、生成并上传 installer-manifest.json;
- 用户端 apps/installer 拉新清单按档下载验证闭环。

- [ ] **Step 5: 最终 Commit(若有遗留)**

```bash
cd /work/chayuan-desktop/chayuan-client
git status --short
# 如有未提交改动,sudo git add <精确文件> && sudo git commit && sudo git push origin main
```

---

## 自审清单(写完计划后已核对)

- **Spec 覆盖**:登录(F2.login/get_captcha + G2 step1)、检测(B1 planDetection + G2 doDetect + Rust scan/git)、上传进度续传(D1 runPublish 参考 + G2 doUploadPublish + F2 upload_chunks)、发布(api publish/set-primary)、在线清单(C1 buildInstallerManifest + G2/G3 doManifest)、离线包=上传文件本身(G2)、文件名规约(A2)、平台键对齐(复用 installer-core 类型)、错误处理(G2 登录/限流/失败隔离)、测试(A-D vitest + H typecheck)——均有任务对应。
- **占位扫描**:无 TBD/TODO,代码块完整。
- **类型一致**:`Tier/PlatformKey/InstallerManifest/PlatformAsset/ManifestComponent` 全从 `@chayuan/installer-core` import;`DetectItem/DetectionPlan/PublishIO/PublishedAsset/ManifestAsset` 在 publisher-core 定义并经 index.ts 导出;App 用名一致。
- **复用不复制**:compareVersions/planUpload/resolveComponents/类型全复用 installer-core,未重写。
- **已知取舍**:App.tsx 为减少 JS↔Rust 往返,用 Rust 批量 `upload_chunks` 而非逐块 `putChunk`,故 `runPublish` 作可测参考实现保留、App 自行编排;已在 G1 注明。
