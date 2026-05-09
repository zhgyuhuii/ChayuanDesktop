"""单机模式 profile 的具体重写实现(``CLAUDE.md §3.3``)。

把 SaaS 形态用到的一组实现替换为单机版本:

| 能力       | 默认(SaaS)          | 单机模式                                  |
| :--------- | :-------------------- | :---------------------------------------- |
| 鉴权       | JWT / OAuth           | 匿名 ``LocalUser``(``id="local"``)       |
| 缓存       | Redis                 | 进程内 ``cachetools.TTLCache``            |
| 队列       | Celery / RabbitMQ     | ``asyncio.Queue`` + 线程池                |
| 限流       | Redis 分布式令牌桶    | 进程内令牌桶                              |
| 全文检索   | ES / OpenSearch       | SQLite FTS5                               |
| 向量       | Milvus / Qdrant       | sqlite-vec(Phase 4)                      |
| 关系库     | PostgreSQL            | SQLite + WAL                              |
| 对象存储   | S3 / OSS              | 本地文件                                  |
| 可观测     | Langfuse / Prometheus | 本地 OTLP file exporter(默认关) + 日志   |
| 模型       | 内部模型网关          | 本地 ONNX + 用户配置厂商                  |

本模块只**改 Settings**,不直接 import 上面这些后端实现 —— 后端实现的 import
路径分别由 ``auth/`` ``cache/`` ``ingest_queue/`` ``retrieval/`` 等模块自己
读 Settings 决定。这样 SaaS 路径的代码完全不变,profile 改了哪几个开关清晰可见。
"""
from __future__ import annotations

import logging
from typing import Any, Dict

logger = logging.getLogger("chayuan.profiles.single_machine")


# 单机模式约定:用户身份是固定的 "local",``role=owner`` 让所有 ``require_role``
# 直接通过(单机用户对自己机器上的数据有最高权限)。
# ``id="local"``(字符串)与 SaaS 自增 int id 不冲突 —— 业务代码 user_id 都按
# str 处理也安全。``is_local=True`` 让 audit / log 能识别单机会话。
LOCAL_USER: Dict[str, Any] = {
    "id": "local",
    "username": "local",
    "role": "owner",
    "is_local": True,
}


def local_user() -> Dict[str, Any]:
    """返回单机模式下的固定用户 dict;调用方应 ``.copy()`` 后再 mutate。"""
    return dict(LOCAL_USER)


def apply_single_machine() -> None:
    """重写 ``Settings`` 全局变量,把单机模式所有开关一次性切到位。

    幂等:重复调用结果一致。失败软降级 —— Settings 的某个字段如果不存在
    (老分支没声明该字段),记 warning 但不抛 —— 让 startup 至少能拉起。

    覆盖项:

    1. ``basic_settings.AUTH_REQUIRED = False``
       让 ``get_current_user`` 在游客模式下返回 LocalUser(已有逻辑,只需关闭
       AUTH_REQUIRED 即可)。
    2. ``kb_settings.DEFAULT_VS_TYPE = "sqlite-vec"``
       让 ``KBServiceFactory.get_service("default")`` 默认走 ``SqliteVecKBService``
       (Phase 5.x 实装);未实装前用户显式 ``vs_type="faiss"`` 仍可用。
    3. ``Settings.basic_settings.OBSERVABILITY_ENABLED`` 关闭(若存在);
       Langfuse / 远程 telemetry 默认不启用,本地日志保留。
    """
    from chayuan.settings import Settings

    bs = Settings.basic_settings
    kbs = Settings.kb_settings

    # ── 1. 鉴权:关闭 AUTH_REQUIRED;现有 deps.get_current_user 在 false 时
    #       返游客 dict;auth middleware 同一规则。LocalUser 通过 deps 注入。
    if hasattr(bs, "AUTH_REQUIRED"):
        if bool(getattr(bs, "AUTH_REQUIRED", False)):
            logger.info("[single-machine] AUTH_REQUIRED True → False")
        try:
            setattr(bs, "AUTH_REQUIRED", False)
        except Exception as e:  # noqa: BLE001
            logger.warning("[single-machine] 写 AUTH_REQUIRED 失败:%s", e)
    else:
        logger.warning(
            "[single-machine] basic_settings 不含 AUTH_REQUIRED 字段;跳过"
        )

    # ── 2. KB 默认向量库:走 sqlite-vec
    if hasattr(kbs, "DEFAULT_VS_TYPE"):
        cur = getattr(kbs, "DEFAULT_VS_TYPE", None)
        if cur and str(cur).lower() != "sqlite-vec":
            logger.info(
                "[single-machine] DEFAULT_VS_TYPE %s → sqlite-vec", cur
            )
        try:
            setattr(kbs, "DEFAULT_VS_TYPE", "sqlite-vec")
        except Exception as e:  # noqa: BLE001
            logger.warning("[single-machine] 写 DEFAULT_VS_TYPE 失败:%s", e)
    else:
        logger.warning(
            "[single-machine] kb_settings 不含 DEFAULT_VS_TYPE 字段;跳过"
        )

    # ── 3. 可观测:远程 Langfuse 关掉,本地日志保留
    for attr in ("OBSERVABILITY_ENABLED", "LANGFUSE_ENABLED", "TELEMETRY_REMOTE"):
        if hasattr(bs, attr):
            try:
                setattr(bs, attr, False)
            except Exception as e:  # noqa: BLE001
                logger.warning("[single-machine] 关 %s 失败:%s", attr, e)

    # ── 4. 提示:env 已由 ``chayuan start --single-machine`` 设过;这里再
    #       confirm 一遍,允许其它入口(测试 / pytest fixture)直接 import
    #       apply_single_machine() 走完整环境。
    import os
    os.environ.setdefault("CHAYUAN_PROFILE", "single-machine")
    os.environ.setdefault("CHAYUAN_AUTH", "anonymous")
    os.environ.setdefault("CHAYUAN_REDIS", "disabled")
    os.environ.setdefault("CHAYUAN_QUEUE", "inproc")
    os.environ.setdefault("CHAYUAN_VECTOR_STORE", "sqlite-vec")
    # 单机版打包安装产物不应该触发 pip 自动装 redis / arq 等服务依赖 ——
    # ① 安装目录(C:\Program Files\... / /opt/...)对普通用户只读,pip 必失败;
    # ② 即使能装,单机模式 ``CHAYUAN_REDIS=disabled`` 已经走 inproc 降级,
    #    redis/arq 模块根本不会被业务代码调用,装了也是浪费;
    # ③ 装失败的报错日志(GBK reader 死、镜像不可达)对用户是噪音。
    # ``CHAYUAN_AUTO_INSTALL_DEPS=false`` 让 ensure_pkg 直接返回 False,业务侧
    # 走「无 redis 时降级到 inproc」的代码路径。
    os.environ.setdefault("CHAYUAN_AUTO_INSTALL_DEPS", "false")
