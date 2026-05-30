# 前端授权改造（调本地 Python 后端 + 退役 Rust/TS 验签层）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 chayuan-client 的 `features/license` 从「调 PAL/Rust 本地验签」改成「调本地 chayuan-server `/api/v1/license/*`」，并**物理删除**已弃用的 `@chayuan/license` 包、`platform-shared` PAL license 接口、`platform-tauri` license 实现与 Rust 交接文档。

**Architecture:** 桌面=内嵌网页 + 本地 Python sidecar（chayuan-server, `127.0.0.1:62581`），网页版=远程同一套 API。验证已在 Python 后端完成（见 `docs/superpowers/specs/2026-05-30-python-license-verification-design.md`，已落地 commit `e106075`）。前端不再持有任何验签算法或机密，只通过 `@chayuan/api` 的 `http`（走 `getPlatform().net.fetch` + 已配置 `baseURL`）调后端，后端按机器指纹判定授权态。门控逻辑收敛为「后端返回 `licensed`」单一真源。

**Tech Stack:** TypeScript、React、Zustand、TanStack（既有）、`@chayuan/api` http client、vitest、biome。pnpm workspace。

---

## 背景：后端契约（已实现，不在本计划改动）

后端 `chayuan/server/api_server/license_routes.py` 已挂 `/api/v1/license`，返回**裸 JSON**（无 `{code,msg,data}` 壳，`http.get` 原样返回）：

| 方法 路径 | 请求 | 响应 |
|---|---|---|
| `GET /api/v1/license/fingerprint` | — | `{ fingerprint: string }` |
| `GET /api/v1/license/buy-url?app=video` | query `app` | `{ url: string }` |
| `GET /api/v1/license/status?app=video` | query `app` | `LicenseStatus`（后端内部做偶尔在线自动激活） |
| `POST /api/v1/license/activate` | `{ app, serial }` | `LicenseStatus` |
| `POST /api/v1/license/activate-token` | `{ app, token }` | `LicenseStatus` |

`LicenseStatus`（后端 camelCase）：`{ licensed: boolean; app?: string; expireAt?: string; source?: string; reason?: string }`，`reason ∈ none/expired/rollback/mismatch/signature/invalid-app`。

---

## 文件结构（本计划触达）

**新增：**
- `chayuan-client/packages/api/src/license.ts` — 后端 `/api/v1/license/*` 的 typed 客户端 + `LicenseStatus` 类型。
- `chayuan-client/packages/api/src/__tests__/license.test.ts` — 客户端单测（mock `getPlatform().net.fetch`）。

**重写：**
- `chayuan-client/packages/app/src/features/license/licenseStore.ts` — 改调 API 客户端，去掉 deps/PAL/`enabled`/`activateOnline`，新增 `ready` 态。
- `chayuan-client/packages/app/src/features/license/LicenseDialog.tsx` — fingerprint/buy-url 从后端取；序列号/令牌走 store。
- `chayuan-client/packages/app/src/features/license/LicenseGate.tsx` — 加 loading 态（首刷未回前不闪锁屏）。
- `chayuan-client/packages/app/src/features/license/index.ts` — 更新导出。
- `chayuan-client/packages/app/src/features/license/__tests__/licenseStore.test.ts` — mock API 客户端重写。
- `chayuan-client/packages/app/src/features/shell/page-registry.tsx` — video-generation 渲染包 `LicenseGate`。

**删除：**
- `chayuan-client/packages/app/src/features/license/activation.ts`（验签编排，已搬后端）。
- `chayuan-client/packages/app/src/features/license/__tests__/activation.test.ts`。
- `chayuan-client/packages/app/src/features/license/config.ts`（公钥/基址挪后端）。
- `chayuan-client/packages/license/`（整包 `@chayuan/license`）。
- `chayuan-client/docs/license-rust-handoff.md`。
- `chayuan-client/packages/platform-shared/src/index.ts` 内 `LicenseCheck` / `ActivationRecord` / `LicenseHostApi` 接口 + `Platform.license?`。
- `chayuan-client/packages/platform-tauri/src/index.ts` 内 `tauriLicense` 实现 + 相关 import + `license: tauriLicense` 装配。
- `chayuan-client/packages/app/package.json` 的 `@chayuan/license` 依赖。
- `chayuan-client/vitest.config.ts` 的 `@chayuan/license` alias。

> 注（已核实）：`apps/desktop/src-tauri/src` 下**没有** `license_fingerprint` / `license_verify_shortcode` Rust 命令（从未实现），故删除 platform-tauri 的 TS 调用方即可，无 Rust 改动。

