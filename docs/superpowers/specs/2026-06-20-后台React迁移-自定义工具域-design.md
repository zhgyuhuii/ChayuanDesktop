# 后台 React 迁移·自定义工具域 — 设计文档

- 日期：2026-06-20
- 状态：设计已确认，spec 兼作 plan（域小）
- 范围：config_panel `custom_tools_page.py`(NiceGUI/554) → React。后台迁移第 4 域。

## 0. 关键背景

自定义 HTTP 工具的 React UI **已大量存在**：`features/tools/ToolsBoard`(用户端 /tools 市场，page-registry 已挂载)已实现内置+自定义工具合并卡片网格、配置弹窗、OpenAPI 导入、搜索、状态分页。`endpoints.ts` 的 custom + OpenAPI API 全有。

**唯一真缺口 = "测试自定义工具"**（无后端 `/tools/custom/{name}/test`、无前端测试弹窗）。

故本域只做：(a) 补测试端点+UI；(b) admin「工具」tab 改复用 ToolsBoard；(c) 删域 3 重复的 `features/admin/tools/`。

## 1. 后端（补测试端点）

- 新文件 `chayuan/server/tools/custom_tool_test.py`：`build_and_run(spec, param_values) -> dict`——港 `custom_tools_page._do_test` 代入逻辑：
  - 合并 sample：`param_values` 优先，回落 `p.default`，required 缺省用占位（enum[0] / "?" / 1 / 1.0 / True 按 type）。
  - `url = spec.url.format(**sample)`（异常回退原 url）；`remaining = 未出现在 url 占位的参数`。
  - GET：`run_request(method, url, params=remaining, headers, timeout)`；非 GET：body_template 有则 `json.loads(body_template.format(**sample))`（失败退字符串），否则 `remaining`；`run_request(..., json_body=body, ...)`。
  - 返回 `res.to_dict()`。
- `tool_routes.py` 加 `POST /tools/custom/{name}/test` body `{param_values:{}}`：`get_tool(name)`(404 if None) → `build_and_run` → `{"data": result}`。
- 复用 `shared.http_test.run_request` + `ProbeResult`、`custom_tools_store.get_tool`。

## 2. 前端 API

- `endpoints.ts` 加 `tools.testCustom(name, paramValues) -> ProbeResult` + `ProbeResult` 类型 `{ok, status_code, latency_ms, content_type, body_kind, body, truncated, url?, error?}`。

## 3. 测试 UI

- `features/tools/components/CustomToolTestDialog.tsx`：按 `spec.params` 渲染参数输入（name/type/required/default/enum）+「发起调用」(`tools.testCustom`) + 结果展示（HTTP 状态/耗时/CT/body_kind + body pretty）。
- 接入：`CustomToolFormDialog` 编辑态加「测试」按钮打开它（传当前 spec）。

## 4. admin 复用 + 去重

- `ToolsBoard` 加可选 prop `selectable?: boolean`(默认 true)；false 时卡片点击**不写** Composer selectedTools（admin 用）。市场页不传=不变。
- `AdminPage「工具」tab` 改 lazy 渲染 `<ToolsBoard selectable={false} />`，**删** `features/admin/tools/{ToolsPage,ToolCardView,ToolSettingsDialog,ToolFieldInput}.tsx`（域 3 重复）。
- **保留**后端 `DELETE /tools/{key}/config`（域 3 加的，有用）。

## 5. 退役

ToolsBoard 已覆盖 `tools_page.py` + `custom_tools_page.py`。parity 验证后一并删两 NiceGUI 页 + 去 dashboard 两 tab。

## 6. 测试

- 后端 pytest：`build_and_run`（GET 代入 url+params、POST body_template、url.format 异常回退）；`POST /tools/custom/{name}/test` 404。沙箱 ast，pytest 待真机。
- 前端 typecheck + 手测。

## 7. 不做

测试历史/缓存 · 前端直连 HTTP（用后端转发避免 CORS/auth）· 单机网络差异（无）。
