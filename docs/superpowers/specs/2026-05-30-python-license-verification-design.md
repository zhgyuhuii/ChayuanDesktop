# 授权验证迁移到 Python 后端设计（桌面/网页统一）

- 日期：2026-05-30
- 状态：设计待评审
- 涉及：`chayuan-server`（Python 验证）+ `chayuan-client`（前端改调后端）
- 关联：website(aidooo.com) 的微信/支付宝收款 + 序列号签发（不动）；废弃原 Rust 验证路线

## 1. 背景与分工调整

桌面端 chayuan-client（React）本就是访问 Python 后端 chayuan-server（单机版＝本地 sidecar `127.0.0.1:62581`，网页版＝远程同一套 API）。据此把"验证序列号"从原计划的 **Rust** 改到 **Python 后端**，前端（桌面内嵌网页/网页版同一套）直接调本地 API。

**最终分工：**
- **website（aidooo.com，在线，不动）**：收款（微信/支付宝）+ **签发序列号（持私钥）** + 发通知 + `/buy` 二维码页 + `/api/license/entitlement`。
- **chayuan-server（单机 Python，离线为主、偶尔在线）新增 license 模块**：**验证序列号**（嵌入 HMAC 密钥 + Ed25519 公钥）、机器指纹、防回拨激活记录、对前端的 `/api/v1/license/*`。
- **chayuan-client**：把"调 Rust(PAL.license)"改成"**调本地 chayuan-server `/api/v1/license/*`**"。桌面/网页一套。

**为什么 Python**：本地 sidecar 常驻 → 天然离线可用；桌面/网页同一前端调同一 API；用 chayuan-server 已有的 `cryptography>=42` 即可 Ed25519 验签，绕开 Rust 工具链死结。

## 2. Python license 模块（移植，须与 website 字节兼容）

新建 `chayuan/server/license/`（纯逻辑，pytest 可测）：
- `base32.py`：Crockford 解码（去 I/L/O/U，输入容错 O→0、I/L→1）+ mod-37 校验符。
- `codec.py`：6 字节头解包 `ver(4) app(6) durDays(14) issueDate(14) nonce(8)` + 2 保留位；`issueDate` 距 `2026-01-01T00:00:00Z` 天数；`expireAt = issueDate + durDays`。
- `shortcode.py`：B1 短码验签 = `header || hmac_sha256(K, header||fp)[:8]`；`hmac`/`hashlib` 标准库 + 常量时间比较。
- `token.py`：Ed25519 令牌验签 = `base64url(canonicalJSON) . base64url(sig)`；用 `cryptography` 的 `Ed25519PublicKey.verify`。
- `fingerprint.py`：`hex(sha256(machine_uid))[:16]`（8 字节）；machine_uid 用 Python 取（见 §5）。
- `store.py`：防回拨激活记录（落 `chayuan_root/license/<app>.json`）：`{mid, app, expireAt, seenMax, source, credential}`；`seenMax` 单调，`now < seenMax - 1天容差` 判回拨。

**黄金向量（必须 pytest 通过，与 website server/license 同源）：**
| 项 | 值 |
|---|---|
| HMAC key (hex,32B) | `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef` |
| fp (hex,8B) | `1122334455667788` |
| serial | `2101W-0JWN1-MN2JP-9V4QW-MSGJ` |
| 期望 | valid，durDays=30，issueDate=151，expireAt=2026-07-01T00:00:00Z |
| Ed25519 公钥(hex) | `3231bcbd0d6ee9226457ed2ef09ce0117b9f41682255fc8c0f83adca8939c6be` + 对应令牌 |

## 3. API 路由 `api_server/license_routes.py`（挂 `/api/v1/license`）

`server_app.py` 里 `app.include_router(license_router)`。沿用单机匿名透明放行模式。

| 方法 路径 | 作用 |
|---|---|
| `GET /api/v1/license/fingerprint` | 机器指纹（前端生成二维码用） |
| `GET /api/v1/license/buy-url?app=video` | 拼 `<买站>/buy?app=video&mid=<指纹>`（二维码内容） |
| `GET /api/v1/license/status?app=video` | 当前授权态（防回拨 + 过期判定 + 偶尔在线自动激活，见 §4） |
| `POST /api/v1/license/activate {app,serial}` | 验 B1 短码 → 落库 → 返回态 |
| `POST /api/v1/license/activate-token {app,token}` | 验 Ed25519 令牌（.lic 文件/在线）→ 落库 → 返回态 |

