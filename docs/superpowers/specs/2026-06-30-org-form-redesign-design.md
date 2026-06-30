# 组织管理:新建组织表单重设计 + 工具条图标化

- 日期:2026-06-30
- 范围:chayuan-client 管理后台「组织机构」页(`features/admin/orgs/OrgManagementPage.tsx`)
- 仅网络版后台用;单机版不涉及。

## 背景与问题

1. 新建组织当前用两次 `promptDialog` 串行(名称 → 编码),体验割裂;编码要用户手填英文,对中文组织名很反人类。
2. `+组织 / +根部门 / +子部门 / 删` 都是 ghost 纯文字按钮,视觉上像内容不像按钮。

## 决策(已与用户确认)

1. **编码字段保留**。后端 `organizations.code` = `unique + not null + index`,且 `update_org` 不允许改 code —— 它是组织的稳定业务键(创建后不变,留给未来 SSO/导入/跨系统引用)。后端**零改动**。
2. **编码改为「随名称自动生成 + 可手改」**。
3. **生成规则 = 拼音首字母**:中文每字取拼音首字母,英文每词取首字母,小写拼接(华东研发中心 → `hdyfzx`;East Lab → `el`);与已有组织编码去重,撞则加 `-2`/`-3`。引入 `pinyin-pro`(纯前端、无原生依赖)。
4. **新建独立 `OrgFormDialog` 组件**,单步双字段,替换串行 promptDialog(promptDialog 是通用单字段工具,不塞组织专属逻辑)。
5. **工具条 4 个按钮图标化**(lucide,项目已在用)。

## Section 1 — OrgFormDialog

字段:`name`(必填)、`code`(必填,自动生成可改)。

行为:
- 输入 `name` 时实时生成 `code` 填入,**直到用户手动编辑过 code 框(dirty 标记)后停止自动覆盖**。
- 生成函数 `genOrgCode(name, existingCodes): string`:纯函数,中文取拼音首字母 / 英文取词首字母 / 小写拼接 / 去重加 `-N` / 空回退 `org`。
- 提交校验:name、code 非空 → `orgsApi.create({ name, code })`;后端重复 code 返 400 → `reportError`。

落点:
- `features/admin/orgs/OrgFormDialog.tsx` —— 弹窗组件。
- `features/admin/orgs/genOrgCode.ts` —— 纯函数 + vitest 单测(中文/英文/混合/去重/空回退)。
- 依赖:`packages/app` 新增 `pinyin-pro`。

## Section 2 — 工具条图标

| 按钮 | 改为(lucide 图标 + 文字) |
|---|---|
| +组织 | `Building2` +「新建组织」,outline 样式 |
| +根部门 | `FolderPlus` +「根部门」 |
| +子部门 | `FolderTree` +「子部门」 |
| 删 | `Trash2` +「删除」,危险红 hover |

## 不在范围

- 不新增「编辑组织」功能(后端 code 不可改,用户未要求)。
- 部门新建仍走单字段 `promptDialog`,只换按钮图标。

## 验证

- `genOrgCode` vitest 单测。
- `npm run typecheck`。
- 手动:自动生成 / 手改后不覆盖 / 去重 / 后端唯一冲突报错。