---

### Task 1: API 客户端 `packages/api/src/license.ts`

**Files:**
- Create: `chayuan-client/packages/api/src/license.ts`
- Create: `chayuan-client/packages/api/src/__tests__/license.test.ts`
- Modify: `chayuan-client/packages/api/src/index.ts`（加一行 `export * from './license';`）

- [ ] **Step 1: 写失败测试**

Create `chayuan-client/packages/api/src/__tests__/license.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setPlatform } from '@chayuan/platform-shared';
import { configureClient } from '../client';
import {
  licenseActivate,
  licenseActivateToken,
  licenseBuyUrl,
  licenseFingerprint,
  licenseStatus,
} from '../license';

function mockNet(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = handler(url, init);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  // 只注入测试用到的 net.fetch；其余 PAL 能力本测试不触达。
  setPlatform({ net: { fetch: fetchMock } } as never);
  configureClient({ baseURL: 'http://127.0.0.1:62581' });
  return fetchMock;
}

afterEach(() => vi.restoreAllMocks());

describe('license api client', () => {
  it('GET /fingerprint 返回指纹', async () => {
    mockNet(() => ({ fingerprint: '1122334455667788' }));
    expect(await licenseFingerprint()).toEqual({ fingerprint: '1122334455667788' });
  });

  it('GET /buy-url 带 app query', async () => {
    const f = mockNet(() => ({ url: 'https://aidooo.com/buy?app=video&mid=ab' }));
    const r = await licenseBuyUrl('video');
    expect(r.url).toContain('/buy?app=video');
    expect(String(f.mock.calls[0][0])).toContain('/api/v1/license/buy-url?app=video');
  });

  it('GET /status 原样返回裸 JSON（无壳剥离）', async () => {
    mockNet(() => ({ licensed: true, app: 'video', expireAt: '2026-07-01T00:00:00.000Z', source: 'shortcode' }));
    const s = await licenseStatus('video');
    expect(s.licensed).toBe(true);
    expect(s.expireAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('POST /activate 发送 {app,serial}', async () => {
    const f = mockNet(() => ({ licensed: true, app: 'video', expireAt: '2026-07-01T00:00:00.000Z' }));
    const s = await licenseActivate('video', '2101W-0JWN1-MN2JP-9V4QW-MSGJ');
    expect(s.licensed).toBe(true);
    const sentBody = JSON.parse(String(f.mock.calls[0][1]?.body));
    expect(sentBody).toEqual({ app: 'video', serial: '2101W-0JWN1-MN2JP-9V4QW-MSGJ' });
  });

  it('POST /activate-token 发送 {app,token}', async () => {
    const f = mockNet(() => ({ licensed: false, app: 'video', reason: 'mismatch' }));
    const s = await licenseActivateToken('video', 'tok');
    expect(s.reason).toBe('mismatch');
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ app: 'video', token: 'tok' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd chayuan-client && pnpm vitest run packages/api/src/__tests__/license.test.ts`
Expected: FAIL — `Cannot find module '../license'`（以及 `setPlatform` 若未导出则一并报，见 Step 3 注）。

> 注：先确认 `@chayuan/platform-shared` 是否导出 `setPlatform`。运行 `grep -n "export function setPlatform\|export const setPlatform" packages/platform-shared/src/index.ts`。若无该导出，改用其既有的平台注入函数名（如 `installPlatform` / `__setPlatformForTests`，以 grep 结果为准），并同步修改 Step 1 的 import。

- [ ] **Step 3: 实现 `packages/api/src/license.ts`**

```ts
/**
 * 软件授权 API 客户端。对应后端 `chayuan/server/api_server/license_routes.py`，
 * 挂 `/api/v1/license/*`。后端返回裸 JSON（无 {code,msg,data} 壳），`http.get/post`
 * 经 isEnvelope 判定后原样返回。
 *
 * 验证全在 Python 后端（机器指纹绑定 + Ed25519/B1 验签 + 防回拨）；
 * 前端不持任何机密或验签算法。桌面走本地 sidecar，网页走远程同一套 API。
 */

import { http } from './client';

/** 后端授权态（camelCase 与 server/license/service.py 对齐）。 */
export interface LicenseStatus {
  licensed: boolean;
  app?: string;
  /** 到期时间（ISO）。 */
  expireAt?: string;
  /** 通过时的来源通道：online/relay/file/airgap/shortcode。 */
  source?: string;
  /** 未通过原因：none/expired/rollback/mismatch/signature/invalid-app。 */
  reason?: string;
}

