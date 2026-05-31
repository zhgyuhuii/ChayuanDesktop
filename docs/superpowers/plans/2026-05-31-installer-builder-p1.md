# 察元下载构建器 P1(皮骨架 + 下载核心)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** 落地下载构建器的**可验证核心**:纯 TS 包 `@chayuan/installer-core`(清单解析 / 镜像候选 / 下载续传&校验,全 vitest 可验)+ Tauri 皮 `apps/installer` 骨架(向导 UI + Rust 下载/解压命令,标 `[VERIFY]`)。

**Architecture:** 本机无 Rust 工具链、无 GUI → 把"选档/OS/架构→要下哪些组件、走哪个镜像、怎么续传校验"全部做成**纯函数**放 `packages/installer-core`(vitest 100% 可验);Tauri 皮只做薄 IO 适配(Rust `download_file`/`extract` 命令 + React 向导消费 core),真编译/真下载/真窗口标 `[GPU-VERIFY 等价:BUILD-VERIFY]` 待有 Rust+显示环境验。

**Tech Stack:** TypeScript / vitest 2.x(pnpm workspace `packages/*` 既有约定:`@chayuan/*`、`type:module`、`src/__tests__/*.test.ts`)/ Tauri 2.x(镜像 `apps/desktop`)。承接 spec `2026-05-31-installer-builder-design.md` + P0(website 2GB 上传已修)。

---

## ⚠ 本机可验证边界

- ✅ 可验(vitest / typecheck):`resolveComponents` / `mirrorCandidates` / `resumeRange`+`verifySha`+`nextMirror` 纯逻辑;React 向导 typecheck。
- ❌ `[BUILD-VERIFY]`(需 Rust 工具链 + 桌面显示):`apps/installer` 的 `cargo build`、Rust `download_file`/`extract` 真跑、Tauri 窗口、真 GB 下载续传。本机仅 `node --check`/类型层面保证形状。

---

## 文件结构

**新包 `chayuan-client/packages/installer-core/`**(纯 TS,vitest):
- `package.json` / `tsconfig.json`
- `src/types.ts` — `Tier` / `PlatformKey` / `InstallerManifest` / `ManifestComponent` / `PlatformAsset` / `ResolvedComponent`。
- `src/manifest.ts` — `resolveComponents(manifest, sel)`。
- `src/mirrors.ts` — `mirrorCandidates(url, rules)`。
- `src/download.ts` — `resumeRange` / `verifySha` / `nextMirror`。
- `src/index.ts` — re-export。
- `src/__tests__/{manifest,mirrors,download}.test.ts`。

**新 app `chayuan-client/apps/installer/`**(Tauri 皮,`[BUILD-VERIFY]`):
- `package.json` / `vite.config.ts` / `index.html` / `tsconfig.json`
- `src/App.tsx`(向导:选 tier/os/arch + 进度)/ `src/main.tsx`
- `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` / `src-tauri/src/lib.rs`(`download_file`/`extract` 命令)/ `src-tauri/src/main.rs` / `src-tauri/build.rs`

---

## Task 1: installer-core 包脚手架 + 类型 + resolveComponents

**Files:**
- Create `chayuan-client/packages/installer-core/package.json`
- Create `chayuan-client/packages/installer-core/tsconfig.json`
- Create `chayuan-client/packages/installer-core/src/types.ts`
- Create `chayuan-client/packages/installer-core/src/manifest.ts`
- Create `chayuan-client/packages/installer-core/src/index.ts`
- Test `chayuan-client/packages/installer-core/src/__tests__/manifest.test.ts`

- [ ] **Step 1: 建 package.json**
```json
{
  "name": "@chayuan/installer-core",
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
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: 建 tsconfig.json**(镜像 `packages/transport/tsconfig.json`)
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "lib": ["ES2023"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 建 types.ts**
```typescript
/** 安装档位(对外:轻量/集成/全量)。 */
export type Tier = 'lite' | 'standard' | 'pro';

