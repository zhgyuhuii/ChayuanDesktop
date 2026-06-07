# 首页页脚重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把版权移入侧边栏底部并随折叠收起、删全局走马灯、首页页脚改两列（左两常驻二维码/右权益+购买+授权码激活）、移除招商合作。

**Architecture:** 纯前端改动，集中在 `chayuan-client/packages/app`。版权从 `AppFooter` 移到 `Sidebar`；走马灯组件删除；首页页脚段重排为两列并内联复用购买二维码（新 `useBuyQr` hook）与激活逻辑（`licenseStore.activateSerial` + `LicenseDialog.reasonText`）。

**Tech Stack:** React 18 + TypeScript、TanStack Query、`@chayuan/ui`、`qrcode`、Tailwind（`var(--cy-*)` 主题变量）。

**验证约定（本项目）：** app 包无组件级单测框架；chayuan-client 既定验证为 `npm run typecheck` + 触达文件 `npx eslint`，外加人工视觉自查。每个任务以 typecheck/eslint 为门，最后统一视觉验收。**不自动 commit/push**（仓库 root 所有，提交需 sudo，且仅用户明确要求时才提交）。

---

## File Structure

- `packages/app/src/features/shell/Sidebar.tsx` — 修改：底部新增版权块（唯一来源）。
- `packages/app/src/features/shell/AppFooter.tsx` — 修改：删左版权块 + 中走马灯，只留右状态点。
- `packages/app/src/features/home/HomeFooterMarquee.tsx` — 删除（仅 AppFooter 用）。
- `packages/app/src/features/license/useBuyQr.ts` — 新建：购买二维码 hook（复用）。
- `packages/app/src/features/license/LicenseDialog.tsx` — 微改：`export` 既有 `reasonText` 供首页复用。
- `packages/app/src/features/home/HomePage.tsx` — 修改：页脚段重排、删 `QrChip`/`PartnershipBanner` 使用、新增内联二维码卡 + 授权码激活块。

---

## Task 1: 侧边栏底部版权块

**Files:**
- Modify: `packages/app/src/features/shell/Sidebar.tsx`

- [ ] **Step 1: 加 brandAssets import**

在现有 import 区（`import { useTranslation } from '../../i18n';` 之后）加一行：

```tsx
import { CHAYUAN_LOGO_URL } from '../../lib/brandAssets';
```

- [ ] **Step 2: 在 `</aside>` 之前插入版权块**

在 admin 块（`{user?.role === 'admin' && ( ... )}` 整段，约 line 288–299）之后、`</aside>`（约 line 300）之前插入：

```tsx
      {/* 底部:版权(唯一来源,从 AppFooter 移来)。mt-auto 贴底:
          折叠态没有「最近对话」flex-1 列时也能顶到底。 */}
      <div className="mt-auto border-t border-[var(--cy-border-subtle)] px-3 py-2">
        {collapsed ? (
          <div className="flex justify-center" title="北京智灵鸟科技 · aidooo.com">
            <img
              src={CHAYUAN_LOGO_URL}
              alt="北京智灵鸟科技"
              className="h-5 w-5 rounded"
              draggable={false}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 text-[11px] leading-tight text-[var(--cy-text-tertiary)]">
            <span className="truncate">北京智灵鸟科技</span>
            <a
              href="https://aidooo.com"
              target="_blank"
              rel="noopener noreferrer"
              className="truncate font-medium text-[var(--cy-text-secondary)] underline-offset-2 hover:text-[var(--cy-text-primary)] hover:underline"
            >
              aidooo.com
            </a>
          </div>
        )}
      </div>
```

