# 察元下载构建器 P3(检查更新)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** 皮/已装产品消费 website `GET /api/version/:product`,用 semver 比对本地版本决定是否提示升级,给出对应 (os,arch,变体) 的下载链接;真下载+原子替换为 Rust 命令(`[BUILD-VERIFY]`)。

**Architecture:** 版本比对做成纯 TS(installer-core,vitest 可验,不引 semver 依赖、自实现受控版本号比较);平台键映射(layout.yaml `win-x86_64` ↔ website `windows-amd64`)纯函数;真下载+原子替换复用 P1 `download_file` + 新 Rust `apply_update`(`[BUILD-VERIFY]`)。

**Tech Stack:** TypeScript(installer-core,vitest)/ Rust(`[BUILD-VERIFY]`)。承接 P0-P2;消费 website `version-routes`(已有 + `semver`)。

---

## ⚠ 本机可验证边界
- ✅ vitest:`compareVersions` / `isVersionNewer` / `toReleasePlatform` / `decideUpdate`。
- ❌ `[BUILD-VERIFY]`:Rust `apply_update`(下载新包→校验→原子替换运行中的安装)、真窗口提示。

---

## 文件结构
- `chayuan-client/packages/installer-core/src/version.ts`(建):`compareVersions(a,b)` + `isVersionNewer(latest,current)`。
- `chayuan-client/packages/installer-core/src/update.ts`(建):`toReleasePlatform(os,arch)` + `decideUpdate(resp, opts)`。
- `chayuan-client/packages/installer-core/src/index.ts`(改):导出 version + update。
- `chayuan-client/packages/installer-core/src/__tests__/{version,update}.test.ts`(建)。
- `chayuan-client/apps/installer/src-tauri/src/lib.rs`(改):`apply_update` 命令(`[BUILD-VERIFY]`)。
- `chayuan-client/apps/installer/src/App.tsx`(改):「检查更新」按钮(消费 decideUpdate)。

---

## Task 1: 版本号比较(纯函数,vitest)

**Files:**
- Create `chayuan-client/packages/installer-core/src/version.ts`
- Modify `chayuan-client/packages/installer-core/src/index.ts`
- Test `chayuan-client/packages/installer-core/src/__tests__/version.test.ts`

> 受控版本号方案(website `VERSION_RE = /^\d+(\.\d+){0,3}([+-][a-zA-Z0-9.]+)?$/`):数字段 `x.y.z[.w]` + 可选 `-prerelease` / `+build`。自实现比较(不引 semver 依赖,保持 installer-core 零运行时依赖):忽略 `+build`;先比数字段(缺位补 0);相等时**无 prerelease > 有 prerelease**;都有 prerelease 逐段比(纯数字段按数值,否则字典序)。

- [ ] **Step 1: 写失败测试**
```typescript
// chayuan-client/packages/installer-core/src/__tests__/version.test.ts
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
```

- [ ] **Step 2: 跑确认失败**
Run: `cd chayuan-client && npx vitest --run packages/installer-core/src/__tests__/version.test.ts`

- [ ] **Step 3: 实现 version.ts**
```typescript
interface Parsed { nums: number[]; pre: string[]; }

function parse(v: string): Parsed {
  const noBuild = v.split('+')[0];
  const [rel, pre] = noBuild.split('-', 2);
  const nums = rel.split('.').map((s) => parseInt(s, 10) || 0);
  return { nums, pre: pre ? pre.split('.') : [] };
}

function cmpNums(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function cmpPre(a: string[], b: string[]): number {
  // 无 prerelease > 有 prerelease(release 大)
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = parseInt(x, 10) - parseInt(y, 10);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** 版本号比较:a<b→-1, a==b→0, a>b→1。忽略 +build;prerelease < release。 */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  const c = cmpNums(pa.nums, pb.nums);
  if (c !== 0) return c;
  return cmpPre(pa.pre, pb.pre);
}

/** latest 是否比 current 新。 */
export function isVersionNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}
```

- [ ] **Step 4: 跑通**
Run: `cd chayuan-client && npx vitest --run packages/installer-core/src/__tests__/version.test.ts`
Expected: all passed

- [ ] **Step 5: 更新 index.ts**(末尾加)
```typescript
export { compareVersions, isVersionNewer } from './version';
```

- [ ] **Step 6: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/installer-core
git commit -m "feat(installer): 版本号比较 compareVersions/isVersionNewer(零依赖,prerelease 感知)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 平台映射 + 更新决策(纯函数,vitest)

**Files:**
- Create `chayuan-client/packages/installer-core/src/update.ts`
- Modify `chayuan-client/packages/installer-core/src/index.ts`
- Test `chayuan-client/packages/installer-core/src/__tests__/update.test.ts`

> website `version-routes` 平台键 = `windows-amd64 / windows-arm64 / mac-x64 / mac-arm64 / linux-amd64 / linux-arm64`(见 db.js PLATFORMS),与 layout.yaml 的 `win-x86_64` 等**不同命名** → 需映射。`decideUpdate` 消费 `GET /api/version/:product` 响应。

