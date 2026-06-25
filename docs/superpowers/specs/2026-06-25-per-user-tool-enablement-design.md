# 按用户的工具开关(Per-User Tool Enablement)设计

> 状态:设计已与用户确认(2026-06-25)。下一步:writing-plans 写实现计划。

## 目标

网络版多用户场景下,**每个用户自助决定哪些工具出现在自己的对话框里**:用户 A 开启
「搜索引擎」工具,用户 B 没开,则只有 A 能在对话中选用它。单机版(单 guest 用户)保持现状。

## 已确认的决策(brainstorming 结论)

1. **控制方式**:每个用户**自助开关**(个人偏好),管理员不决定某用户能用哪些工具。
2. **配置**:只是**开/关**,工具的 key/参数仍由管理员**全局**配一次(共享配置);本功能不引入按用户的工具配置。
3. **可选池**:用户只能从**管理员全局启用(`tool_settings.yaml` 的 `use:true`)的工具**里挑子集——不会开到没配 key 的工具。
4. **默认**:**opt-out**——新用户/老用户默认能用所有"全局启用"的工具;想精简再自己关。零惊扰。
5. **管理入口**:复用现有「工具」页;普通用户=个人开关视图,管理员额外看到全局配置。

## 现状(代码事实)

- 工具全局注册:`agent/tools_factory/tools_registry.py` + 各 `*.py`;`get_tool()` 返回全部已注册工具。
- 全局启用开关:`tool_settings.yaml` 每工具 `use:true/false`;`GET /tools?enabled=true`
  (`api_server/tool_routes.py:list_tools`)按 `get_tool_config(key).use` 过滤,返回全局启用工具。**无 user 维度**。
- 对话框:前端 `useCatalog` 的 `useTools` 取工具卡 → `CapabilityPickers` 勾选 → `selectedTools`
  →(composer store)→ 作为 `req.tools` 发 `POST /chat/v2/chat`。
- 后端用工具:`chat/graph/nodes.py:_resolve_tools(req.tools)` 从 `get_tool()` **按名直取,无任何 user/enabled 校验**。
- 鉴权:`auth.deps.get_current_user` 返回 `dict`,`user["id"]`(int);guest/未鉴权场景见各路由。
- 无现成"用户偏好"表(`db/models/` 已核对)。
- ⚠ 迁移坑:单机/dev 走 `create_all`(只建**缺失的表**、从不 ALTER 已存在表)。**新建表安全**(会被创建);
  本设计只新增表、不改已有表的列,故单机/网络都生效。

## 架构

沿用「关闭集覆盖」(opt-out):
```
某用户有效工具集 = 全局启用工具(use:true) − 该用户的关闭集
```
关闭集为空(默认/新用户)→ 全部全局启用工具可用(opt-out)。新增的全局工具自动对所有人可见
(不在任何人的关闭集里)。管理员把某工具全局关掉 → 它从所有人的"我的工具"消失(全局优先于个人)。

## 组件与数据流

### ① 数据模型 + 仓库

- 新 model `db/models/user_tool_pref_model.py`:
  - 表 `user_tool_pref`,列 `user_id`(Integer)、`tool_name`(String(128)),复合主键 `(user_id, tool_name)`。
  - 语义:**一行 = 该用户关闭了该工具**(opt-out:不在表=启用)。
- 注册进 `db/models/__init__.py`(令 `Base.metadata.create_all` 建表)。
- 新仓库 `db/repository/user_tool_pref_repository.py`:
  - `list_disabled(user_id: int) -> set[str]`
  - `set_tool_disabled(user_id: int, tool_name: str, disabled: bool) -> None`(disabled=True 插入幂等、False 删除)

### ② 后端 API(`api_server/tool_routes.py`,新增 `get_current_user` 依赖)

- `GET /tools/my` → `BaseResponse`,`data` 为 `[{name, title, description, enabled}]`:
  - 取全局启用工具(复用 `list_tools(enabled=True)` 的过滤:`get_tool_config(key).use==True`);
  - `disabled = list_disabled(user["id"])`(guest/未鉴权 → 空集);
  - 每个工具 `enabled = name not in disabled`。
- `PUT /tools/my/{name}` body `{ "enabled": bool }` → `BaseResponse`:
  - 校验 `name` 属于全局启用工具(否则 404/400);
  - `set_tool_disabled(user_id, name, disabled=not enabled)`;
  - guest/未鉴权:返回成功但不持久化(或 403,见"边界")。

### ③ 对话校验(服务端强制 — 关键)

- 落点:`api_server/chat_routes.py:chatgraph_endpoint` 构造 `ChatRequest`/调用前,
  对 `tools` 做**交集过滤**:`tools = [t for t in tools if t in effective_enabled(user)]`,
  其中 `effective_enabled(user) = 全局启用工具名 − list_disabled(user["id"])`。
- 这样即使前端被绕过、乱传 `req.tools`,**未对该用户启用的工具一律被丢弃**,不会执行。
- 单机/guest:`effective_enabled` = 全部全局启用(不过滤),保持现状。
- 复用为一个 helper(如 `tools/user_tools.py:effective_enabled_tools(user_id) -> set[str]`),供 API ② 与校验 ③ 共用,避免逻辑分叉。

### ④ 前端

- `packages/api/src`(工具相关 api 模块,跟随 `useCatalog`/tools hooks 现有位置):
  - `listMyTools(): Promise<MyToolItem[]>`(GET /tools/my)
  - `setMyTool(name: string, enabled: boolean): Promise<void>`(PUT /tools/my/{name})
- **对话框工具选择器**:`useCatalog` 的 `useTools` 数据源从 `/tools?enabled=true` 改为 `/tools/my`,
  仅渲染 `enabled===true` 的工具。`selectedTools` 行为不变(仍是"本轮选用"的二级选择)。
- **工具页**(`features/tools/ToolsPage.tsx` / `ToolsBoard.tsx`):
  - 普通用户:每张工具卡加"我的开关"(Switch),调 `setMyTool`,乐观更新 + invalidate;
  - 管理员:仍可见/编辑全局配置(现有能力),按 `useIsAdmin` 分视图;
  - 单机版(`isDesktop`):个人开关无害(guest 全开),可保留或弱化。

### ⑤ 边界/兼容

- **opt-out 默认全开**:老用户/新用户无感;`user_tool_pref` 空 → 全部可用。
- **新增全局工具**:自动对所有用户可见(不在关闭集)。
- **全局优先**:管理员 `use:false` 的工具不出现在任何人 `/tools/my`,也不会通过校验 ③。
- **单机版 guest**:②③ 均不按 user 过滤,完全保持现状(与"单机/网络用户隔离标准"一致)。
- **删除用户**:`user_tool_pref` 行可留存(无外键级联也无害);不做额外清理(YAGNI)。

## 测试

- 后端(py 单测):
  - `user_tool_pref_repository`:set_tool_disabled 增/删幂等、list_disabled 返回正确集合。
  - `effective_enabled_tools`:全局启用 − 关闭集;guest(user_id None)→ 全部全局启用。
  - chat 交集过滤:`req.tools` 含未启用项 → 被丢弃;含已启用 → 保留。
- 前端(vitest):
  - 工具选择器从 `/tools/my` 只渲染 enabled 工具。
  - `setMyTool` 乐观更新 + 失败回滚(若实现回滚)。

## 非目标(YAGNI)

- 按用户的工具**配置/密钥**(Q2=A 明确排除)。
- 管理员按用户/角色**授权**工具(Q1=A 明确排除,纯用户自助)。
- 工具的使用配额/审计(已有 license/审计另说,不在本功能)。