返回态形如 `{ licensed: bool, app, expireAt?, source?, reason? }`（reason: none/expired/rollback/mismatch/signature）。

## 4. 偶尔在线自动激活

`GET /status` 时，若本地无有效授权且 **Python 后端此刻能联网**：去 `<买站>/api/license/entitlement?mid&app` 拉 Ed25519 令牌 → 验签 + 校验 mid/exp → 落库（source=online）。断网则用本地已存到期。买站地址来自配置（默认 `https://aidooo.com`，内网可改中继）。契合"偶尔在线、大部分离线"。

## 5. 密钥/配置（chayuan-server 端）

`chayuan/settings.py` 增 license 段（从 env / 配置文件读，桌面打包注入）：
- `LICENSE_HMAC_KEY_V1`（hex，**与 website 同一把**，B1 验签用）
- `LICENSE_ED25519_PUBLIC_KEY`（hex 或 PEM，令牌验签用）
- `LICENSE_ACTIVE_KEY_ID`（默认 1）、`LICENSE_BUY_BASE_URL`（默认 `https://aidooo.com`）、`LICENSE_PRODUCTS`（app→code 映射，如 video=1）

machine_uid：优先复用 chayuan-server 已有机器标识；否则用 `machineid`/读 `/etc/machine-id`、Windows `MachineGuid`、mac 兜底，统一 `sha256(...)[:8] hex`，与 website 的 mid 定义对齐（website 的 mid 由前端二维码携带，桌面前端从 `GET /fingerprint` 取，保证同一来源）。

> 诚实声明：单机 Python 里 HMAC 密钥可被逆向（B1 是已声明的弱兜底，靠机器绑定 + 价值有限兜底，非数学防 keygen）。Ed25519 强路径只用公钥、零机密泄漏。

## 6. 前端 chayuan-client 改造

- `features/license/`：`activation.ts` 的 `verifyShortcode/令牌验签` 从"PAL/本地 TS"改为 **HTTP 调 `/api/v1/license/*`**（经 `@chayuan/api` 或 PAL.net，base 用当前后端 base：桌面 sidecar / 网页远程）。
- `licenseStore`：`refresh/activateSerial/activateToken/activateOnline` 改为调后端；`isLicensed` 逻辑不变（后端返回 licensed）。
- `LicenseDialog`：指纹/二维码内容从 `GET /fingerprint`、`GET /buy-url` 取；序列号输入 → `POST /activate`；`.lic` 导入 → `POST /activate-token`；刷新 → `GET /status`（后端内部做在线自动激活）。
- `LicenseGate` 不变（仍按 `isLicensed` 门控 video-generation）。

**退役（不再用于生产，保留作参照/历史）：**
- `@chayuan/license`（TS 验签核心）—— 互通黄金向量测试保留作跨实现参照；不再被前端用于验签。
- `platform-tauri` 的 `LicenseHostApi` 实现 + `platform-shared` 的 PAL `license` 接口 —— 移除或留空（前端改走后端 API，不再经 PAL）。
- `docs/license-rust-handoff.md` —— 标注"已被 Python 方案取代"。

## 7. 测试

- **Python（pytest）**：base32/codec/shortcode/token 用黄金向量；换机指纹失败；防回拨；过期；store 读写；路由集成（activate→status；activate-token；金额无关，纯验签）。
- **前端（vitest）**：licenseStore 改 HTTP 后用 mock fetch 测 refresh/activate/门控；LicenseDialog 仅 typecheck（渲染留 e2e）。
- **website**：不动，其测试保持绿。

## 8. 范围与非目标

- **做**：Python license 模块 + 路由 + 偶尔在线自动激活；前端改调后端；chayuan-server 密钥/配置注入；退役 Rust/TS 验签层。
- **不做**：website 改动（已够用）；多租户网页账号制（本期机器指纹为主，多租户/账号留后续）；Rust 实现（弃用）。
