# 首页页脚重设计 — Design Doc

- 日期：2026-06-07
- 范围：`chayuan-client`（desktop React 应用 shell + 首页）
- 状态：已与用户对齐，待写实施 plan

## 背景与目标

当前存在两个「页脚」，用户的 3 条需求横跨两者：

1. **全局底部状态栏** `features/shell/AppFooter.tsx`（28px 薄条）：左「北京智灵鸟科技中心 出品 · aidooo.com」+ 中间走马灯 `HomeFooterMarquee` + 右能力状态点。
2. **首页内页脚卡片** `features/home/HomePage.tsx`（349–370 段）：左「察元 AI · 本地优先的办公 AI 工作台」+「今日剩余…」权益行；右「关注我们」(hover 二维码) +「购买」按钮 +「招商合作」。

目标：
- 版权简化为「北京智灵鸟科技 / aidooo.com」，移入左侧菜单栏底部、与菜单对齐、随菜单折叠而折叠。
- 删走马灯。
- 首页页脚改两列：左两个常驻二维码（关注我们 / 购买），右权益 + 购买按钮 + 授权码激活区。
- 移除招商合作。

## 现状关键事实（已核对源码）

- shell 布局在 `router/Chrome.tsx`：`grid-cols-[256px_1fr]`（折叠 `64px_1fr`）。`collapsed` 是 `Chrome` 的 React local state（line 52），透传给 `Sidebar`。
- `Sidebar.tsx`：`<aside flex h-full flex-col>`；「最近对话」div 有 `flex-1`（展开态），底部目前只有 admin 按钮（仅 admin 角色）。折叠态各菜单项 `{!collapsed && ...}` 隐藏文字。
- `AppFooter.tsx`：`grid grid-cols-[auto_minmax(0,1fr)_auto]`，左版权 / 中 `HomeFooterMarquee` / 右能力状态点。它只在主列底部（不跨侧边栏）。
- `HomeFooterMarquee.tsx` 仅被 `AppFooter` 使用（实现前再 grep 复核）。
- `LicenseDialog.tsx` 可复用零件：`licenseBuyUrl(app)`→购买 URL→`QRCode.toDataURL`→购买码（指纹后端拼入）；`licenseFingerprint()`；`useLicenseStore().activateSerial(app, serial)`；`reasonText(reason)` 错误文案；`FOLLOW_QR_URL`（公众号/关注我们码，来自 `lib/brandAssets`）。
- `HomePage.tsx` 页脚：`EntitlementsLine`（6 项 today 剩余 + 会员到期）、`QrChip`（hover 码）、`buyOpen` state、`LicenseDialog app="chat"`、`PartnershipBanner compact`。

## 设计

### ① 侧边栏底部版权（`Sidebar.tsx`）

- 在 `<aside>` 末尾、admin 块之后新增版权块，用 `mt-auto` 顶到底（折叠态无 `flex-1` 列，靠 `mt-auto` 贴底）。
- 展开（256px）：两行「北京智灵鸟科技」+「aidooo.com」链接（`https://aidooo.com` `target=_blank rel=noopener noreferrer`），同列同宽、`px` 与菜单对齐、不超出。
- 折叠（64px）：仅一个小图标（lucide 图标，如 `Bird`/品牌 logo），居中；`title` = 「北京智灵鸟科技 · aidooo.com」。
- 这是版权唯一来源（从 AppFooter 移来）。

### ② 全局底部状态栏（`AppFooter.tsx`）

- 删左侧版权块（已移侧边栏）、删中间 `<HomeFooterMarquee/>` 及其 import。
- 仅保留右侧能力状态点，整条右对齐：grid 三列 → `flex justify-end`（或单列 grid 右对齐），高度 `h-7` 不变。
- 删 `HomeFooterMarquee.tsx` 文件（grep 复核无其他引用后）。

### ③ 首页内页脚卡片（`HomePage.tsx` 349–370 段）— 两列

```
┌─────────────────────────────────────────────────────────────┐
│ ┌─────┐ ┌─────┐    今日剩余 对话5 视频3 数字人2 …    [购买]   │
│ │ QR  │ │ QR  │                                              │
│ │关注 │ │购买 │    已购买? 授权码[__________] [激活]         │
│ │我们 │ │     │    忘记授权码?关注公众号查询                 │
│ └─────┘ └─────┘                                              │
└─────────────────────────────────────────────────────────────┘
```

- 左列：两个常驻二维码（去掉 hover `QrChip`）。「关注我们」= `FOLLOW_QR_URL`；「购买」= `licenseBuyUrl('chat')` 动态码。
- 右列上：`EntitlementsLine`（保留 6 项）+「购买」按钮 → 点开 `LicenseDialog`（`buyOpen` state 保留）。
- 右列下：「已购买?」+ 授权码 `Input` +「激活」按钮 → `activateSerial('chat', serial)`；失败 `reasonText()`，成功后 invalidate `['license.statuses']` 刷新权益；下方小字「忘记授权码?关注公众号查询」（文案，指向左侧关注我们码）。
- 移除 `PartnershipBanner`（grep 确认 HomePage 仅此一处用到则连 import 删）。

### 复用

- 抽一个轻量 `useBuyQr(app)` hook（`licenseBuyUrl` + `QRCode.toDataURL`），首页内联购买码与 `LicenseDialog` 共用，避免复制。
- 授权码激活 `app='chat'`，与页脚购买按钮一致。

### 不动

- 能力状态点判定逻辑、`LicenseDialog` 弹窗本体、权益数据源、设置「我的权益」面板、支付渠道 logo。

## 验证

- `cd /work/chayuan-desktop/chayuan-client && npm run typecheck`
- 视觉自查：展开/折叠侧边栏看版权；状态栏无走马灯且状态点右对齐；首页页脚两列、两码常驻、购买开弹窗、授权码激活成功/失败提示。
- 重建 desktop + 重启 sidecar 后用户实测（用户常测旧版，改完提醒重建）。

## 已知点 / 风险

- `activateSerial` 的 `app` 参数：序列号本身编码模块，后端校验 `invalid-app`。沿用 `'chat'` 与现有页脚购买按钮一致；若后端要求按序列号产品校验，后续按需调整。
- 折叠态版权图标取舍：用通用 lucide 图标，无品牌 logo 资源时不引新资源。