- [ ] **Step 1: 写失败测试**
```typescript
// chayuan-client/packages/installer-core/src/__tests__/update.test.ts
import { describe, it, expect } from 'vitest';
import { toReleasePlatform, decideUpdate } from '../update';

describe('toReleasePlatform', () => {
  it('layout 维度 → website 发布平台键', () => {
    expect(toReleasePlatform('win', 'x86_64')).toBe('windows-amd64');
    expect(toReleasePlatform('win', 'arm64')).toBe('windows-arm64');
    expect(toReleasePlatform('mac', 'x86_64')).toBe('mac-x64');
    expect(toReleasePlatform('mac', 'arm64')).toBe('mac-arm64');
    expect(toReleasePlatform('linux', 'x86_64')).toBe('linux-amd64');
    expect(toReleasePlatform('linux', 'arm64')).toBe('linux-arm64');
  });
});

const RESP = {
  product: 'desktop',
  latest: { version: '3.1.0' },
  platforms: {
    'windows-amd64': {
      version: '3.1.0', primaryUrl: '/downloads/desktop/win/a.exe',
      variants: [
        { variant: '集成版', primary: true, url: '/downloads/desktop/win/a.exe', notes: '' },
        { variant: '轻量版', primary: false, url: '/downloads/desktop/win/b.exe', notes: '' },
      ],
    },
    'mac-arm64': {
      version: '3.0.0', primaryUrl: '/downloads/desktop/mac/a.dmg',
      variants: [{ variant: '集成版', primary: true, url: '/downloads/desktop/mac/a.dmg', notes: '' }],
    },
  },
};

describe('decideUpdate', () => {
  it('本地旧 + 该平台有更新 → available + primaryUrl', () => {
    const r = decideUpdate(RESP, { currentVersion: '3.0.0', os: 'win', arch: 'x86_64' });
    expect(r.available).toBe(true);
    expect(r.latestVersion).toBe('3.1.0');
    expect(r.downloadUrl).toBe('/downloads/desktop/win/a.exe');
    expect(r.variant).toBe('集成版');
  });
  it('指定变体 → 取该变体 url', () => {
    const r = decideUpdate(RESP, { currentVersion: '3.0.0', os: 'win', arch: 'x86_64', preferVariant: '轻量版' });
    expect(r.available).toBe(true);
    expect(r.downloadUrl).toBe('/downloads/desktop/win/b.exe');
  });
  it('本地已是最新 → available=false', () => {
    const r = decideUpdate(RESP, { currentVersion: '3.1.0', os: 'win', arch: 'x86_64' });
    expect(r.available).toBe(false);
  });
  it('该平台无发布 → available=false', () => {
    const r = decideUpdate(RESP, { currentVersion: '1.0.0', os: 'linux', arch: 'x86_64' });
    expect(r.available).toBe(false);
  });
});
```

- [ ] **Step 2: 跑确认失败**
Run: `cd chayuan-client && npx vitest --run packages/installer-core/src/__tests__/update.test.ts`

- [ ] **Step 3: 实现 update.ts**
```typescript
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
```

- [ ] **Step 4: 跑通 + 全测试 + typecheck**
Run: `cd chayuan-client && npx vitest --run packages/installer-core`（全 passed:18+5+4=27)
Run: `cd chayuan-client/packages/installer-core && npx tsc -p tsconfig.json --noEmit`（空)

- [ ] **Step 5: 更新 index.ts**(末尾加)
```typescript
export {
  toReleasePlatform, decideUpdate,
  type VersionPlatform, type VersionResponse, type UpdateOpts, type UpdateDecision,
} from './update';
```

- [ ] **Step 6: 跑通确认导出后无破坏 + 提交**
Run: `cd chayuan-client && npx vitest --run packages/installer-core`（全 passed)
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/installer-core
git commit -m "feat(installer): 平台映射 toReleasePlatform + 更新决策 decideUpdate(消费 version-routes)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Rust apply_update + 皮「检查更新」按钮(`[BUILD-VERIFY]` + typecheck)

**Files:**
- Modify `chayuan-client/apps/installer/src-tauri/src/lib.rs`
- Modify `chayuan-client/apps/installer/src/App.tsx`

> Rust 真原子替换 `[BUILD-VERIFY]`(无 Rust);前端按钮 typecheck 可验。

