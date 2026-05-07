# 鉴权配置 (AUTH_REQUIRED / 注册策略)

察元服务在两种模式下都能跑：

| 模式 | `AUTH_REQUIRED` | 行为 |
|---|---|---|
| **开放** (默认) | `false` | 任何人能直连后端;游客可读公开 KB,登录解锁私有内容 |
| **强制** | `true` | 所有业务接口都拒绝匿名;前端打开主页就弹**不可关闭**的登录框 |

## 切换模式

`docker/prod/chayuan/basic_settings.yaml`(或 `~/chayuan_data/basic_settings.yaml`):

```yaml
AUTH_REQUIRED: true
AUTH_ALLOW_REGISTRATION: true   # 关闭则隐藏注册入口
JWT_SECRET: "change-me-32-char-min"
JWT_ACCESS_TTL_MIN: 60          # access token 60 min
JWT_REFRESH_TTL_DAY: 14         # refresh token 14 天
```

环境变量同样生效:`CHAYUAN_AUTH_REQUIRED=true`、`CHAYUAN_JWT_SECRET=...`。

## 前端联动

前端启动时调 `GET /auth/config`(无需鉴权,公开端点),拿:

```json
{ "auth_required": true, "auth_allow_registration": true }
```

* `auth_required=true` && 未登录 → 主页立即弹 LoginModal;`hideClose / 拦截 Esc / 拦截点遮罩`
* `auth_allow_registration=false` → 隐藏 "现在注册" 链接(LoginModal)
* 登录成功后 lock 自动解除

## 创建第一个 admin

切到 `AUTH_REQUIRED=true` 之前先建好 admin,否则前端会被锁出。两种方式:

**1) Web 注册(若 `AUTH_ALLOW_REGISTRATION=true`)**
```bash
curl -X POST http://127.0.0.1:7861/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"adminpwd"}'
```
然后用 SQL 手动把 `role` 改成 `admin`(避免开放注册 admin 漏洞)。

**2) CLI(推荐生产)**
```bash
cd chayuan-server
python -m chayuan.tools.cli.user_admin create-admin admin
# 提示输入密码;将自动设 role=admin / active=true
```

## 常见排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 前端反复弹"凭据已过期" | refresh token 过期 / clock skew | 检查服务端 `JWT_REFRESH_TTL_DAY`;客户端时钟和服务器差 > 5 分钟会失效 |
| 改密后旧端仍能用 | refresh token 没失效 | 调 `POST /auth/users/{id}/active false` 暂时禁用,再 `true` 启用 |
| `AUTH_REQUIRED=true` 后所有接口 401 | 没改 KB / chat 路由的 dependency | 现在已统一 `require_auth_enabled()`,旧版本要拉最新 |
| 前端弹框关不掉但其实已登录 | hydrate 比 config 慢 | 等 1-2 秒;持续不消失看 console 是否 `Stronghold init failed` |
