# 服务版部署指纹 DB 化（多节点一致的席位授权）—— 设计

- 日期: 2026-06-24
- 状态: 已定稿(用户审过 4 节)
- 仓库: chayuan-server(唯一改动);chayuan-client / website 零改动
- 关联记忆: [[project_web_seat_licensing]] [[reference_license_serial_system]] [[terminology-single-machine-vs-network]]

## 1. 背景与问题

网络版(服务版)按席位收费。当前「部署指纹」`deployment_fingerprint()` = `secrets.token_hex(16)`,
首次生成持久化到**本地文件** `$CHAYUAN_ROOT/deployment_id.json`;已激活席位令牌存本地
`deployment_license.json`。问题:

- 本地文件**每节点各一份**,多节点集群(多容器/多副本)各自指纹不同、激活不互通 →
  无法「一个部署一份席位授权」。
- 用户主诉:购买上报的部署指纹(如 `dd5989a4cb24fd196263f0d953ba305e`)「好像不对,
  要与前端/服务器是一套指纹」。根因即「部署身份散在各节点本地文件,不是一份共享真源」。

### 已核实的现状(只读调查)

- 席位链路全集中在 `server/license/seat.py` + `server/api_server/license_routes.py`。
  - 本地文件读写点:`deployment_id.json`(读 seat.py:37 / 写 seat.py:46);
    `deployment_license.json`(读 seat.py:54、79;license_routes.py:246 / 写 seat.py:62、125、164)。
  - 关键函数:`deployment_fingerprint`/`read_deployment_license`/`write_deployment_license`/
    `effective_max_users`/`assert_seat_available`/`activate_deployment_token`/
    `activate_deployment_shortcode`/`activate_deployment`。
  - 席位拦截:`auth/service.py:create_user` → `assert_seat_available()`(达上限抛 `SeatLimitReached`)。
  - 单机短路:`effective_max_users`(seat.py:77 返 None)、`post_deployment_activate`(license_routes.py:260)。
- DB 层:Alembic 迁移(最近 0024_roles)、`session_scope()`、热更 `rebuild_engine()` 均现成;
  无 KV 表,但 `VgSourcesConfigModel`/`RoleModel` 是单例/配置表模板。SQLite(单机)+ Postgres(网络)均兼容。
- **前端零改动**:`DeploymentStatusPanel.tsx` 只展示 `/deployment/status` 返回的 `fingerprint`,不自算。
- **website 零改动**:seat 令牌/短码的 `fp` 是**买家上报透传**,website 仅校验 `^[0-9a-f]{16,64}$` 后原样签发,
  自己不计算指纹;新指纹仍是 16~64 hex,正则已覆盖。

## 2. 用户确认的需求(5 条)

1. 服务版授权以**部署**为单位,一部署一个稳定唯一指纹。
2. 指纹**真源在共享 DB**,多节点读同一份;前端展示/购买上报/令牌校验全用这一个 = 「一套指纹」。
3. 已激活席位令牌也落 DB,激活在集群内全节点生效。
4. 迁移已有本地随机指纹进 DB,保老令牌不失效。
5. website 签发侧——经核实为透传,**无需改**(原计划「一并改」在事实面前归零)。

## 3. 数据模型

新建单例表 `deployment_identity`(仿 `VgSourcesConfigModel` 单主键风格),整部署一行:

```
DeploymentIdentityModel  (__tablename__ = "deployment_identity")
  key          String  主键,固定常量 'deployment'(保证单例)
  fingerprint  String  部署指纹(opaque hex)
  license_json Text    已激活席位令牌 dict 的 JSON(maxUsers/expireAt/fp/token|serial/activatedAt);未激活为 NULL
  updated_at   DateTime server_default=func.now(), onupdate=func.now()
```

- **DB 即真源**:所有节点读同一行 → 多节点一致;指纹与已激活 license 同在此行。
- 单机版(`is_single_machine()`)逻辑不碰此表;`effective_max_users` 单机短路返 None 不变。

## 4. 指纹「值」的口径(关键决策)

- 服务版**只有一个指纹** = `deployment_identity.fingerprint`。前端展示它、购买上报它、令牌校验它,
  全读这一份 DB 值 —— 这就是「一套」。
