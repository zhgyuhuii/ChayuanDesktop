# 厂商卡片重设计 — 申请Key/配置 固定右上角(Linear 风)

- 日期:2026-06-23
- 状态:设计已确认,待写 plan
- 范围:`chayuan-client` 单组件 `ProviderCard.tsx`(纯前端、纯布局/样式)

## 背景

用户要求:厂商卡片上的「申请 API Key」「配置」固定在**右上角**(始终可见,而非现在藏在右下角、
hover 才出现);并站在设计师角度,借鉴成熟产品(Linear / Vercel)做得更美观、紧凑。

经 ASCII 草图对比 3 个方向(A Linear 风 / B Cherry Studio 风 / C Raycast 风),用户选 **A**。

## 现状(改造前)

`ProviderCard.tsx` 当前结构:
- 头部 `flex` 行:logo(36px) + 名字 + 状态徽 +(`ml-auto`)catalog 标签(推荐/国内…)在右上。
- 描述在名字下(2 行,处于 logo 右侧文字列内)。
- 能力标签行(上次已做"横向铺满")。
- **右下角** `absolute`:申请Key/安装指南 按钮 + ⚙️ 配置 —— 对 active 卡是 **hover-only**(opacity-0 group-hover)。

## 目标布局(A · Linear 风)

```
┌────────────────────────────────────────┐
│▎ [通] 通义千问  ●已启用        🔑  ⚙️ │  右上角固定操作
│▎      推荐 国内                         │  标签移到品牌名下方
│▎ 阿里云百炼,覆盖对话/视觉/文生图/      │  描述整行 2 行
│▎ 图像编辑等全栈模型。                   │
│▎ ┌对话3──┬视觉2──┬文生图1┬图像编辑1┐  │  能力标签横向铺满(保留)
│▎ └───────┴───────┴───────┴─────────┘  │
└────────────────────────────────────────┘
```

## 设计细节

### 1. 右上角操作簇(核心改动)
- 位置:`absolute top-3 right-3`,取代原右下角 `absolute right-1.5 bottom-1.5` 的按钮组。
- 内容(顺序、逻辑沿用现有,仅挪位 + 改可见性):
  - 🔑 **申请Key / 安装指南**:本地有内置 InstallGuide → 弹 dialog;否则 `installGuideUrl||applyKeyUrl`
    走 `openExternal`。图标:有指南用 Download,否则 KeyRound。仅当 `installGuide||installGuideUrl||applyKeyUrl` 存在才显示。
  - ⚙️ **配置**:`onOpenSettings`;非 admin 不传则不显示(沿用现状)。
- 可见性(关键变化):**始终可见**,不再 hover-only。
  - active(已配置):默认低调 `text-tertiary opacity-70`,卡片 group-hover → `opacity-100`,按钮自身 hover → 填底 `bg-surface-2`。
  - **未配置**:琥珀色高亮 + `opacity-100` 常驻(保留"提示去配置"引导)。
- 图标按钮:26px、圆角、带 `title` tooltip。

### 2. 标签下移
catalog 标签(推荐/国内/国外/本地/聚合)从右上 `ml-auto` 移到**品牌名正下方**一行:
小号 pill(`text-[9px]`)、最多取前 2-3 个,配色沿用现有 tag 配色映射。腾出右上给操作簇。

### 3. 头部与状态
- 头部 `flex` 行:`logo + 文字列(名字+状态徽 / 标签)`,加 `pr-16` 给右上操作簇留安全区(避免名字/状态徽钻到按钮下)。
- 左侧 3px 状态色条保留;名字后保留 `●已启用 / 未配置 / 已禁用` 徽(沿用现有三态 + i18n 文案)。

### 4. 描述 + 能力标签
- 描述移到 header **下方整行**(`line-clamp-2`,`descriptionOverride || description || platform_type`)。
- 能力标签行保持上次的"横向铺满"(`flex-1 basis-16`,`pr-2`)。
- 190px 高度预算:p-4(16)+ header(~36)+ 描述(~28)+ 能力标签(~18)+ 余量,放得下。

### 5. 不动(保留)
logo 永远彩色;能力标签下拉选模型(TypeTagDropdown);InstallGuideDialog;CtaLine(未配置/禁用文案);
React.memo;三态判定 `statusOf`。仅挪位置 + 改可见性,不动业务逻辑。

## 影响范围
- 仅 `chayuan-client/packages/app/src/features/marketplace/components/ProviderCard.tsx`。
- 其它 ProviderCard 消费方(MarketplacePage / ModelHubRow 仅注释引用)props 合同不变,零影响。

## 验证
- `tsc -p packages/app` typecheck。
- 真机:卡片右上角常驻 🔑/⚙️;未配置厂商琥珀高亮;标签在名字下;hover 行为正确。

## 不做(YAGNI)
- 不改 ⚙️ 为带文字按钮(选了 A 的纯图标方向)。
- 不动卡片尺寸/网格列数。
- 不引入新图标库依赖(用现有 lucide:KeyRound/Download/Settings)。
