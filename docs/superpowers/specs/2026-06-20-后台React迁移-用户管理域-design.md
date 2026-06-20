# 后台 React 迁移 · 用户管理域 — 设计文档

- 日期：2026-06-20
- 状态：设计已评审通过，待写实施计划
- 范围：后台 config_panel（NiceGUI/8502）→ chayuan-client React 迁移的**第一个域：用户管理**。其余域（kb/模型/服务/性能/工具/mcp/apps/kb-acl…）是后续独立子项目，不在本文档。

## 0. 背景与上层决策

后台 config_panel 是单机版专属的 NiceGUI 后台（64 文件、约 44K 行、12 个功能域）。决定逐步重构到 chayuan-client React。上层决策（brainstorming）：

1. **面向版本**：两个版本都要（单机 desktop + 网络 web 共用同一套 React 后台）。
2. **迁移策略**：逐域完全切换（每域 REST+React 做到 parity → 删该域 NiceGUI → 下一个域）。
3. **首个域**：用户管理（REST 基本就绪、价值最高、自包含，且闭环席位收费遗留的"达上限禁建"）。
4. **域内**：一口气做到全 parity（对齐 NiceGUI 全套，含 9+ 图表与 AI 画像）。
5. **图表库**：引入 `echarts` + `echarts-for-react`，lazy-load 限定 admin 区（NiceGUI 现用 ECharts，option 可照搬）。

**铁律**：不搞崩单机——NiceGUI users_page 留到 React 达 parity 才删；React admin 走主应用 admin JWT，不动 config_panel 其余页的密码门。

## 1. 落点与鉴权

- React 用户管理页 = 现有 `packages/app/src/features/admin/AdminPage.tsx` 加一个「用户」tab；桌面 Tauri 窗口与 apps/web **同一套 React 代码**。
- 鉴权 = 主应用 **admin JWT**（`require_role("admin")`，与现有 `/auth/users` 一致），非 config_panel 8502 密码门。
- 迁移期并存：config_panel 8502 继续承载未迁的 NiceGUI 域（其密码门管它们）；React admin 承载已迁域。全部域迁完后 config_panel 整体退役。
- 本域切换 = 删 `config_panel/users_page.py` + 去 `dashboard.py` 用户 tab 注册。

## 2. 图表

- `packages/app` 加依赖 `echarts` + `echarts-for-react`，**dynamic import 懒加载**（仅进 admin 分析区时加载，不压主 bundle）。
- 薄封装 `AdminChart.tsx`（懒 ECharts，传 `option`），用户管理 9+ 图全用它，后续图表重域（性能等）复用。NiceGUI 的 ECharts option 对象可大量照搬。

## 3. 新增后端 REST（`require_role("admin")`）

先把 `users_page.py:build_snapshot()` 抽成**框架无关 service** `chayuan/server/admin/users_analytics.py`（NiceGUI 删除前先抽走），再由端点调用。

新增路由文件 `chayuan/server/api_server/admin_users_routes.py`：

1. `GET /api/v1/admin/users/snapshot` → 完整 `UsersSnapshot` JSON：
   - `users[]`：每用户 `{user{id,username,role,email,is_active,created_at,last_login_at}, msg_count, est_tokens, total_chars, avg_feedback, feedback_count, first_active, last_active, model_usage{}, chat_type_usage{}, tool_usage{}, kb_usage{}, heatmap[7][24], recent_queries[{time,chat_type,query,model}]}`
   - 全局：`daily_msg[{date,count}]`、`daily_active[{date,active_users}]`、`total_users`、`active_7d`、`total_messages`、`total_tokens`、`total_feedback`、`avg_feedback`、`top_model[]`、`top_tool[]`、`top_kb[]`、`top_chat_type[]`、`user_model_matrix[{user,model,count}]`、`global_heatmap[7][24]`、`global_heatmap_max`、`feedback_hist[5]`、`generated_at`
2. `POST /api/v1/admin/users/{user_id}/persona-analysis` → `{model, analysis(markdown), generated_at}`；**LLM 调用留后端**（前端不持 key）。错误：404 用户不存在 / 503 无可用 LLM / 500 调用失败。