/** 平台键 = {os}-{arch}(对齐 layout.yaml 矩阵命名)。 */
export type PlatformKey =
  | 'linux-x86_64' | 'linux-arm64'
  | 'mac-x86_64' | 'mac-arm64'
  | 'win-x86_64' | 'win-arm64';

/** 某平台下一个组件的已解析下载资产。 */
export interface PlatformAsset {
  url: string;
  sha256?: string;
  /** 解压策略:'none' | 'tar.gz' | 'zip' | 'tar.xz' 等(由制包/安装侧消费)。 */
  unpack: string;
  sizeBytes?: number;
}

/** 归一化清单里的一个组件(已按平台展开,皮直接消费,不解析 layout.yaml 插值)。 */
export interface ManifestComponent {
  name: string;
  /** 哪些档包含该组件(= layout.yaml 的 release 字段)。 */
  tiers: Tier[];
  /** 解压/落地相对目录。 */
  dest: string;
  /** 可选组件:该平台缺资产时跳过而非报错。 */
  optional?: boolean;
  platforms: Partial<Record<PlatformKey, PlatformAsset>>;
}

export interface InstallerManifest {
  version: string;
  components: ManifestComponent[];
}

/** 选择维度。 */
export interface Selection {
  tier: Tier;
  os: 'linux' | 'mac' | 'win';
  arch: 'x86_64' | 'arm64';
}

/** resolveComponents 的产物:该 (tier,os,arch) 实际要下的一个组件。 */
export interface ResolvedComponent {
  name: string;
  dest: string;
  url: string;
  sha256?: string;
  unpack: string;
  sizeBytes?: number;
}
```

- [ ] **Step 4: 写失败测试 manifest.test.ts**
```typescript
import { describe, it, expect } from 'vitest';
import { resolveComponents } from '../manifest';
import type { InstallerManifest } from '../types';

const M: InstallerManifest = {
  version: '3.0.0',
  components: [
    {
      name: 'qwen3-4b', tiers: ['lite', 'standard', 'pro'], dest: 'models/chat/qwen3',
      platforms: {
        'linux-x86_64': { url: 'https://x/qwen.gguf', sha256: 'aa', unpack: 'none', sizeBytes: 100 },
        'mac-arm64': { url: 'https://x/qwen.gguf', sha256: 'aa', unpack: 'none' },
      },
    },
    {
      name: 'milvus', tiers: ['pro'], dest: 'vendor/services/milvus', optional: true,
      platforms: { 'linux-x86_64': { url: 'https://x/milvus.tgz', unpack: 'tar.gz' } },
    },
    {
      name: 'win-only', tiers: ['standard', 'pro'], dest: 'vendor/x',
      platforms: { 'win-x86_64': { url: 'https://x/w.zip', unpack: 'zip' } },
    },
  ],
};