- [ ] **Step 3: typecheck + eslint**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client && npm run typecheck
npx eslint packages/app/src/features/shell/Sidebar.tsx --quiet
```
Expected: typecheck PASS（0 error）；eslint 对该文件 0 新增 error。

---

## Task 2: 全局状态栏去版权 + 去走马灯

**Files:**
- Modify: `packages/app/src/features/shell/AppFooter.tsx`
- Delete: `packages/app/src/features/home/HomeFooterMarquee.tsx`

- [ ] **Step 1: 删走马灯 import**

删除该行（约 line 28）：

```tsx
import { HomeFooterMarquee } from '../home/HomeFooterMarquee';
```

- [ ] **Step 2: 改 footer 容器为右对齐 flex，删左/中两块**

把 `<footer>` 的 className（约 line 209–219）从三列 grid 改为右对齐 flex：

原：
```tsx
        'grid h-7 min-h-7 items-center gap-4 border-t px-3',
        'grid-cols-[auto_minmax(0,1fr)_auto]',
        'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]',
        'text-[11px] text-[var(--cy-text-tertiary)] select-none',
```
改为：
```tsx
        'flex h-7 min-h-7 items-center justify-end gap-4 border-t px-3',
        'border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]',
        'text-[11px] text-[var(--cy-text-tertiary)] select-none',
```

然后删除「左:版权」块（约 line 221–237，`{/* 左:版权 + 主站(静态) */}` 起的整个 `<div>`）和「中:动态走马灯」块（约 line 239–243，`{/* 中:动态走马灯 ... */}` 起的整个 `<div className="min-w-0 overflow-hidden">…</div>`）。保留「右:capability 状态点」块（`<div className="flex items-center gap-3 whitespace-nowrap">…</div>`）不变。

- [ ] **Step 3: 删走马灯文件**

```bash
cd /work/chayuan-desktop/chayuan-client
grep -rn "HomeFooterMarquee" packages/app/src   # 预期:仅 HomeFooterMarquee.tsx 自身,无其他引用
sudo rm packages/app/src/features/home/HomeFooterMarquee.tsx
```
Expected: grep 仅命中 `HomeFooterMarquee.tsx` 自身定义；删除成功。
（注：`globals.css` 的 `@keyframes chayuan-marquee` 无害保留，不动。）

- [ ] **Step 4: typecheck + eslint**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client && npm run typecheck
npx eslint packages/app/src/features/shell/AppFooter.tsx --quiet
```
Expected: typecheck PASS；eslint 0 新增 error。

---

## Task 3: 购买二维码复用 hook

**Files:**
- Create: `packages/app/src/features/license/useBuyQr.ts`

- [ ] **Step 1: 新建 hook 文件**

```tsx
import { licenseBuyUrl } from '@chayuan/api';
import QRCode from 'qrcode';
import * as React from 'react';

/**
 * 取购买链接(后端把本机指纹 + app 拼进 URL)并本地生成二维码 dataURL。
 * 供首页内联购买码复用,逻辑与 LicenseDialog 的「扫码购买」一致(不含 share 分支)。
 */
export function useBuyQr(app: string): { qrDataUrl: string; buyUrl: string } {
  const [buyUrl, setBuyUrl] = React.useState('');
  const [qrDataUrl, setQrDataUrl] = React.useState('');

  React.useEffect(() => {
    let alive = true;
    licenseBuyUrl(app)
      .then((r) => { if (alive) setBuyUrl(r.url); })
      .catch(() => { if (alive) setBuyUrl(''); });
    return () => { alive = false; };
  }, [app]);

  React.useEffect(() => {
    if (!buyUrl) { setQrDataUrl(''); return; }
    let alive = true;
    QRCode.toDataURL(buyUrl, { margin: 1, width: 220 })
      .then((d) => { if (alive) setQrDataUrl(d); })
      .catch(() => { if (alive) setQrDataUrl(''); });
    return () => { alive = false; };
  }, [buyUrl]);

  return { qrDataUrl, buyUrl };
}
```