CRUD 复用现成：`GET /auth/users`（limit/offset）、`POST /auth/users`、`PATCH /auth/users/{id}/password`、`PATCH /auth/users/{id}/active`（均已 `require_role("admin")`）。

## 4. React 组件（对齐 NiceGUI 全 parity）

`packages/app/src/features/admin/users/`：

- `UsersPage.tsx` — 顶层；react-query 拉 snapshot；编排布局。
- `UsersHero.tsx` — 30 日双轴图（消息量柱 + 日活折线）+ 4 KPI 卡（总用户/7日活跃/总消息/总tokens）。
- `UsersTopGrid.tsx` — 6 张 Top10：用户·tokens、用户·消息、模型、工具、KB（横向柱）、对话类型（甜甜圈）。
- `UsersInsights.tsx` — 用户×模型热力（10×10）、全局活跃 7×24 热力、反馈分数雷达。
- `UsersTable.tsx` — 搜索（用户名/邮箱/角色）+ 表（用户/角色状态/消息/tokens/反馈均分/最近活跃）+ 行操作（画像/改密/启停）+ **席位用量条与禁建（§5）**。
- `CreateUserDialog.tsx` — 建用户表单（用户名*/邮箱/密码*/角色）。
- `UserPersonaDialog.tsx` — 头部 + 4 KPI + 4 图（模型/工具/KB/对话类型）+ 个人 7×24 热力 + 最近提问表（Top10）+ AI 画像（调 persona-analysis）。
- `AdminChart.tsx` — 懒 ECharts 封装。

`packages/api/src/admin.ts`（或扩 license/同款模式）：`adminUsersSnapshot()`、`adminUserPersona(id)` + 对应 TS 类型；CRUD 复用/补 `listUsers/createUser/setUserPassword/setUserActive`（若 api 包未有）。

## 5. 闭环席位（接续上一阶段）

- `UsersTable` 顶部用已建的 `deploymentStatus()` 显示 `usedUsers/maxUsers`；`available<=0` 时禁用「新建用户」按钮 + 「升级席位」CTA。
- 桌面（`maxUsers=null`）不显示席位限制（与席位收费的单机短路一致）。
- **这闭环了席位收费阶段标记"待 React 用户管理页"的禁建按钮。**

## 6. NiceGUI 退役（本域完全切换）

React 达 parity 验证后：
- 删 `config_panel/users_page.py`。
- 去 `config_panel/dashboard.py`（及 `app.py` 如有）的用户 tab 注册。
- 逻辑先抽到 §3 service 再删，确保端点有数据来源、聚合行为一致。

## 7. 测试

- 后端 pytest：snapshot 端点（聚合结构/字段正确、空库不崩）、persona 端点（mock LLM、404/503 分支）、admin 鉴权门（非 admin 403）。**沙箱跑不了，待用户机器**（见 reference_py312_test_env）。
- 前端：typecheck（api + app）；snapshot/persona 类型对齐 §3；手动跑 apps/web admin 看与 NiceGUI parity。
- 抽取的 `users_analytics.py` 与原 build_snapshot 行为一致（同一聚合逻辑搬迁，不改算法）。

## 8. 范围与实施分期

- 本文档只覆盖**用户管理域**；其余 11 个域是后续独立 spec→plan。
- 全 parity 但实施 plan 可内部分期（一个 plan 装不下）：
  - **P1 管理核心 + 席位**：snapshot 端点最小版（users 数组 + KPI）+ 用户表 + CRUD + 建表单 + 席位禁建。
  - **P2 分析图表**：Hero 双轴 + 6 Top10 + 3 洞察图（AdminChart/ECharts 接入）。
  - **P3 画像 + AI**：UserPersonaDialog + persona-analysis 端点。
  - 三期全完成（parity）后才删 NiceGUI users_page。

## 9. 明确不做（本域）

config_panel 其余 11 域 · config_panel 整体退役 · 8502 密码门改造 · 单机版 admin 鉴权体系重构（沿用现有 admin JWT）。
