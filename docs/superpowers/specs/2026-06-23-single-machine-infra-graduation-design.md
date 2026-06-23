# 单机内核部署「基础设施按需毕业到外部」设计

- 日期:2026-06-23
- 状态:已批准,已实现(2.0.254)
- 相关:`2026-06-23-config-wizard-and-topology-cleanup-design.md`、记忆 `project_config_wizard_topology_hotapply`

## 背景与问题

网络版后台「配置向导」已可在管理员首登时弹出(2.0.253 修复了单机内核 + 真实 admin 的部署也展示向导)。但用户用 `docker-compose.single.yaml`(单机内核:无 Redis/Milvus/外置 DB,bundled 本地模型)部署,**目的正是靠向导把外部基础设施配起来**。

问题:单机 profile 在每次启动时**硬覆盖**子系统实现,导致向导里配的外部基础设施重启被冲回单机兜底:

- `apply_single_machine()` 无条件 `setattr(kb_settings.DEFAULT_VS_TYPE = "sqlite-vec")`;
- `docker-compose.single.yaml` 用 env `CHAYUAN_REDIS=disabled` / `CHAYUAN_VECTOR_STORE=sqlite-vec` 钉死。

## 关键调研结论(降风险)

四个子系统里,**两个已经尊重 yaml,无需改代码**:

- **关系库 DB**:`db/base.py` 已读 `basic_settings.SQLALCHEMY_DATABASE_URI`(yaml);驱动 `psycopg2-binary` 在 pyproject main 依赖、base 镜像已装;向导 DB 配置页保存前 `validate_connection`,驱动缺失/连不上**在保存时就报错不写盘**,不会静默回退 sqlite。→ 零改动。
- **对象存储 MinIO**:`file_storage/factory.py` 已按配置的 backend 选(minio/local),不可达自动降级本地;`minio` 客户端镜像已装。→ 零改动。
- **缓存/队列 Redis**:`shared.get_redis()` **只读 `basic_settings.REDIS_URL`**(yaml),空→None→调用方走 inproc;**根本不读 `CHAYUAN_REDIS` env**。`redis` 在 main 依赖、镜像已装。→ env 纯属误导,去掉即可。
- **向量库**:外部走 `DEFAULT_VS_TYPE`(yaml)→ `ExternalVsConnector`;`CHAYUAN_VECTOR_STORE` env 只在**本地**向量库路径内选实现(仅 sqlite-vec),不决定本地/外部路由。`pymilvus` 在 main 依赖、镜像已装。→ 唯一真改 = `apply_single_machine` 别硬覆盖外部配置。

## 设计(方案 A:扩展现有「尊重显式配置」模式)

沿用 `apply_single_machine()` 已有先例——`AUTH_REQUIRED` 已经尊重 `CHAYUAN_AUTH_REQUIRED`(注释明确「让单机也能跑多用户,无需另发 profile」)。把同样的「显式配了就尊重」推广到向量库,并把真源统一到 yaml。

**统一规则(对所有形态一致,无需按 `_managed()` 分叉)**:

```
向导/yaml 显式配了外部实现?
  ├─ 是 → 用外部实现(Milvus / Redis / Postgres / MinIO)
  └─ 否 → 单机兜底(sqlite-vec / inproc / sqlite / 本地文件)
```

桌面匿名单机零回归:它的 yaml 没有外部配置 → 永远落单机兜底。

### 代码改动

1. **`profiles/single_machine.py`**
   - 新增纯函数 `is_external_vs_type(vs_type) -> bool`:本地兜底类型集 `{"", "sqlite-vec", "sqlitevec", "sqlite_vec", "faiss", "none"}` 以外即外部。
   - `DEFAULT_VS_TYPE` 覆盖条件化:`is_external_vs_type(cur)` 为真则尊重(记 info 日志、不回退);否则兜底 `sqlite-vec`。
   - 移除 `os.environ.setdefault("CHAYUAN_REDIS", ...)` 与 `CHAYUAN_VECTOR_STORE`(真源归 yaml,这两个 env 本就不被运行时读)。保留 `CHAYUAN_QUEUE=inproc`(队列不外部化)、`CHAYUAN_AUTH=anonymous`、`CHAYUAN_AUTO_INSTALL_DEPS=false`。

2. **`docker-compose.single.yaml`**:移除 `CHAYUAN_REDIS: disabled` 与 `CHAYUAN_VECTOR_STORE: sqlite-vec`,加注释说明真源统一在向导写的 yaml。

3. **测试**(`tests/unit_tests/test_profile_single_machine.py`):
   - 更新 `test_apply_single_machine_sets_envs`:不再断言两个已删 env,改断言 apply 后它们不存在。
   - 新增 `test_is_external_vs_type`(纯函数)与 `test_apply_single_machine_respects_external_vs_type`(milvus 不被回退)。

### 不做(明确边界)

- **队列不外部化**:不接 Celery/RabbitMQ,单机内核继续 inproc(用户未要求)。
- **DB 回退严苛度不改**:向导保存时已校验拦截,无需改 `db/base.py`(且引擎在 import 期建,无法在那里查 `admin_exists`)。
- **不动共享 `docker/Dockerfile` 的 baked env**:`CHAYUAN_REDIS/CHAYUAN_VECTOR_STORE` baked 值对运行时 inert(`get_redis` 只读 REDIS_URL、外部 vs 只看 DEFAULT_VS_TYPE),不触以免影响 network/desktop 构建。

### 重启 UX

DB/Redis/向量库为 import/启动期绑定,改配置需重启。单机自重启端点保持禁用(避免杀容器),由各配置页既有的 `needs_restart` 横幅提示管理员手动 `docker compose restart`。

## 验证

- 本机无 py312,跑 AST 自检 + 更新/新增单测,**pytest 待真机**。
- 真机验收:① single.yaml 部署配 Milvus/Redis/Postgres/MinIO → `docker compose restart` 后这些外部实现实际生效、不被冲回单机兜底;② 桌面匿名单机仍全程 sqlite-vec/inproc。