- 桌面版「机器指纹」(`license/fingerprint.py` 的 `fingerprint()`,16-hex)是**另一版本(单机)**的概念,
  只在 `LicenseDialog`/`ShareDialog` 出现,与服务版不同屏不并存,不构成「两套」。
- **生成方式保持现状** `secrets.token_hex(16)`(32-hex)。理由:值长度/格式不影响正确性,
  而改格式会让已签发的 Ed25519 令牌/短码 `fp-mismatch` 失效。「一套」靠 DB 共享同一值实现,
  不靠让它长得像机器指纹。**不做** token_hex(8) 之类外观对齐(引入长度不一致,无收益)。

## 5. seat.py 改造

新增一个薄持久层(放 seat.py 内或新 `seat_store.py`),封装对 `deployment_identity` 的读写,
所有 DB 访问走 `session_scope()`:

- `deployment_fingerprint(root)`:读 DB 行的 fingerprint;不存在则**迁移/生成**(见 §6)后返回。
- `read_deployment_license(root)`:读 DB 行的 license_json(反序列化);无则 None。
- `write_deployment_license(root, data)`:写 DB 行的 license_json(upsert)。
- `effective_max_users` / `assert_seat_available` / `activate_*`:逻辑不变,
  只是 license 来源由文件改 DB;`activate_*` 成功后 `write_deployment_license` 落 DB。
- `license_routes.py` 端点签名/返回结构不变(`/deployment/status` 仍返 `fingerprint` 等),仅底层换 DB。

## 6. 迁移与并发

- **一次性迁移(首次访问、DB 行不存在时)**:
  - 若本地 `deployment_id.json` 存在 → **导入其 fp 进 DB**(老部署已绑此 fp 购买,必须保留,令牌不失效);
    否则 `secrets.token_hex(16)` 新生成。
  - 若本地 `deployment_license.json` 存在且 DB license 为空 → 一并导入 license_json。
- **Alembic 迁移** `0025_deployment_identity`(参考 0024_roles 模板):建表;`_has_table` 幂等;
  PG advisory lock 已有。**不在迁移脚本里**做本地文件导入(迁移脚本不应读 CHAYUAN_ROOT 文件)——
  文件导入放运行时首次访问逻辑(§6 第一条),保证任何启动路径(alembic / create_all)都覆盖。
- **多节点并发初始化**:`key='deployment'` 唯一主键;两副本同时 insert → 一个成功、
  另一个捕获 IntegrityError 后重读(insert-or-get 模式)。
- **激活并发**:沿用进程内 `_mutate_lock` + DB upsert(last-write-wins);激活是管理员偶发动作,
  无需跨节点分布式锁。
- 迁移导入后旧 JSON 文件**不再读写**(留作只读痕迹无妨);DB 为唯一真源。

## 7. 边界与兼容

- 单机版:`is_single_machine()` 短路全部保留;单机不建/不读此表(effective_max_users 早返 None)。
- 前端、website:零改动(§1 已核实)。
- `/deployment/status`、`/deployment/activate` 协议不变,前端无感。
- DB 不可用:`create_user` 本就依赖 DB,DB 不可用时创建用户已失败,席位检查随之失败,行为可接受。

## 8. 测试(py311 本机可跑)

- 改造现有 `test_seat_core.py`/`test_seat_create_user.py`/`test_seat_activate.py`:夹具改用 tmp sqlite + DB 真源。
- 新增回归:
  1. **迁移导入**:预置本地 `deployment_id.json`(+可选 `deployment_license.json`)→ 首次访问后 DB 行 fp/license 与文件一致(老令牌不失效)。
  2. **insert-or-get 竞态**:模拟 DB 已有行时再次"初始化"不覆盖、返回既有 fp。
  3. **激活落 DB 全可见**:activate 后,新建 `session_scope` 读 license 可见(模拟另一节点)。
  4. 单机短路:`is_single_machine()` 下 effective_max_users 仍 None、不碰表。

## 9. 验证计划

- `PYTHONPATH=.../chayuan-server pytest -q tests/unit_tests/test_seat_*.py` 全绿(py311)。
- `python -m py_compile` 改动的 .py。
- 迁移:本机 sqlite 跑一次 `bootstrap()`/alembic 确认建表幂等。