describe('resolveComponents', () => {
  it('lite + linux-x86_64 → 只含该档且该平台有资产的组件', () => {
    const out = resolveComponents(M, { tier: 'lite', os: 'linux', arch: 'x86_64' });
    expect(out.map((c) => c.name)).toEqual(['qwen3-4b']);
    expect(out[0].url).toBe('https://x/qwen.gguf');
    expect(out[0].dest).toBe('models/chat/qwen3');
  });

  it('pro + linux-x86_64 → 含 pro 档全部该平台组件(qwen + milvus)', () => {
    const out = resolveComponents(M, { tier: 'pro', os: 'linux', arch: 'x86_64' });
    expect(out.map((c) => c.name).sort()).toEqual(['milvus', 'qwen3-4b']);
  });

  it('该平台无资产的组件被跳过(standard + linux 不含 win-only)', () => {
    const out = resolveComponents(M, { tier: 'standard', os: 'linux', arch: 'x86_64' });
    expect(out.map((c) => c.name)).toEqual(['qwen3-4b']);
  });

  it('mac-arm64 资产无 sizeBytes 也能解析', () => {
    const out = resolveComponents(M, { tier: 'lite', os: 'mac', arch: 'arm64' });
    expect(out).toHaveLength(1);
    expect(out[0].sizeBytes).toBeUndefined();
  });
});
```

- [ ] **Step 5: 跑测试确认失败**
Run: `cd chayuan-client/packages/installer-core && npx vitest --run src/__tests__/manifest.test.ts`
Expected: FAIL（`resolveComponents` 未定义 / 模块缺失）

- [ ] **Step 6: 实现 manifest.ts**
```typescript
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
```

- [ ] **Step 7: 建 index.ts**
```typescript
export * from './types';
export { resolveComponents } from './manifest';
```

- [ ] **Step 8: 跑测试通过 + 安装依赖**
Run: `cd chayuan-client && pnpm install` (让 workspace 认识新包)
Run: `cd chayuan-client/packages/installer-core && npx vitest --run`
Expected: 4 passed

- [ ] **Step 9: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/installer-core chayuan-client/pnpm-lock.yaml
git commit -m "feat(installer): installer-core 包 + resolveComponents(清单按 tier/os/arch 解析)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: mirrorCandidates(镜像候选,纯函数)

**Files:**
- Create `chayuan-client/packages/installer-core/src/mirrors.ts`
- Modify `chayuan-client/packages/installer-core/src/index.ts`
- Test `chayuan-client/packages/installer-core/src/__tests__/mirrors.test.ts`

> 把"原 URL → 有序候选 URL(原始 + 镜像重写)"做成数据驱动纯函数,移植 `install_recipes` 的镜像思路到 TS(国内 hf.co→hf-mirror.com、huggingface.co→hf-mirror.com 等)。皮下载失败时按序换下一个候选。

- [ ] **Step 1: 写失败测试 mirrors.test.ts**
```typescript
import { describe, it, expect } from 'vitest';
import { mirrorCandidates, DEFAULT_MIRROR_RULES } from '../mirrors';

describe('mirrorCandidates', () => {
  it('hf.co / huggingface.co 域名追加 hf-mirror 候选,原始在前', () => {
    const out = mirrorCandidates('https://huggingface.co/org/repo/file.gguf', DEFAULT_MIRROR_RULES);
    expect(out[0]).toBe('https://huggingface.co/org/repo/file.gguf');
    expect(out).toContain('https://hf-mirror.com/org/repo/file.gguf');
  });

  it('无匹配规则的 URL 只返回自身', () => {
    const out = mirrorCandidates('https://example.com/a.bin', DEFAULT_MIRROR_RULES);
    expect(out).toEqual(['https://example.com/a.bin']);
  });

  it('去重:原始与重写相同的不重复', () => {
    const out = mirrorCandidates('https://hf-mirror.com/x/y.gguf', DEFAULT_MIRROR_RULES);
    expect(out).toEqual(['https://hf-mirror.com/x/y.gguf']);
  });

  it('自定义规则按声明顺序产出候选', () => {
    const rules = [{ match: 'a.com', replace: 'b.com' }, { match: 'a.com', replace: 'c.com' }];
    const out = mirrorCandidates('https://a.com/f', rules);
    expect(out).toEqual(['https://a.com/f', 'https://b.com/f', 'https://c.com/f']);
  });
});
```

- [ ] **Step 2: 跑确认失败**
Run: `cd chayuan-client/packages/installer-core && npx vitest --run src/__tests__/mirrors.test.ts`

- [ ] **Step 3: 实现 mirrors.ts**
```typescript
/** 镜像重写规则:把 url 中的 match 主机替换成 replace 主机,生成一个候选。 */
export interface MirrorRule {
  match: string;
  replace: string;
}

/** 国内默认镜像规则(实测可达:hf-mirror 替代 huggingface)。 */
export const DEFAULT_MIRROR_RULES: MirrorRule[] = [
  { match: 'huggingface.co', replace: 'hf-mirror.com' },
  { match: 'hf.co', replace: 'hf-mirror.com' },
];