const BASE = '/api/v1/license';

/** 本机指纹（后端按持久化 machine.id 派生，8 字节 hex）。 */
export function licenseFingerprint(): Promise<{ fingerprint: string }> {
  return http.get<{ fingerprint: string }>(`${BASE}/fingerprint`);
}

/** 购买页链接（二维码内容；含 app + 指纹）。 */
export function licenseBuyUrl(app: string): Promise<{ url: string }> {
  return http.get<{ url: string }>(`${BASE}/buy-url`, { query: { app } });
}

/** 当前授权态（后端内部做偶尔在线自动激活）。 */
export function licenseStatus(app: string): Promise<LicenseStatus> {
  return http.get<LicenseStatus>(`${BASE}/status`, { query: { app } });
}

/** 手输短码（B1）激活。 */
export function licenseActivate(app: string, serial: string): Promise<LicenseStatus> {
  return http.post<LicenseStatus>(`${BASE}/activate`, { app, serial });
}

/** 令牌（Ed25519，.lic 文件）激活。 */
export function licenseActivateToken(app: string, token: string): Promise<LicenseStatus> {
  return http.post<LicenseStatus>(`${BASE}/activate-token`, { app, token });
}
```

- [ ] **Step 4: 加导出**

In `chayuan-client/packages/api/src/index.ts`, add after the existing `export * from './diagnose';` line:

```ts
export * from './license';
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd chayuan-client && pnpm vitest run packages/api/src/__tests__/license.test.ts`
Expected: PASS（5/5）。

- [ ] **Step 6: typecheck**

Run: `cd chayuan-client && pnpm --filter @chayuan/api typecheck`（若该 filter 不存在，跑根 `pnpm typecheck`）
Expected: 0 error。

- [ ] **Step 7: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
git add packages/api/src/license.ts packages/api/src/__tests__/license.test.ts packages/api/src/index.ts
git commit -m "feat(license): add /api/v1/license api client"
```

---

### Task 2: 重写 `licenseStore`（调后端，删 activation.ts）

**Files:**
- Modify: `chayuan-client/packages/app/src/features/license/licenseStore.ts`（整体重写）
- Delete: `chayuan-client/packages/app/src/features/license/activation.ts`
- Delete: `chayuan-client/packages/app/src/features/license/__tests__/activation.test.ts`
- Modify: `chayuan-client/packages/app/src/features/license/__tests__/licenseStore.test.ts`（整体重写）

设计要点：
- store 不再持验签/PAL deps。`refresh` 调 `licenseStatus`；`activateSerial`/`activateToken` 调对应 API。
- 去掉 `enabled`/`configure`/`activateOnline`（在线自动激活在后端 `status` 内部完成；「刷新在线」按钮在 Task 3 改为调 `refresh`）。
- 新增 `ready` 概念：`refresh` 至少成功/失败回来一次前，`isReady=false`，供 Gate 显 loading，避免首刷未回前闪锁屏。
- `isLicensed(app) = statusByApp[app]?.licensed ?? false`（**fail-closed**：未知即未授权）。网络异常时 `refresh` 落 `{licensed:false, reason:'none'}`，由 Gate 显激活入口（用户可手输短码离线激活）。

- [ ] **Step 1: 重写测试**

