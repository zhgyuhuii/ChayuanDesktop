# 后台 React 迁移·工具配置域 — 设计文档

- 日期：2026-06-20
- 状态：设计已评审通过，待写实施计划
- 范围：config_panel `tools_page.py`(NiceGUI/893 行) → chayuan-client React。后台迁移第三个域。

## 0. 背景与上层决策（沿用域 1/2）

后台 config_panel 逐域切 React。元决策已定：两版本共用 `AdminPage.tsx` + admin JWT；逐域完全切换（REST+React parity→删该域 NiceGUI）。

**本域事实**：工具配置 yaml-backed（`$CHAYUAN_ROOT/tool_settings.yaml`，内置 catalog `tools_catalog.json` + 可选 `tools_catalog.override.json` 合并）。REST **大部分已有**，仅缺一个删除端点。无单机/网络差异。

## 1. 落点

- React 工具页 = `packages/app/src/features/admin/AdminPage.tsx` 新增「工具」tab（admin JWT，两版本）。
- 组件目录 `packages/app/src/features/admin/tools/`。

## 2. 后端（最小补丁）

现有（`api_server/tool_routes.py` + `tools/config_service.py`）：
- `GET /tools/catalog` → `{cards:[ToolCardDoc], categories:{}}`（`list_cards()`）。
- `GET /tools/{key}/config` → 单卡（`get_card(key)`）。
- `PUT /tools/{key}/config` `{enabled?, description_override?, values?}` → 更新卡（`update_config(key, ToolUpdate)`，写 yaml）。

**只补**：
- `config_service.delete_config(key)`：从 `tool_settings.yaml` 删整个 `<key>` dict（复用 `yaml_store`，原子写+备份）；key 不在 catalog 抛 KeyError。
- `DELETE /tools/{key}/config` 路由 → 调 `delete_config`，404 if key 不存在。

**"添加工具"复用 `PUT`**：对每个待加 key 发 `PUT /tools/{key}/config` `{enabled:false, values:<defaults>}`（update_config 会把新 key 写进 yaml）。**不加 add-batch / reload-catalog**（YAGNI，前端 refetch catalog）。

## 3. 前端 API

`packages/api/src/endpoints.ts` 加 `tools.*`：
- `tools.catalog()` → GET `/tools/catalog` → `{cards: ToolCard[], categories: Record<string,string>}`
- `tools.getConfig(key)` → GET `/tools/{key}/config` → ToolCard
- `tools.updateConfig(key, body)` → PUT `/tools/{key}/config`，body `{enabled?, description_override?, values?}` → ToolCard
- `tools.deleteConfig(key)` → DELETE `/tools/{key}/config`

类型：
- `ToolField { path; label; widget; min?; max?; step?; default?; help?; options?; model_type? }`（widget: 'switch'|'number'|'select'|'model_select'|'password'|'textarea'|'text'）
- `ToolCard { key; title; icon; category; summary; description; tags: string[]; docs_url?; fields: ToolField[]; values: Record<string,unknown>; enabled: boolean; description_override?: string | null }`

> 字段名以后端 ToolCardDoc 真实序列化为准（实现时核对 `config_service` 的 Pydantic 模型字段；上面是预期，可能差异如 enabled vs use、description_override 命名）。

## 4. React 组件（对齐 NiceGUI 全 parity）

`features/admin/tools/`：
- `ToolsPage.tsx`：编排（ToolsToolbar + 卡片网格）。react-query 拉 `tools.catalog()`。
- `ToolsToolbar.tsx`：搜索框（标题/简介/标签）+ 分类下拉 + 状态下拉（全部/已启用/未启用/未加入）+ 「添加工具」按钮 + 刷新。前端内存过滤。
- `ToolCard.tsx`：图标+标题+分类、启用 switch（已加入）/未加入 badge、描述（3 行截断）、标签 chip + 官网链接、「设置」按钮。toggle 调 `updateConfig(key, {enabled})`。
- `ToolSettingsDialog.tsx`：启用开关 + 可编辑描述（textarea，恢复默认按钮）+ 参数区（动态字段 2 列）+ 移除该工具（`deleteConfig`）/取消/保存（`updateConfig` 带 enabled/description_override/values）。
- `ToolFieldInput.tsx`：按 `field.widget` 渲染——switch / number(min/max/step) / select(options) / **model_select**（调现有"按类型列模型"端点，实现时核对 model_hub/model_platform 的真实路径）/ password / textarea / text。
- `AddToolDialog.tsx`：列 catalog 中"未加入"工具（key 不在已启用集）+ 搜索/分类过滤 + 多选 checkbox + 确认（对每个选中 key `updateConfig(key, {enabled:false, values:defaults})`）。

## 5. 明确不做（本域）

add-batch / reload-catalog 端点（PUT/refetch 替代）· 单机网络差异（无）· config_panel 其余域。

## 6. 退役（本域完全切换）

React parity 验证后：删 `config_panel/tools_page.py` + 去 `dashboard.py` 工具 tab 注册。

## 7. 测试

- 后端 pytest：`config_service.delete_config`（删存在 key 成功、删不存在 key 抛 KeyError）+ `DELETE /tools/{key}/config` 路由（200/404）。**沙箱仅 ast，pytest 待真机**。
- 前端 typecheck（api + app + web）+ 手测 parity（卡片/过滤/启停/设置/字段编辑/添加/移除）。