/** 原 URL → 有序候选 URL(原始优先,再按规则顺序追加镜像;去重)。 */
export function mirrorCandidates(url: string, rules: MirrorRule[]): string[] {
  const out: string[] = [url];
  for (const r of rules) {
    if (url.includes(r.match)) {
      const rewritten = url.split(r.match).join(r.replace);
      if (!out.includes(rewritten)) out.push(rewritten);
    }
  }
  return out;
}
```

- [ ] **Step 4: 更新 index.ts**
```typescript
export * from './types';
export { resolveComponents } from './manifest';
export { mirrorCandidates, DEFAULT_MIRROR_RULES, type MirrorRule } from './mirrors';
```

- [ ] **Step 5: 跑通**
Run: `cd chayuan-client/packages/installer-core && npx vitest --run`
Expected: 8 passed

- [ ] **Step 6: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/installer-core
git commit -m "feat(installer): mirrorCandidates 镜像候选(原始优先+hf-mirror 兜底)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 下载续传/校验/换源(纯函数)

**Files:**
- Create `chayuan-client/packages/installer-core/src/download.ts`
- Modify `chayuan-client/packages/installer-core/src/index.ts`
- Test `chayuan-client/packages/installer-core/src/__tests__/download.test.ts`

> 下载侧续传 = HTTP Range:本地已落 `localBytes` → 从该偏移续。校验 = sha256 比对。换源 = 当前候选失败取下一个。全纯函数,真 IO 在 Tauri 侧。

- [ ] **Step 1: 写失败测试 download.test.ts**
```typescript
import { describe, it, expect } from 'vitest';
import { resumeRange, verifySha, nextMirror } from '../download';

describe('resumeRange', () => {
  it('未下完 → 返回从 localBytes 起的 Range 头', () => {
    expect(resumeRange(0, 1000)).toEqual({ offset: 0, header: 'bytes=0-' });
    expect(resumeRange(400, 1000)).toEqual({ offset: 400, header: 'bytes=400-' });
  });
  it('已下完(local>=total)→ null', () => {
    expect(resumeRange(1000, 1000)).toBeNull();
    expect(resumeRange(1200, 1000)).toBeNull();
  });
  it('total 未知(0/负)→ 从 0 全量下', () => {
    expect(resumeRange(0, 0)).toEqual({ offset: 0, header: 'bytes=0-' });
  });
});

describe('verifySha', () => {
  it('期望为空 → 跳过校验视为通过', () => {
    expect(verifySha(undefined, 'abc')).toBe(true);
    expect(verifySha('', 'abc')).toBe(true);
  });
  it('大小写不敏感比对', () => {
    expect(verifySha('ABcd', 'abcd')).toBe(true);
    expect(verifySha('aaaa', 'bbbb')).toBe(false);
  });
});