Replace entire `chayuan-client/packages/app/src/features/license/__tests__/licenseStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@chayuan/api', () => ({
  licenseStatus: vi.fn(),
  licenseActivate: vi.fn(),
  licenseActivateToken: vi.fn(),
}));

import { licenseActivate, licenseActivateToken, licenseStatus } from '@chayuan/api';
import { useLicenseStore } from '../licenseStore';

const mocked = {
  status: licenseStatus as unknown as ReturnType<typeof vi.fn>,
  activate: licenseActivate as unknown as ReturnType<typeof vi.fn>,
  activateToken: licenseActivateToken as unknown as ReturnType<typeof vi.fn>,
};

beforeEach(() => {
  useLicenseStore.getState().reset();
  vi.clearAllMocks();
});

describe('licenseStore', () => {
  it('refresh 写入 status 并置 ready', async () => {
    mocked.status.mockResolvedValue({ licensed: true, app: 'video', expireAt: '2026-07-01T00:00:00.000Z' });
    const s = await useLicenseStore.getState().refresh('video');
    expect(s.licensed).toBe(true);
    expect(useLicenseStore.getState().isLicensed('video')).toBe(true);
    expect(useLicenseStore.getState().isReady('video')).toBe(true);
  });

  it('refresh 网络异常 → fail-closed（licensed=false）但仍 ready', async () => {
    mocked.status.mockRejectedValue(new Error('network'));
    const s = await useLicenseStore.getState().refresh('video');
    expect(s.licensed).toBe(false);
    expect(s.reason).toBe('none');
    expect(useLicenseStore.getState().isLicensed('video')).toBe(false);
    expect(useLicenseStore.getState().isReady('video')).toBe(true);
  });

  it('activateSerial 成功后 isLicensed=true', async () => {
    mocked.activate.mockResolvedValue({ licensed: true, app: 'video', expireAt: '2026-07-01T00:00:00.000Z' });
    const s = await useLicenseStore.getState().activateSerial('video', '2101W-0JWN1-MN2JP-9V4QW-MSGJ');
    expect(s.licensed).toBe(true);
    expect(mocked.activate).toHaveBeenCalledWith('video', '2101W-0JWN1-MN2JP-9V4QW-MSGJ');
    expect(useLicenseStore.getState().isLicensed('video')).toBe(true);
  });

  it('activateToken 失败保留 reason', async () => {
    mocked.activateToken.mockResolvedValue({ licensed: false, app: 'video', reason: 'mismatch' });
    const s = await useLicenseStore.getState().activateToken('video', 'tok');
    expect(s.licensed).toBe(false);
    expect(s.reason).toBe('mismatch');
    expect(mocked.activateToken).toHaveBeenCalledWith('video', 'tok');
  });

  it('未刷新前 isLicensed=false 且 isReady=false', () => {
    expect(useLicenseStore.getState().isLicensed('video')).toBe(false);
    expect(useLicenseStore.getState().isReady('video')).toBe(false);
  });
});
```

- [ ] **Step 2: 删除 activation 测试与实现，跑测试确认失败**

```bash
cd /work/chayuan-desktop/chayuan-client
git rm packages/app/src/features/license/__tests__/activation.test.ts packages/app/src/features/license/activation.ts
```

Run: `pnpm vitest run packages/app/src/features/license/__tests__/licenseStore.test.ts`
Expected: FAIL — 现 store 仍 import 已删的 `./activation`，编译/运行报错。

- [ ] **Step 3: 重写 `licenseStore.ts`**

Replace entire file:

```ts
/**
 * 授权激活态（client state）。
 *
 * - 真源在 chayuan-server（机器指纹绑定 + 防回拨）。本 store 只缓存反应式状态供 UI 订阅，
 *   不 persist（避免与后端 seenMax 冲突）。
 * - 桌面走本地 sidecar、网页走远程同一套 `/api/v1/license/*`；门控统一按后端 `licensed`。
 * - fail-closed：未刷新 / 网络异常 → 未授权，由 LicenseGate 显激活入口（可离线手输短码）。
 */

import { type LicenseStatus, licenseActivate, licenseActivateToken, licenseStatus } from '@chayuan/api';
import { create } from 'zustand';

export type { LicenseStatus } from '@chayuan/api';

interface LicenseState {
  statusByApp: Record<string, LicenseStatus>;
  /** 该 app 是否已至少刷新回来一次（供 Gate 显 loading，避免闪锁屏）。 */
  readyApps: Record<string, boolean>;

  /** 读后端授权态（后端内部做偶尔在线自动激活）。网络异常落 fail-closed。 */
  refresh(app: string): Promise<LicenseStatus>;
  activateSerial(app: string, serial: string): Promise<LicenseStatus>;
  activateToken(app: string, token: string): Promise<LicenseStatus>;
  isLicensed(app: string): boolean;
  isReady(app: string): boolean;
  reset(): void;
}

const FAIL_CLOSED = (app: string): LicenseStatus => ({ licensed: false, app, reason: 'none' });

export const useLicenseStore = create<LicenseState>((set, get) => ({
  statusByApp: {},
  readyApps: {},

  async refresh(app) {
    let s: LicenseStatus;
    try {
      s = await licenseStatus(app);
    } catch {
      s = FAIL_CLOSED(app);
    }
    set((st) => ({
      statusByApp: { ...st.statusByApp, [app]: s },
      readyApps: { ...st.readyApps, [app]: true },
    }));
    return s;
  },

  async activateSerial(app, serial) {
    const s = await licenseActivate(app, serial);
    set((st) => ({
      statusByApp: { ...st.statusByApp, [app]: s },
      readyApps: { ...st.readyApps, [app]: true },
    }));
    return s;
  },

  async activateToken(app, token) {
    const s = await licenseActivateToken(app, token);
    set((st) => ({
      statusByApp: { ...st.statusByApp, [app]: s },
      readyApps: { ...st.readyApps, [app]: true },
    }));
    return s;
  },

  isLicensed(app) {
    return get().statusByApp[app]?.licensed ?? false;
  },

  isReady(app) {
    return get().readyApps[app] ?? false;
  },

  reset() {
    set({ statusByApp: {}, readyApps: {} });
  },
}));

