# 后台 React 迁移·MCP 连接管理域 — 设计文档

- 日期：2026-06-20
- 状态：设计已评审通过，待写实施计划
- 范围：config_panel `mcp_manage_page.py`(NiceGUI/952 行) → chayuan-client React。后台迁移第二个域。

## 0. 背景与上层决策（沿用域 1）

后台 config_panel 逐域切 React。元决策已定（见用户管理域 design）：两版本共用 `AdminPage.tsx` + admin JWT；逐域完全切换（REST+React parity→删该域 NiceGUI）；图表 echarts 懒加载（本域用不到图表）。

**本域关键事实**：后端 REST **已完整**（`/api/v1/mcp_connections/*` 的 Connection + Profile CRUD 全有），故本域**几乎纯前端**。

## 1. MCP 传输与 edition（澄清后的结论）

MCP 连接两种 transport：
- **stdio**：MCP 服务与**连接方（chayuan-server 后端）同机**，后端 spawn 本地进程经 stdin/stdout 通信。
- **sse/HTTP**：MCP 服务是远程网址，后端经网络连接。

**结论：不做 stdio 的 edition 门控。** stdio 由**后端**(非浏览器)spawn：单机版后端在用户机、网络版后端在中央服务器。网络版里管理员把 stdio MCP 服务装在服务器主机上，后端 spawn、所有客户端共享。故 stdio 两版本都可用、都正常显示。唯一提示：网络版 stdio 的 `command/cwd/env` 指**服务器主机**文件系统（配置提示，非门控）。

## 2. 落点

- React MCP 页 = `packages/app/src/features/admin/AdminPage.tsx` 新增「MCP」tab（admin JWT，两版本）。
- 组件目录 `packages/app/src/features/admin/mcp/`。

## 3. 后端

**零改动**。`api_server/mcp_routes.py` 已暴露（前缀 `/api/v1/mcp_connections`）：
- Profile：`GET /profile`、`POST /profile`(create/update)、`PUT /profile`、`POST /profile/reset`、`DELETE /profile`。
- Connection：`POST /`、`GET /`(enabled_only?)、`GET /{id}`、`PUT /{id}`、`DELETE /{id}`、`POST /{id}/enable`、`POST /{id}/disable`、`POST /search`、`GET /server/{name}`、`GET /enabled/list`。

不补 REST、不动后端、不加 test-connection（NiceGUI 当前无，不在 parity 内）。

## 4. 前端 API

`packages/api/src/endpoints.ts` 已有 `mcp.*`（Connection CRUD：list/create/detail/update/delete/enable/disable）。**只补 Profile**：
- `mcp.profile.get()` → GET `/mcp_connections/profile`
- `mcp.profile.save(body)` → POST `/mcp_connections/profile`（create-or-update）
- `mcp.profile.reset()` → POST `/mcp_connections/profile/reset`
- `mcp.profile.del()` → DELETE `/mcp_connections/profile`
- Profile 类型 `McpProfile { timeout, working_dir, env_vars, update_time? }`。

## 5. React 组件（对齐 NiceGUI 全 parity）

`features/admin/mcp/`：
- `McpPage.tsx`：编排（McpProfilePanel + McpConnectionList）。
- `McpProfilePanel.tsx`：通用配置——timeout(1-600)、working_dir、env_vars KV 编辑器（动态增删行）+ 更新时间显示 + 保存(POST /profile)/重置(POST /profile/reset)，二次确认。
- `McpConnectionList.tsx`：搜索(server_name/description 前端过滤) + filter(全部/启用/禁用) + 统计行(总/启用/禁用/stdio/sse) + 刷新 + 新建按钮 + 卡片网格(响应式 2 列)。react-query 拉 `mcp.list()`。
- `McpConnectionCard.tsx`：transport 图标+chip、enabled chip、描述(多行截断)、command/url monospace 预览、元信息(timeout/env 数/update_time)、操作行(启停 toggle→enable/disable、编辑、删除→二次确认)。
- `McpEditDialog.tsx`：建/改表单。字段：server_name(建可编辑/改只读)、transport(stdio|sse 下拉)、timeout(1-600)、enabled、description；stdio 专属 command(必填)/args(每行一个)/cwd(可选)/env(KV);sse 专属 url(必填)/headers(KV);高级 config(JSON textarea,merge)。**stdio 区加"路径指服务器主机"提示**。保存 POST `/`(新)或 PUT `/{id}`(改)。
- env_vars / headers 的 KV 编辑器抽成共享小组件 `KvEditor.tsx`（Profile 与连接 env、sse headers 共用）。

## 6. 退役（本域完全切换）

React parity 验证后：删 `config_panel/mcp_manage_page.py` + 去 `dashboard.py` 的 MCP tab 注册。

## 7. 测试

- 前端 typecheck（api + app + web）。
- 手动跑 apps/web admin「MCP」tab，对齐 NiceGUI（Profile 保存/重置、连接建/改/删/启停/搜索/过滤）。
- 无后端改动 → 无新后端测试。

## 8. 明确不做（本域）

test-connection 端点 · stdio edition 门控（已论证不需要）· 后端任何改动 · config_panel 其余域。