describe('nextMirror', () => {
  it('返回下一个候选,越界返回 null', () => {
    const c = ['u0', 'u1'];
    expect(nextMirror(c, 0)).toBe('u1');
    expect(nextMirror(c, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑确认失败**
Run: `cd chayuan-client/packages/installer-core && npx vitest --run src/__tests__/download.test.ts`

- [ ] **Step 3: 实现 download.ts**
```typescript
/** 断点续传:本地已落 localBytes,目标 totalBytes;返回续传 Range 或 null(已完成)。 */
export function resumeRange(localBytes: number, totalBytes: number): { offset: number; header: string } | null {
  if (totalBytes > 0 && localBytes >= totalBytes) return null;
  const offset = Math.max(0, localBytes | 0);
  return { offset, header: `bytes=${offset}-` };
}

/** sha256 校验:期望为空则视为通过(清单未给 sha 的组件);否则大小写不敏感比对。 */
export function verifySha(expected: string | undefined, actual: string): boolean {
  if (!expected) return true;
  return expected.toLowerCase() === actual.toLowerCase();
}

/** 当前候选(attemptedIdx)失败,取下一个候选 URL;无更多返回 null。 */
export function nextMirror(candidates: string[], attemptedIdx: number): string | null {
  const next = attemptedIdx + 1;
  return next < candidates.length ? candidates[next] : null;
}
```

- [ ] **Step 4: 更新 index.ts**
```typescript
export * from './types';
export { resolveComponents } from './manifest';
export { mirrorCandidates, DEFAULT_MIRROR_RULES, type MirrorRule } from './mirrors';
export { resumeRange, verifySha, nextMirror } from './download';
```

- [ ] **Step 5: 跑通 + typecheck**
Run: `cd chayuan-client/packages/installer-core && npx vitest --run`(全 passed)
Run: `cd chayuan-client/packages/installer-core && npx tsc -p tsconfig.json --noEmit`（空)

- [ ] **Step 6: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/installer-core
git commit -m "feat(installer): 下载续传 resumeRange + sha 校验 verifySha + 换源 nextMirror

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Tauri 皮 `apps/installer` 骨架(`[BUILD-VERIFY]`)

**Files:**(全部 Create,镜像 `apps/desktop` 最小化)
- `chayuan-client/apps/installer/package.json`
- `chayuan-client/apps/installer/index.html`
- `chayuan-client/apps/installer/vite.config.ts`
- `chayuan-client/apps/installer/tsconfig.json`
- `chayuan-client/apps/installer/src/main.tsx`
- `chayuan-client/apps/installer/src/App.tsx`
- `chayuan-client/apps/installer/src-tauri/Cargo.toml`
- `chayuan-client/apps/installer/src-tauri/build.rs`
- `chayuan-client/apps/installer/src-tauri/tauri.conf.json`
- `chayuan-client/apps/installer/src-tauri/src/main.rs`
- `chayuan-client/apps/installer/src-tauri/src/lib.rs`

> 本机无 Rust + 无显示 → Rust/构建/真窗口标 `[BUILD-VERIFY]`。本任务只保证:① 前端 typecheck 过(向导消费 installer-core);② Rust 文件 `node`-无关的形状正确(人工核对,不编译)。

- [ ] **Step 1: package.json**
```json
{
  "name": "@chayuan/installer-app",
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
  <head><meta charset="UTF-8" /><title>察元下载构建器</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

- [ ] **Step 3: vite.config.ts**
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 3920, strictPort: true },
});
```

- [ ] **Step 4: tsconfig.json**
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

- [ ] **Step 6: src/App.tsx**（向导:选 tier/os/arch,消费 installer-core；下载经 Tauri command,`[BUILD-VERIFY]`）
```tsx
import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  resolveComponents, mirrorCandidates, DEFAULT_MIRROR_RULES,
  type InstallerManifest, type Tier, type Selection, type ResolvedComponent,
} from '@chayuan/installer-core';

const TIERS: { id: Tier; label: string }[] = [
  { id: 'lite', label: '轻量版' },
  { id: 'standard', label: '集成版' },
  { id: 'pro', label: '全量版' },
];
const OSES = ['linux', 'mac', 'win'] as const;
const ARCHES = ['x86_64', 'arm64'] as const;

export const App: React.FC = () => {
  const [tier, setTier] = React.useState<Tier>('lite');
  const [os, setOs] = React.useState<Selection['os']>('win');
  const [arch, setArch] = React.useState<Selection['arch']>('x86_64');
  const [manifest, setManifest] = React.useState<InstallerManifest | null>(null);
  const [log, setLog] = React.useState<string[]>([]);
  const append = (s: string) => setLog((l) => [...l, s]);

  // 拉清单([BUILD-VERIFY] 真实地址走 website;此处先留按钮)
  const loadManifest = async () => {
    try {
      const m = await invoke<InstallerManifest>('fetch_manifest');
      setManifest(m);
      append(`清单 v${m.version},组件 ${m.components.length}`);
    } catch (e) {
      append(`拉清单失败: ${String(e)}`);
    }
  };

  const plan: ResolvedComponent[] = manifest
    ? resolveComponents(manifest, { tier, os, arch })
    : [];

  const startInstall = async () => {
    for (const c of plan) {
      const candidates = mirrorCandidates(c.url, DEFAULT_MIRROR_RULES);
      append(`下载 ${c.name}(${candidates.length} 候选源)…`);
      try {
        // [BUILD-VERIFY] Rust download_file:续传 + sha 校验 + 落 dest
        await invoke('download_file', { candidates, dest: c.dest, sha256: c.sha256 ?? null });
        append(`✓ ${c.name}`);
      } catch (e) {
        append(`✗ ${c.name}: ${String(e)}`);
      }
    }
    append('完成(真下载需 Tauri Rust 环境)');
  };

  return (
    <div style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 720 }}>
      <h1>察元下载构建器</h1>
      <section style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '16px 0' }}>
        <label>档位{' '}
          <select value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
            {TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label>系统{' '}
          <select value={os} onChange={(e) => setOs(e.target.value as Selection['os'])}>
            {OSES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label>架构{' '}
          <select value={arch} onChange={(e) => setArch(e.target.value as Selection['arch'])}>
            {ARCHES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </section>
      <button onClick={() => void loadManifest()}>① 拉取清单</button>{' '}
      <button onClick={() => void startInstall()} disabled={plan.length === 0}>② 安装到本机({plan.length} 组件)</button>
      <ul>{plan.map((c) => <li key={c.name}>{c.name} → {c.dest}</li>)}</ul>
      <pre style={{ background: '#111', color: '#0f0', padding: 12, minHeight: 80 }}>{log.join('\n')}</pre>
    </div>
  );
};
```

- [ ] **Step 7: src-tauri/Cargo.toml**(`[BUILD-VERIFY]`)
```toml
[package]
name = "chayuan-installer"
version = "0.1.0"
edition = "2021"
rust-version = "1.77"

[lib]
name = "chayuan_installer_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2.0.0", features = [] }

[dependencies]
tauri = { version = "2.11", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", features = ["stream"] }
tokio = { version = "1", features = ["full"] }
sha2 = "0.10"
futures-util = "0.3"
```

- [ ] **Step 8: src-tauri/build.rs**
```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 9: src-tauri/tauri.conf.json**(最小窗口)
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "察元下载构建器",
  "version": "0.1.0",
  "identifier": "com.chayuan.installer",
  "build": { "frontendDist": "../dist", "devUrl": "http://localhost:3920", "beforeDevCommand": "pnpm dev", "beforeBuildCommand": "pnpm build" },
  "app": { "windows": [{ "title": "察元下载构建器", "width": 820, "height": 600 }], "security": { "csp": null } },
  "bundle": { "active": true, "targets": "all", "icon": ["icons/icon.png"] }
}
```

- [ ] **Step 10: src-tauri/src/main.rs**
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    chayuan_installer_lib::run()
}
```

- [ ] **Step 11: src-tauri/src/lib.rs**(`download_file` 续传+sha + `fetch_manifest` 占位 + `extract`;`[BUILD-VERIFY]`)
```rust
use std::io::Write;
use sha2::{Digest, Sha256};
use futures_util::StreamExt;

/// 下载一个组件:按候选源顺序尝试,支持断点续传(Range)+ sha256 校验,落到 dest。
/// [BUILD-VERIFY] 需 Rust 工具链 + 网络;本机不编译,仅形状正确。
#[tauri::command]
async fn download_file(candidates: Vec<String>, dest: String, sha256: Option<String>) -> Result<String, String> {
    let path = std::path::PathBuf::from(&dest);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let already = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let client = reqwest::Client::new();
    let mut last_err = String::from("no candidates");
    for url in &candidates {
        let req = client.get(url).header("Range", format!("bytes={}-", already));
        match req.send().await {
            Ok(resp) => {
                let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&path)
                    .map_err(|e| e.to_string())?;
                let mut stream = resp.bytes_stream();
                let mut ok = true;
                while let Some(chunk) = stream.next().await {
                    match chunk {
                        Ok(bytes) => { if file.write_all(&bytes).is_err() { ok = false; break; } }
                        Err(e) => { last_err = e.to_string(); ok = false; break; }
                    }
                }
                if ok {
                    if let Some(expected) = &sha256 {
                        let actual = sha256_of(&path).map_err(|e| e.to_string())?;
                        if !actual.eq_ignore_ascii_case(expected) {
                            return Err(format!("sha256 mismatch: {} != {}", actual, expected));
                        }
                    }
                    return Ok(dest);
                }
            }
            Err(e) => { last_err = e.to_string(); }
        }
    }
    Err(last_err)
}

fn sha256_of(path: &std::path::Path) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    let mut f = std::fs::File::open(path)?;
    std::io::copy(&mut f, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// 拉取归一化清单 —— [BUILD-VERIFY] 真实从 website 取;骨架先返空清单。
#[tauri::command]
async fn fetch_manifest() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "version": "0.0.0", "components": [] }))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![download_file, fetch_manifest])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 12: 注册 workspace + 前端 typecheck**
Run: `cd chayuan-client && pnpm install`
Run: `cd chayuan-client/apps/installer && npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" || echo "typecheck CLEAN"`
Expected: CLEAN（仅前端;Rust 不编译)
> 若报 `@tauri-apps/api/core` 类型缺失,确认 `@tauri-apps/api` 已装(`pnpm install` 后)。Rust 编译 `cargo build` 标 `[BUILD-VERIFY]` 跳过。