/** 反应式门控判定（供组件订阅）：fail-closed。 */
export function useIsLicensed(app: string): boolean {
  return useLicenseStore((s) => s.statusByApp[app]?.licensed ?? false);
}

/** 反应式 ready 判定（供 Gate 显 loading）。 */
export function useLicenseReady(app: string): boolean {
  return useLicenseStore((s) => s.readyApps[app] ?? false);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd chayuan-client && pnpm vitest run packages/app/src/features/license/__tests__/licenseStore.test.ts`
Expected: PASS（5/5）。

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
git add packages/app/src/features/license/licenseStore.ts packages/app/src/features/license/__tests__/licenseStore.test.ts
git add -A packages/app/src/features/license/activation.ts packages/app/src/features/license/__tests__/activation.test.ts
git commit -m "refactor(license): store calls backend api, drop PAL activation layer"
```

---

### Task 3: 重写 `LicenseDialog` / `LicenseGate`，删 `config.ts`，更新 `index.ts`

**Files:**
- Modify: `chayuan-client/packages/app/src/features/license/LicenseDialog.tsx`
- Modify: `chayuan-client/packages/app/src/features/license/LicenseGate.tsx`
- Delete: `chayuan-client/packages/app/src/features/license/config.ts`
- Modify: `chayuan-client/packages/app/src/features/license/index.ts`

- [ ] **Step 1: 重写 `LicenseDialog.tsx`**

Replace entire file（fingerprint / buyUrl 改后端取；序列号→store.activateSerial；.lic→store.activateToken；刷新→store.refresh）：

```tsx
/**
 * 授权窗口。spec 的「弹窗：公众号/收款二维码 + 序列号输入 + 确定」。
 *
 * - 指纹 + 购买链接从后端 `/api/v1/license/{fingerprint,buy-url}` 取。
 * - 二维码本地生成（编码后端给的购买链接），手机扫码到在线购买页。
 * - 序列号手输 → store.activateSerial（B1，后端验签）。
 * - 导入 .lic → store.activateToken（Ed25519，后端验签）。
 * - 刷新在线授权 → store.refresh（后端内部做偶尔在线自动激活）。
 */

import { licenseBuyUrl, licenseFingerprint } from '@chayuan/api';
import { getPlatform } from '@chayuan/platform-shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@chayuan/ui';
import QRCode from 'qrcode';
import * as React from 'react';
import { useLicenseStore } from './licenseStore';

export interface LicenseDialogProps {
  app: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function LicenseDialog({ app, open, onOpenChange }: LicenseDialogProps): React.ReactElement {
  const store = useLicenseStore();
  const [qr, setQr] = React.useState<string>('');
  const [buyUrl, setBuyUrl] = React.useState<string>('');
  const [serial, setSerial] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // 取购买链接（后端拼 指纹 + app）→ 生成离线二维码。
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    licenseBuyUrl(app)
      .then((r) => {
        if (alive) setBuyUrl(r.url);
      })
      .catch(() => {
        if (alive) setBuyUrl('');
      });
    return () => {
      alive = false;
    };
  }, [open, app]);

  React.useEffect(() => {
    if (!buyUrl) {
      setQr('');
      return;
    }
    QRCode.toDataURL(buyUrl, { margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(''));
  }, [buyUrl]);

  async function run(fn: () => Promise<{ licensed: boolean; reason?: string }>): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const s = await fn();
      if (s.licensed) onOpenChange(false);
      else setErr(reasonText(s.reason));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const onConfirmSerial = () => run(() => store.activateSerial(app, serial.trim()));
  const onRefreshOnline = () => run(() => store.refresh(app));
  const onImportFile = () =>
    run(async () => {
      const [file] = await getPlatform().fs.pickFiles({ accept: ['.lic', '.txt'] });
      if (!file) return { licensed: false, reason: 'none' };
      const token = (await file.text()).trim();
      return store.activateToken(app, token);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>激活授权</DialogTitle>
          <DialogDescription>手机扫码购买后，把序列号填入下方激活；或导入授权文件。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          {qr ? (
            <img src={qr} alt="购买二维码" width={220} height={220} />
          ) : (
            <div className="h-[220px] w-[220px] animate-pulse rounded bg-muted" />
          )}
          {buyUrl ? (
            <a className="text-xs text-muted-foreground underline" href={buyUrl} target="_blank" rel="noreferrer">
              在手机微信中打开购买
            </a>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="lic-serial">
            序列号
          </label>
          <div className="flex gap-2">
            <Input
              id="lic-serial"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXX"
              autoComplete="off"
            />
            <Button onClick={onConfirmSerial} disabled={busy || serial.trim().length === 0}>
              确定
            </Button>
          </div>
          {err ? <p className="text-sm text-destructive">{err}</p> : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={onImportFile} disabled={busy}>
            导入授权文件
          </Button>
          <Button variant="outline" onClick={onRefreshOnline} disabled={busy}>
            刷新在线授权
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function reasonText(reason?: string): string {
  switch (reason) {
    case 'expired':
      return '授权已过期，请续费。';
    case 'rollback':
      return '检测到系统时间被回拨，请联网校时后重试。';
    case 'mismatch':
      return '该授权不属于本机器。';
    case 'signature':
      return '授权凭证签名校验失败。';
    default:
      return '激活失败，请核对序列号或稍后重试。';
  }
}
```

- [ ] **Step 2: 重写 `LicenseGate.tsx`（加 loading 态）**

Replace entire file:

```tsx
/**
 * 功能门控：spec 的「使用某功能时弹授权窗口」。
 * 包住付费功能入口（如 video-generation）；未授权时渲染锁屏 + 激活入口，授权后透传 children。
 * 首刷未回前显 loading，避免闪锁屏。授权判定 fail-closed（后端 licensed 为唯一真源）。
 */

import { Button } from '@chayuan/ui';
import * as React from 'react';
import { LicenseDialog } from './LicenseDialog';
import { useIsLicensed, useLicenseReady, useLicenseStore } from './licenseStore';

export interface LicenseGateProps {
  app: string;
  children: React.ReactNode;
  title?: string;
}

export function LicenseGate({ app, children, title = '此功能需要授权' }: LicenseGateProps): React.ReactElement {
  const licensed = useIsLicensed(app);
  const ready = useLicenseReady(app);
  const refresh = useLicenseStore((s) => s.refresh);
  const [open, setOpen] = React.useState(false);

  // 进入即刷新后端态（后端内部会 best-effort 偶尔在线自动激活）。
  React.useEffect(() => {
    void refresh(app);
  }, [app, refresh]);

  if (licensed) return <>{children}</>;

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">购买后扫码激活，即可解锁使用。</p>
      <Button onClick={() => setOpen(true)}>购买 / 激活</Button>
      <LicenseDialog app={app} open={open} onOpenChange={setOpen} />
    </div>
  );
}
```

- [ ] **Step 3: 删 `config.ts`，更新 `index.ts`**

```bash
cd /work/chayuan-desktop/chayuan-client
git rm packages/app/src/features/license/config.ts
```

Replace entire `chayuan-client/packages/app/src/features/license/index.ts`:

```ts
// 桌面/网页授权功能（门控 + 激活窗口 + 后端驱动的反应式态）。
export { LicenseGate, type LicenseGateProps } from './LicenseGate';
export { LicenseDialog, type LicenseDialogProps } from './LicenseDialog';
export { useLicenseStore, useIsLicensed, useLicenseReady, type LicenseStatus } from './licenseStore';
```

- [ ] **Step 4: typecheck + biome（app 范围）**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client
pnpm --filter @chayuan/app typecheck
pnpm biome check packages/app/src/features/license
```
Expected: 0 error / 0 diagnostic。若 biome 报既有风格项，仅修本任务触达文件。

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
git add packages/app/src/features/license/LicenseDialog.tsx packages/app/src/features/license/LicenseGate.tsx packages/app/src/features/license/index.ts
git add -A packages/app/src/features/license/config.ts
git commit -m "refactor(license): dialog/gate use backend fingerprint+buy-url, drop embedded keys"
```

---

### Task 4: 用 `LicenseGate` 门控 video-generation

**Files:**
- Modify: `chayuan-client/packages/app/src/features/shell/page-registry.tsx`

说明：page-registry 用 `pattern → render()` 映射。把**生成类**入口（主入口 chat、历史会话、batch、timeline、wizard）包 `<LicenseGate app="video">`；素材库 materials / 我的视频 library 不门控（仅查看）。

- [ ] **Step 1: 加 import**

In `chayuan-client/packages/app/src/features/shell/page-registry.tsx`, add to imports（与其它 feature import 同区）：

```tsx
import { LicenseGate } from '../license';
```

- [ ] **Step 2: 包裹 4 个生成类 render**

In the same file, wrap these render outputs（保持各自既有 props 不变）。逐个修改：

`/video-generation` 主入口：
```tsx
    render: () => (
      <LicenseGate app="video">
        <VgChatPage conversationId={null} />
      </LicenseGate>
    ),
```

`/video-generation/<convId>` 历史会话：
```tsx
    render: (params) => (
      <LicenseGate app="video">
        <VgChatPage conversationId={params.id ? decodeURIComponent(params.id) : null} />
      </LicenseGate>
    ),
```

`/video-generation/batch`：
```tsx
    render: () => (
      <LicenseGate app="video">
        <BatchModePage />
      </LicenseGate>
    ),
```

`/video-generation/timeline`：
```tsx
    render: () => (
      <LicenseGate app="video">
        <VgTimelineEditorPage />
      </LicenseGate>
    ),
```

`/video-generation/wizard`：
```tsx
    render: () => (
      <LicenseGate app="video">
        <VideoGenerationPage />
      </LicenseGate>
    ),
```

> 实现者注：以 grep `pattern: /\^\\/video-generation` 定位各 render 块，逐块对照上面的 props 替换。`batch`/`timeline` 的实际组件名若与此不同，以文件现有 `React.lazy` 变量名为准（已核实为 `BatchModePage` / `VgTimelineEditorPage` / `VideoGenerationPage`）。materials / library 两条**不要**包。

- [ ] **Step 3: typecheck + biome**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client
pnpm --filter @chayuan/app typecheck
pnpm biome check packages/app/src/features/shell/page-registry.tsx
```
Expected: 0 error。

- [ ] **Step 4: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
git add packages/app/src/features/shell/page-registry.tsx
git commit -m "feat(license): gate video-generation entries with LicenseGate"
```

---

### Task 5: 退役 `@chayuan/license` 包

**Files:**
- Delete: `chayuan-client/packages/license/`（整目录）
- Modify: `chayuan-client/packages/app/package.json`（删依赖行）
- Modify: `chayuan-client/vitest.config.ts`（删 alias 行）

- [ ] **Step 1: 确认无残余 import**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client
grep -rn "@chayuan/license" packages apps --include="*.ts" --include="*.tsx" | grep -v "packages/license/"
```
Expected: **0 命中**（Task 2/3 已移除 app 内引用）。若有残余，先清掉再继续。

- [ ] **Step 2: 删包 + 依赖 + alias**

```bash
cd /work/chayuan-desktop/chayuan-client
git rm -r packages/license
```

In `chayuan-client/packages/app/package.json`, delete the line:
```json
    "@chayuan/license": "workspace:*",
```

In `chayuan-client/vitest.config.ts`, delete the line（约 line 17）:
```ts
      '@chayuan/license': resolve(__dirname, 'packages/license/src/index.ts'),
```

- [ ] **Step 3: 重装 workspace + 跑 license 域测试**

```bash
cd /work/chayuan-desktop/chayuan-client
pnpm install
pnpm vitest run packages/app/src/features/license packages/api/src/__tests__/license.test.ts
```
Expected: PASS（Task1+Task2 的全部用例），无 `@chayuan/license` 解析报错。

- [ ] **Step 4: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
git add -A packages/license packages/app/package.json vitest.config.ts pnpm-lock.yaml
git commit -m "chore(license): retire @chayuan/license package (verification moved to python backend)"
```

---

### Task 6: 退役 PAL license（platform-shared + platform-tauri）+ 删交接文档

**Files:**
- Modify: `chayuan-client/packages/platform-shared/src/index.ts`（删 `LicenseCheck`/`ActivationRecord`/`LicenseHostApi` + `Platform.license?` + 注释块）
- Modify: `chayuan-client/packages/platform-tauri/src/index.ts`（删 import、`tauriLicense`、`license: tauriLicense`）
- Delete: `chayuan-client/docs/license-rust-handoff.md`

- [ ] **Step 1: 删 platform-tauri 实现**

In `chayuan-client/packages/platform-tauri/src/index.ts`:
- 删 import 块里的两行（约 line 25-26）：`  LicenseCheck,` 和 `  LicenseHostApi,`。
- 删整段 `tauriLicense`（含上方注释，约 line 211-241：从 `// 指纹 + B1 短码验签走 Rust 命令` 注释块起，到 `const tauriLicense ... };` 整体）。
- 删 `LICENSE_KEY` 常量行（`const LICENSE_KEY = (app: string) => ...`）。
- 删 Platform 装配里的 `    license: tauriLicense,`（约 line 1133）。

- [ ] **Step 2: 删 platform-shared 接口**

In `chayuan-client/packages/platform-shared/src/index.ts`:
- 删 `LicenseCheck` interface（约 line 345-353，含上方 `* - 纯验签算法 ...` ~ `*/` 的 license 注释块）。
- 删 `ActivationRecord` interface（约 line 355-368）。
- 删 `LicenseHostApi` interface（约 line 369-378）。
- 删 `Platform` 里 `  /** 软件授权宿主能力 ... */` 注释 + `  license?: LicenseHostApi;`（约 line 404-405）。

- [ ] **Step 3: 删交接文档 + 确认无残余引用**

```bash
cd /work/chayuan-desktop/chayuan-client
git rm docs/license-rust-handoff.md
grep -rn "LicenseHostApi\|LicenseCheck\|ActivationRecord\|tauriLicense\|\.license\b\|license_fingerprint\|license_verify_shortcode" packages apps --include="*.ts" --include="*.tsx"
```
Expected: **0 命中**（feature 内已不依赖 PAL license；`ActivationStatus`/`LicenseStatus` 是另一套名字，不应命中）。若命中 `platform.license` 之类残余调用，清掉。

- [ ] **Step 4: 全量 typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client
pnpm typecheck
```
Expected: 0 error（platform-shared 删了类型后，无消费者断链）。

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop/chayuan-client
git add -A packages/platform-shared/src/index.ts packages/platform-tauri/src/index.ts docs/license-rust-handoff.md
git commit -m "chore(license): remove PAL license interface + tauri impl + rust handoff doc"
```

---

### Task 7: 全量验证 + 收尾

**Files:** 无（验证任务）

- [ ] **Step 1: 全量 typecheck + biome + 授权域测试**

```bash
cd /work/chayuan-desktop/chayuan-client
pnpm typecheck
pnpm biome check packages/app/src/features/license packages/api/src/license.ts
pnpm vitest run packages/app/src/features/license packages/api/src/__tests__/license.test.ts
```
Expected: typecheck 0 error；biome 0 diagnostic；vitest 全绿。

- [ ] **Step 2: 全仓 vitest（确认无连带回归）**

```bash
cd /work/chayuan-desktop/chayuan-client
pnpm vitest run
```
Expected: 仅既有 2 个**预存在**失败（app/settings fontSize 默认 16 vs 17，与授权无关）；其余全绿。如实记录。

- [ ] **Step 3: 收尾报告**

汇总：改动范围（api 新增 license 客户端、store/dialog/gate 改后端、video-generation 门控、退役 @chayuan/license + PAL license + rust 文档）、验证命令与结果、剩余风险（网页多租户账号制仍为后续；网页共享部署时按单台后端指纹门控）。检查 `git -C /work/chayuan-desktop/chayuan-client status` 无误改无关文件。**不自动提交以外的操作**（各 Task 已分别 commit；是否 push 等用户明确指示）。

---

## Self-Review（计划自检）

- **Spec 覆盖**：design §6「前端改调后端」→ Task 1-3；§6「LicenseGate 门控 video-generation」→ Task 4；§6「退役 @chayuan/license / PAL license / rust handoff」→ Task 5-6；§7「前端 vitest mock fetch 测 refresh/activate/门控」→ Task 1-2 测试。✅
- **Placeholder 扫描**：无 TBD；每个改文件步骤都给了完整代码或精确删除指令。两处「以 grep 结果为准」的回退（`setPlatform` 导出名、render 组件名）均已给出定位命令与已核实默认值，非占位。✅
- **类型一致**：`LicenseStatus` 在 Task 1 定义，Task 2 `export type` 透出、Task 3 经 index 透出，名字全程一致；store 方法签名（`refresh/activateSerial/activateToken/isLicensed/isReady/reset`）在 store 实现、测试、Gate 三处一致；删除项（`enabled/configure/activateOnline/ActivationDeps`）无遗留消费者（Task 6 Step 3 grep 兜底）。✅
- **Scope**：单子系统（chayuan-client 前端授权），适合单计划。website 与 Python 后端不动。✅
