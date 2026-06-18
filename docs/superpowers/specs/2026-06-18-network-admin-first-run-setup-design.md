# 网络版首启管理员设置向导(First-Run Admin Setup)

- 日期:2026-06-18
- 状态:设计已确认,待写实施计划
- 范围:`chayuan-server`(auth)+ `chayuan-client`(web 前端引导门)
- 方案:Approach A(专用 setup 端点 + 专用引导门)+ 机制 1(无显式密码就不预建 admin)

## 1. 背景与问题

网络版/Docker 多用户部署时,管理员账号目前只能靠:启动时 `bootstrap_default_admin()`
按 env `AUTH_DEFAULT_ADMIN_PASSWORD` 建 admin(空密码则随机生成并**打到启动日志**),
运维需从日志捞随机密码。体验差且易错。

目标:**网络版首次访问时,若后端无 admin,弹全屏向导让用户设置 用户名 + 密码 +
实例标识,提交即建 admin 并自动登录。**

关键约束(已与用户确认):
- 仅网络版(`isWeb()`);单机桌面始终游客态,不弹向导,不受影响。
- 设置管理员 ≠ 强制全员登录;是否强制登录仍由 `AUTH_REQUIRED` 独立控制。
- "实例标识/后缀"= 实例名称,仅显示/配置,**不改访问路径**。

## 2. 为什么"表为空"判断会失效(本设计的核心动机)

Docker 启动时 `startup.py` 在任何 web 访问之前就调 `bootstrap_default_admin()`,
compose 默认 `AUTH_DEFAULT_ADMIN_USERNAME=admin` + 空密码 → 随机建好 admin →
首次访问时用户表已非空 → 任何"表为空"触发器永不命中。

**机制 1 的解法**:把"启动即随机建 admin"这个制造非空表的根源去掉 —— 只有显式给了
`AUTH_DEFAULT_ADMIN_PASSWORD` 才预建;否则不建、不打随机密码日志。触发信号用
**"无 admin 账户"**(role=admin 计数为 0),而非"表为空"(防有人先自助注册了普通用户)。

## 3. 后端设计(chayuan-server)

### 3.1 bootstrap 改造 — `auth/service.py::bootstrap_default_admin()`
- 仅当 `AUTH_DEFAULT_ADMIN_PASSWORD` 显式非空时预建 admin(保留运维预置路径)。
- 空密码:不建、不随机生成、不打日志,返回 None → 表里无 admin。
- 影响面:对所有 profile 生效;单机桌面本是游客态、无需 admin,符合预期(见 §6)。

### 3.2 触发检测 + `/auth/config` 扩展
- 新增 `auth/service.py::admin_exists() -> bool`:`COUNT(UserModel WHERE role='admin') > 0`。
- `GET /auth/config` 返回体增 `"admin_setup_required": not admin_exists()`(公开、布尔、无敏感信息)。

### 3.3 新端点 `POST /auth/setup`
- 入参:`{username: str, password: str, instance_name?: str}`。
- 竞态安全:模块级 `threading.Lock` 内**重查 admin_exists()**,为 0 才
  `create_user(username, password, role="admin")`;否则 **409 `admin already exists`**。
- 成功:签发 access+refresh,下发 HttpOnly cookie(复用 `_set_token_cookies`)+ body token,
  返回与 `/login` 一致结构,前端拿到即登录态。
- 校验复用 `create_user`(用户名非空/≤64、密码≥6);确认密码在前端校验。
- `instance_name` 非空则写入 basic_settings(见 3.4)。

### 3.4 实例标识存储
- `basic_settings` 新增 `INSTANCE_NAME`(env `CHAYUAN_INSTANCE_NAME` 可覆盖),
  走 config_panel 现有 yaml 写入路径持久化。
- `/auth/setup` 收到 `instance_name` 即写;空则不写。本期只存+读,前端标题/页眉可展示。

## 4. 前端设计(chayuan-client,web)

### 4.1 Shell 门控优先级 — `Shell.tsx`
拉完 `/auth/config` 后:
1. `admin_setup_required && isWeb()` → 渲染 `AdminSetupGate`(最高优先,盖过 LoginModal)
2. `auth_required && !loggedIn` → 锁定 LoginModal
3. 否则正常
- `useLoginModalStore` 增状态 `adminSetupRequired`(由 config 写入)。
- 单机(`isWeb()` false)永不进分支 1。

### 4.2 `AdminSetupGate` 组件(新)
- 全屏、不可关闭(类似 locked LoginModal)。字段:用户名、密码、确认密码、实例标识(可选)。
- 前端校验:密码≥6、两次一致、用户名非空。
- 提交 → `auth.setupAdmin(...)` → 写 token + 刷新 `useAuthStore` + 重拉 `/auth/config`
  (此时 `admin_setup_required=false`)→ 进入应用。
- 409(被并发抢先)→ 提示"管理员已创建,请登录" → 切到 LoginModal。

### 4.3 API 客户端 — `packages/api/src/endpoints.ts`
- `auth.config()` 返回类型增 `admin_setup_required: boolean`。
- 新增 `auth.setupAdmin({username, password, instanceName?})` → `POST /auth/setup`,复用 `setTokens`。

## 5. 数据流

```
首次访问(web) → Shell 拉 /auth/config
  → admin_setup_required=true → AdminSetupGate
  → 提交 POST /auth/setup {username,password,instance_name}
  → 后端 Lock 内重查无 admin → create_user(role=admin) + 写 INSTANCE_NAME + 签发 token/cookie
  → 前端写 token + 重拉 /auth/config(admin_setup_required=false)→ 进入应用
并发第二人 → /auth/setup 命中 409 → 前端切 LoginModal
```

## 6. 边界与错误处理
- 升级旧实例(老逻辑已随机建过 admin):向导不弹;文档给重置路径(配置面板删用户 / 重置库)。
  全新部署正常。不写"猜测自动 admin"的迁移(无法 100% 辨别,不划算)。
- 自助注册开着:检测的是 admin 计数,普通用户先注册不影响首个 admin 设置。
- 多 worker:`threading.Lock` 仅单进程内有效;上多 worker 需换 DB 级唯一约束/advisory lock
  (已知限制,当前 Docker 走 single-machine 内核单进程)。
- 单机桌面:bootstrap 不再预建 → 游客态不受影响;单机若要 admin 走配置面板(超范围)。
- 首访者信任窗口:无 admin 时谁先打开谁成 admin —— 与一切首启向导同源;文档建议运维在
  初始化期间限制网络可达。

## 7. 测试
- 后端 pytest:`admin_exists` 真值;`/auth/setup` 无 admin 建成功+自动登录、有 admin 返 409;
  `/auth/config` 的 `admin_setup_required` 随状态翻转;`bootstrap_default_admin` 空密码不建、
  给密码才建。
- 前端:`tsc --noEmit`;`AdminSetupGate` 校验逻辑单测可选。
- 注:后端 pytest 需真机(沙箱无依赖),会如实标注。

## 8. 影响的现有模块清单
- 后端:`auth/service.py`(bootstrap 改 + admin_exists)、`api_server/auth_routes.py`
  (/auth/config 增字段 + /auth/setup)、`settings.py`(INSTANCE_NAME)。
- 前端:`Shell.tsx`、`store/loginModal.ts`、`features/auth/AdminSetupGate.tsx`(新)、
  `packages/api/src/endpoints.ts`。
- 不动:单机首启向导 `features/first-run/*`、LoginModal 现有登录/注册逻辑。