- [ ] **Step 13: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/apps/installer chayuan-client/pnpm-lock.yaml
git commit -m "feat(installer): Tauri 皮 apps/installer 骨架(向导消费 core + Rust download_file 续传/sha)[BUILD-VERIFY]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 自检 + 推送

- [ ] **Step 1:** `cd chayuan-client/packages/installer-core && npx vitest --run`(全 passed)
- [ ] **Step 2:** `cd chayuan-client/packages/installer-core && npx tsc -p tsconfig.json --noEmit`（空）
- [ ] **Step 3:** `cd chayuan-client/apps/installer && npx tsc -p tsconfig.json --noEmit 2>&1 | grep "error TS" || echo CLEAN`
- [ ] **Step 4:** `cd /work/chayuan-desktop && git push origin main`

---

## 自检(Self-Review)

- **Spec 覆盖**(spec §1-§6):皮(Task 4)、清单驱动解析(Task 1)、下载引擎续传/校验/镜像(Task 2/3)、三档(Tier 类型贯穿)、本机安装(Task 4 startInstall)。spec §5 制包 / §6 检查更新 = P2/P3,不在 P1。
- **占位扫描**:无 TBD。`[BUILD-VERIFY]` 标的是"需 Rust+显示环境才能真验",非 plan 占位——逻辑核心(Task 1-3)全 vitest 可验。
- **类型一致**:`Tier`/`PlatformKey`/`Selection`/`ResolvedComponent`/`InstallerManifest` 在 types.ts 定义,Task 4 App.tsx 与 download.ts/manifest.ts/mirrors.ts 全一致引用;`mirrorCandidates(url,rules)`、`resumeRange(local,total)`、`verifySha(expected,actual)`、`nextMirror(candidates,idx)` 签名前后一致。
- **不回归**:全新包/新 app,零触碰既有代码。
- **风险/[BUILD-VERIFY]**:① `cargo build` apps/installer(本机无 Rust)② Rust download_file 真续传/sha/网络 ③ Tauri 窗口真渲染 ④ fetch_manifest 真实对接 website 清单端点(P2 才接真清单生成)⑤ reqwest Range 服务端需支持(website 静态下载支持 Range)。
