# 历史对话按用户区分（本地隔离 + 服务端持久化）—— 设计

- 日期: 2026-06-24
- 状态: 已定稿(用户审过 4 节)
- 仓库: chayuan-client(前端本地隔离,主体) + chayuan-server(会话持久化,补全)
- 关联记忆: [[project_user_isolation_standard]] [[terminology-single-machine-vs-network]] [[chat-page-per-lane-scoped-composer-store]]

## 1. 背景与根因(已核实)

用户反馈「历史对话应该按用户区分」。调查结论:这是**前端本地存储隔离缺陷**,不在服务端查询层。

- 历史列表 = **本地库**(platform-tauri SQLite / platform-web Dexie 的 `conversations`/`messages` 表)
  ∪ 服务端 `/chat/conversations` 的合并视图(`useConversations.ts:30-62` loadAll,按 remote_id 去重)。
- **本地两表都没有 `user_id` 列**(`platform-tauri/src/index.ts:213-222`、`platform-web/src/index.ts:120-129`)
  → 同一浏览器/同一桌面端**所有账号共用一份表**。
- **登出不清本地、不按用户过滤**(`store/auth.ts:56-62` 只清 zustand user)
  → 同一客户端**切账号后,新用户看到上个用户的全部本地历史** = 「没区分」的直接原因。
- 服务端 `/chat/conversations` → `list_conversations_for_user`(`conversation_repository.py:85`)**已按 user_id 过滤**;
  但实时聊天链路只 `add_message_to_db`(`chat_routes.py:474`),**从不调 `add_conversation_to_db` 创建
  `ConversationModel` 行**(该函数全仓零调用),`remote_id` 也几乎不回填 → 服务端会话表基本是空的,
  可见历史完全由本地库主导。

## 2. 用户确认的决策

1. **策略**:本地加 `user_id` 过滤(保留各用户各自历史),不走「登出清空」。
2. **遗留本地数据**:直接丢弃(migration 清空旧表重建),免误归属。
3. **服务端**:同步补会话持久化(让历史可云端同步 / 跨设备跟随账号)。

## 3. 隔离键(统一语义)

前端用 `localUserId` 作本地隔离键:
- 已登录真实用户(auth user.id 为正整数)→ `String(user.id)`;
- 单机 / 未登录 / GUEST → 固定 `"guest"`。

与服务端 `auth.deps.owner_id_of`(guest→共享)语义对齐。效果:单机版永远 `"guest"`(单人共享、无感);
网络版每个真实用户一份、切账号互不可见。

## 4. 前端本地存储改造(主体)

### 4.1 schema(两 platform)
- `conversations` 表加 `user_id TEXT`;`messages` 表加 `user_id TEXT`。
- 因「旧数据直接丢弃」→ migration **DROP 旧表 + CREATE 新表(带 user_id)**:
  - platform-tauri:plugin-sql migration 升一版,DROP/CREATE `conversations`、`messages`。
  - platform-web:Dexie 升 version,新 stores 定义含 `user_id`(必要时 `.upgrade(tx => tx.table(...).clear())` 清旧)。

### 4.2 persistence.ts
- 所有 CRUD(upsert/list/getMessages/append 等)新增 `userId` 维度:写入带 `user_id`,
  `listLocal` / 读消息按 `user_id = ?` 过滤。

### 4.3 useConversations.ts
- `loadAll` 取当前 `localUserId`,本地查询按它过滤;服务端 `conversations.list` 已按 user(无需改)。
- 切换账号(auth user 变化)时按新 `localUserId` 重载列表(useEffect 依赖 localUserId)。

### 4.4 localUserId 来源
- 从 auth store 读当前 user;`user?.id>0 ? String(user.id) : "guest"`。封装一个小 selector/hook 复用。

## 5. 服务端会话持久化(补全)

- **首次发消息且 conversation_id 无会话行时,自动创建 `ConversationModel`**:id = 客户端传来的
  conversation_id(统一「客户端本地 id = 服务端会话 id」,都用客户端 uuid,免 id 映射),stamp `user_id=uid`。
  复用现成 `add_conversation_to_db`(`conversation_repository.py:8`)。接入点:`chat_routes.py` 的
  `/chat/completions`(~458-483,已有归属校验)与 `/v2/chat`——在 add_message 前若会话不存在则建行。
- 用 `get_conversation_by_id` 判存在;不存在→`add_conversation_to_db(conversation_id=..., user_id=uid, name=首句截断)`。
- 归属校验沿用现有 `_assert_conv_owner` / `chat_routes.py:458-467`(传入他人 conversation_id → 403)。
- `filter_message`(`message_repository.py`)读历史在归属校验**之后**才执行(completions 链已是),
  防越权读;补一道 defense-in-depth:`filter_message` 增可选 `user_id`,调用方从已校验的 uid 传入。

### 5.1 客户端回填 remote_id
- 客户端首条成功后,把本地会话 `remote_id` 置为该 conversation_id(= 服务端会话 id),`synced=true`。
- 列表合并(useConversations)按 remote_id 去重 → 同一会话本地/服务端对齐为一条。

## 6. 边界 / 兼容

- 单机 / guest:服务端按现有裸 uid(guest=-1)stamp `user_id`;前端本地键 `"guest"`。两端自洽,单机零感知。
- 服务端 `/chat/conversations`、`_assert_conv_owner` 协议不变,前端无破坏。
- 旧客户端本地数据丢弃一次性发生在 schema 迁移(用户已接受)。
- legacy `ConversationModel.user_id=NULL` 历史会话:沿用现注释语义(仅 admin 可见),本设计不动。

## 7. 测试

### 前端
- persistence(各 platform 或共享逻辑层):写入带 user_id;list/读消息按 user_id 过滤;
  不同 userId 互不可见。
- useConversations:切换 localUserId 后列表重载且只含该用户。
- (platform schema migration 难单测,靠手动冒烟 + typecheck。)
- 闸门:`cd chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit` = 0。

### 服务端(py311;含 sqlalchemy 的用 importorskip)
- 首消息自动建 `ConversationModel`(带 user_id),`/chat/conversations` 能列出。
- 换用户列表隔离:用户 A 建会话,用户 B 列表看不到。
- 传他人 conversation_id 续聊 → 403(归属校验)。
- `filter_message` 带 user_id 时不返回他人会话消息。
- 单机 guest(-1)路径仍工作。

## 8. 验证计划

- 前端 typecheck 0。
- 服务端 `pytest tests/unit_tests/test_*conversation*|test_*chat*`(真机有 sqlalchemy 时跑;沙箱 importorskip skip)。
- 手动:网络版同一浏览器登 A 建对话→登出→登 B,B 看不到 A 的历史;A 重登历史还在;桌面单机不受影响。
- ⚠ docker 网络版需重建镜像、前端需重新 build / 重启 sidecar 才生效。