- [ ] **Step 1: 加 `apply_update` 命令到 lib.rs**(在 `build_installer` 后)
```rust
/// 应用更新:把已下载校验过的新包原子替换到目标路径(先写 .new 再 rename)。
/// [BUILD-VERIFY] 真替换运行中安装需平台细节(Windows 文件占用 → 重启替换);本骨架做原子 rename。
#[tauri::command]
async fn apply_update(downloaded_path: String, target_path: String) -> Result<String, String> {
    let src = std::path::Path::new(&downloaded_path);
    if !src.is_file() {
        return Err(format!("下载文件不存在: {}", downloaded_path));
    }
    let tmp = format!("{}.new", target_path);
    std::fs::copy(&downloaded_path, &tmp).map_err(|e| format!("写临时文件失败: {}", e))?;
    // 原子替换:rename 覆盖(同盘原子)。Windows 上目标被占用会失败 → [BUILD-VERIFY] 退重启替换。
    std::fs::rename(&tmp, &target_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("原子替换失败(可能文件占用,需重启替换): {}", e)
    })?;
    Ok(target_path)
}
```

- [ ] **Step 2: 注册 handler**
```rust
        .invoke_handler(tauri::generate_handler![download_file, fetch_manifest, build_installer, apply_update])
```

- [ ] **Step 3: App.tsx 加「检查更新」按钮**
READ 现有 `apps/installer/src/App.tsx`。在 import 区加 `decideUpdate`、`type VersionResponse`:
```tsx
import {
  resolveComponents, mirrorCandidates, DEFAULT_MIRROR_RULES, decideUpdate,
  type InstallerManifest, type Tier, type Selection, type ResolvedComponent, type VersionResponse,
} from '@chayuan/installer-core';
```
在组件里加状态 + 检查函数(放在 startInstall 附近):
```tsx
const CURRENT_VERSION = '3.0.0'; // [BUILD-VERIFY] 真版本读已装 manifest

const checkUpdate = async () => {
  try {
    const resp = await invoke<VersionResponse>('fetch_version', { product: 'desktop' });
    const d = decideUpdate(resp, { currentVersion: CURRENT_VERSION, os, arch, preferVariant: undefined });
    if (d.available) append(`发现新版 ${d.latestVersion}(${d.variant}) → ${d.downloadUrl}`);
    else append('已是最新');
  } catch (e) {
    append(`检查更新失败: ${String(e)}`);
  }
};
```
在按钮区加:
```tsx
<button onClick={() => void checkUpdate()}>检查更新</button>
```

- [ ] **Step 4: lib.rs 加 `fetch_version` 占位命令**(皮经 Rust 打 website,避开浏览器 CORS;`[BUILD-VERIFY]` 真实现 reqwest GET `/api/version/<product>`)
```rust
/// 拉 website 版本信息 —— [BUILD-VERIFY] 真实现 reqwest GET {base}/api/version/{product};骨架返空。
#[tauri::command]
async fn fetch_version(product: String) -> Result<serde_json::Value, String> {
    let _ = product;
    Ok(serde_json::json!({ "product": "", "latest": { "version": "0.0.0" }, "platforms": {} }))
}
```
并把 `fetch_version` 也加进 `generate_handler!`。

- [ ] **Step 5: 前端 typecheck(Rust 不编译)**
Run: `cd chayuan-client/apps/installer && npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" || echo "CLEAN"`
Run: `grep -n "apply_update\|fetch_version" chayuan-client/apps/installer/src-tauri/src/lib.rs`（apply_update 2 处、fetch_version 2 处）

- [ ] **Step 6: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/apps/installer
git commit -m "feat(installer): 检查更新(decideUpdate 按钮 + Rust apply_update 原子替换/fetch_version)[BUILD-VERIFY]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 自检 + 推送

- [ ] **Step 1:** `cd chayuan-client && npx vitest --run packages/installer-core`（全 passed,27)
- [ ] **Step 2:** `cd chayuan-client/packages/installer-core && npx tsc -p tsconfig.json --noEmit`（空)
- [ ] **Step 3:** `cd chayuan-client/apps/installer && npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" || echo CLEAN`
- [ ] **Step 4:** `cd /work/chayuan-desktop && git push origin main`

---

## 自检(Self-Review)
- **Spec 覆盖**(spec §6 检查更新):semver 比对(T1)、消费 version-routes + 平台映射(T2)、原子替换(T3)。P3 完成即 spec §0-§7 全覆盖(P4 原生包可选)。
- **占位扫描**:无 TBD。`[BUILD-VERIFY]` 标的是 Rust 真下载/原子替换/真版本读取需 Rust + 运行环境。
- **类型一致**:`VersionResponse`/`VersionPlatform` 对齐 website `version-routes` 响应(latest.version + platforms[key].variants[].url);`toReleasePlatform` 输出对齐 db.js PLATFORMS(`windows-amd64` 等);`decideUpdate` 返回 `UpdateDecision`。`isVersionNewer(latest,current)` 与 website `semver.gt` 同序(prerelease<release)。
- **不回归**:installer-core 新文件;apps/installer 仅加按钮 + Rust 命令。
- **风险/[BUILD-VERIFY]**:① Rust `apply_update` Windows 占用文件需重启替换(骨架仅 rename)② `fetch_version` 真 reqwest 对接 ③ 皮真读已装版本(现写死 CURRENT_VERSION)④ website 平台键与 layout 键映射若 db.js PLATFORMS 调整需同步 toReleasePlatform。