- [ ] **Step 2: typecheck + eslint**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client && npm run typecheck
npx eslint packages/app/src/features/license/useBuyQr.ts --quiet
```
Expected: typecheck PASS；eslint 0 error。

---

## Task 4: 导出 reasonText 供复用

**Files:**
- Modify: `packages/app/src/features/license/LicenseDialog.tsx`

- [ ] **Step 1: 给 reasonText 加 export**

把（约 line 425）：
```tsx
function reasonText(reason?: string): string {
```
改为：
```tsx
export function reasonText(reason?: string): string {
```

- [ ] **Step 2: typecheck**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client && npm run typecheck
```
Expected: PASS（仅加 export，不改逻辑）。

---

## Task 5: 首页页脚两列重排

**Files:**
- Modify: `packages/app/src/features/home/HomePage.tsx`

- [ ] **Step 1: 调整 import**

(a) lucide 行（约 line 24–27）去掉 `QrCode`（删 `QrChip` 后无用），保留 `ShoppingCart`。改为：
```tsx
import {
  Library, Pen, ScanText, Mic, Clapperboard, UserRound,
  AlertCircle, Film, ShoppingCart,
} from 'lucide-react';
```

(b) react-query 行（约 line 23）加 `useQueryClient`：
```tsx
import { useQuery, useQueryClient } from '@tanstack/react-query';
```

(c) 删除 PartnershipBanner import（约 line 40）：
```tsx
import { PartnershipBanner } from './PartnershipBanner';
```
（删掉整行。）

(d) 新增以下 import（放在 license import 附近）：
```tsx
import { Button, Input } from '@chayuan/ui';
import { useLicenseStore } from '../license/licenseStore';
import { reasonText } from '../license/LicenseDialog';
import { useBuyQr } from '../license/useBuyQr';
```

- [ ] **Step 2: 替换页脚 section（约 line 349–370）**

把原 `{/* ── 6+7. 紧凑页脚 ... */}` 注释 + `<section>…</section>` + `<LicenseDialog .../>`（349–370）整段替换为：

```tsx
      {/* ── 页脚:左两个常驻二维码 / 右权益 + 购买 + 授权码激活 ── */}
      <section className="relative z-10 flex flex-col gap-4 rounded-2xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-4 py-3 sm:flex-row sm:items-stretch sm:justify-between">
        {/* 左:两个常驻二维码 */}
        <div className="flex shrink-0 items-start gap-3">
          <QrCard label="关注我们" src={FOLLOW_QR_URL} />
          <BuyQrCard />
        </div>
        {/* 右:权益 + 购买 + 授权码激活 */}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 sm:items-end">
          <div className="flex w-full items-center justify-between gap-3 sm:justify-end">
            <EntitlementsLine />
            <button
              type="button"
              onClick={() => setBuyOpen(true)}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 text-xs font-medium text-white transition-opacity hover:opacity-90"
            >
              <ShoppingCart className="h-3.5 w-3.5" /> 购买
            </button>
          </div>
          <LicenseActivateInline />
        </div>
      </section>
      <LicenseDialog app="chat" open={buyOpen} onOpenChange={setBuyOpen} />
```

- [ ] **Step 3: 替换 QrChip 组件为 QrCard + BuyQrCard + LicenseActivateInline**

把 `QrChip` 组件定义（约 line 442–455 整个 `const QrChip … );`）替换为：

```tsx
// ── 常驻二维码小卡(不再 hover) ─────────────────────────────────────
const QrCard: React.FC<{ label: string; src: string }> = ({ label, src }) => (
  <div className="flex flex-col items-center gap-1">
    <img
      src={src}
      alt={label}
      className="h-24 w-24 rounded-lg bg-white object-contain p-1"
      draggable={false}
    />
    <span className="text-[11px] text-[var(--cy-text-secondary)]">{label}</span>
  </div>
);

// ── 购买二维码(动态,复用 useBuyQr) ────────────────────────────────
const BuyQrCard: React.FC = () => {
  const { qrDataUrl } = useBuyQr('chat');
  return (
    <div className="flex flex-col items-center gap-1">
      {qrDataUrl ? (
        <img
          src={qrDataUrl}
          alt="购买二维码"
          className="h-24 w-24 rounded-lg bg-white object-contain p-1"
          draggable={false}
        />
      ) : (
        <div className="h-24 w-24 animate-pulse rounded-lg bg-[var(--cy-surface-2)]" />
      )}
      <span className="text-[11px] text-[var(--cy-text-secondary)]">购买</span>
    </div>
  );
};

// ── 已购买:输入授权码激活(复用 licenseStore.activateSerial + reasonText) ──
const LicenseActivateInline: React.FC = () => {
  const store = useLicenseStore();
  const qc = useQueryClient();
  const [serial, setSerial] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState(false);

  const onActivate = async () => {
    const s = serial.trim();
    if (!s) return;
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      const r = await store.activateSerial('chat', s);
      if (r.licensed) {
        setOk(true);
        setSerial('');
        void qc.invalidateQueries({ queryKey: ['license.statuses'] });
      } else {
        setErr(reasonText(r.reason));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-1 sm:items-end">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-[var(--cy-text-tertiary)]">已购买?</span>
        <Input
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          placeholder="输入授权码"
          autoComplete="off"
          className="h-7 w-44 text-xs"
        />
        <Button
          size="sm"
          className="h-7"
          onClick={() => void onActivate()}
          disabled={busy || serial.trim().length === 0}
        >
          激活
        </Button>
      </div>
      {err ? <p className="text-[11px] text-[var(--cy-danger-500)]">{err}</p> : null}
      {ok ? <p className="text-[11px] text-[var(--cy-brand-600)]">激活成功,权益已更新</p> : null}
      {!err && !ok ? (
        <p className="text-[11px] text-[var(--cy-text-tertiary)]">忘记授权码?关注公众号查询</p>
      ) : null}
    </div>
  );
};
```

- [ ] **Step 4: typecheck + eslint**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client && npm run typecheck
npx eslint packages/app/src/features/home/HomePage.tsx --quiet
```
Expected: typecheck PASS；eslint 对 HomePage 0 新增 error（特别确认无未用 import：`QrCode`、`PartnershipBanner` 已删）。

---

## Task 6: 整体视觉验收

- [ ] **Step 1: 全量 typecheck**

```bash
cd /work/chayuan-desktop/chayuan-client && npm run typecheck
```
Expected: PASS。

- [ ] **Step 2: 重建 desktop + 重启 sidecar 后人工自查**

（用户常测旧版，务必先重建。）逐项确认：
- 侧边栏展开：左下角「北京智灵鸟科技 / aidooo.com」两行，与菜单同列对齐、不超宽；点 aidooo.com 开浏览器。
- 侧边栏折叠（64px）：左下角只剩 logo 小图标，hover 出「北京智灵鸟科技 · aidooo.com」。
- 全局底部状态栏：无走马灯、无版权，能力状态点右对齐。
- 首页页脚：左两个常驻二维码（关注我们 / 购买）；右上「今日剩余…」+「购买」按钮（点开完整弹窗）；右下「已购买? 输入授权码 [激活]」+「忘记授权码?关注公众号查询」；无招商合作。
- 输入错误授权码 → 红字错误（reasonText）；正确 → 「激活成功,权益已更新」且今日剩余刷新。

---

## Self-Review（已核对）

- **Spec 覆盖**：① 侧边栏版权 → Task1；② 删版权+走马灯 → Task2；③ 两列页脚（两二维码/权益+购买/授权码激活/移除招商合作）→ Task5；复用 hook → Task3；reasonText 复用 → Task4。无遗漏。
- **占位扫描**：无 TBD/“适当处理”等；所有代码步给出完整代码。
- **类型一致**：`useBuyQr` 返回 `{ qrDataUrl, buyUrl }`，Task5 用 `qrDataUrl`；`activateSerial(app, serial): Promise<LicenseStatus>`，`LicenseStatus` 含 `licensed/reason`，Task5 读 `r.licensed/r.reason` 一致；`reasonText` 在 Task4 导出、Task5 导入一致。
- **既有未用 import**：`ALIPAY_QR_URL/WXPAY_QR_URL` 改前即导入未用，属既有状态，本计划不动以免扩大范围。
