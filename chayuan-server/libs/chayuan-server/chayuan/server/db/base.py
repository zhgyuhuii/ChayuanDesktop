"""SQLAlchemy engine / session 初始化。

按 `basic_settings.yaml` 中的 `SQLALCHEMY_DATABASE_URI` 建立全局 engine；
同时按 `DB_POOL_*` 字段配置连接池，满足多 worker 生产场景。

SQLite 特殊处理：
- SQLite 默认 `NullPool`，而且多线程需要 `check_same_thread=False`；
- 5000 并发下 SQLite 会锁表，这里只做 best-effort 保证单机 dev 能跑通，
  并在启动时 stderr 输出告警；真实上线请按 docs/scalability.md 切 Postgres。
"""
from __future__ import annotations

import json
import logging
import os
import stat
import sys

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import DeclarativeMeta, declarative_base
from sqlalchemy.orm import sessionmaker

from chayuan.settings import Settings


def _ensure_writable(path: str) -> None:
    """尽力补回属主写位(self-heal 只读 db / 目录)。

    SQLite 写库要目录可写(建 -wal/-journal/-shm);db 文件或其目录只读会报
    ``attempt to write a readonly database``。常见于数据目录被某次 sudo/root
    进程创建后,普通用户跑 sidecar 写不动。这里尽力 chmod u+w;若文件/目录被
    **别的用户(root)拥有**,chmod 会 PermissionError —— 那种只能用户
    ``sudo chown -R <自己> <数据目录>`` 修属主,代码救不了,只能在日志里喊。
    """
    try:
        mode = os.stat(path).st_mode
        if not (mode & stat.S_IWUSR):
            os.chmod(path, mode | stat.S_IWUSR)
    except Exception as _e:  # noqa: BLE001
        sys.stderr.write(
            f"[chayuan][db] {path!r} 不可写且无法 chmod({_e!r});"
            f"若是数据目录被 root 拥有,请 `sudo chown -R $(whoami) <数据目录>`。\n"
        )
        sys.stderr.flush()


def _create_sqlite_engine(uri: str, bs):
    """SQLite engine — 跨线程安全 + 不走连接池(避免 writer 锁/超时)。"""
    common = dict(json_serializer=lambda obj: json.dumps(obj, ensure_ascii=False))
    if getattr(bs, "DEPLOYMENT_MODE", "dev") == "prod":
        sys.stderr.write(
            "[chayuan][db] ⚠️  DEPLOYMENT_MODE=prod 但 SQLALCHEMY_DATABASE_URI 仍为 sqlite:"
            "——SQLite 单写者锁在高并发下会导致请求失败。"
            "请参考 docs/scalability.md 切 PostgreSQL。\n"
        )
    else:
        sys.stderr.write(
            "[chayuan][db] 使用 SQLite(单机/桌面默认)。上生产前请切 Postgres,详见 docs/scalability.md。\n"
        )
    sys.stderr.flush()
    # SQLite 不会创建中间目录:父目录缺失 → sqlite3.OperationalError
    # "unable to open database file"。进程重启后 CHAYUAN_ROOT 解析变化 / 数据
    # 目录迁移都可能让父目录不在,这里兜底建一次(幂等),否则每次请求打表都
    # 抛未捕获异常,前端轮询下日志几分钟撑到上百 MB。
    try:
        from sqlalchemy.engine.url import make_url
        db_path = make_url(uri).database or ""
        if db_path and db_path != ":memory:":
            parent = os.path.dirname(os.path.abspath(db_path))
            if parent:
                os.makedirs(parent, exist_ok=True)
                # 自愈只读目录/文件 → 否则 "attempt to write a readonly database"
                _ensure_writable(parent)
                if os.path.isfile(db_path):
                    _ensure_writable(db_path)
    except Exception as _e:  # noqa: BLE001 — 兜底失败不阻断,交给 create_engine 时再报
        sys.stderr.write(f"[chayuan][db] sqlite 父目录兜底创建失败:{_e!r}\n")
        sys.stderr.flush()
    return create_engine(
        uri,
        connect_args={"check_same_thread": False},
        pool_pre_ping=bool(getattr(bs, "DB_POOL_PRE_PING", True)),
        **common,
    )


def _create_pooled_engine(uri: str, bs):
    """非 SQLite engine — 按 DB_POOL_* 配建池(PG/MySQL/...)。"""
    common = dict(json_serializer=lambda obj: json.dumps(obj, ensure_ascii=False))
    pool_size = int(getattr(bs, "DB_POOL_SIZE", 10) or 10)
    max_overflow = int(getattr(bs, "DB_MAX_OVERFLOW", 20) or 20)
    pool_recycle = int(getattr(bs, "DB_POOL_RECYCLE", 3600) or 3600)
    pool_timeout = int(getattr(bs, "DB_POOL_TIMEOUT", 30) or 30)
    pool_pre_ping = bool(getattr(bs, "DB_POOL_PRE_PING", True))
    return create_engine(
        uri,
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_recycle=pool_recycle,
        pool_timeout=pool_timeout,
        pool_pre_ping=pool_pre_ping,
        **common,
    )


def _build_engine():
    """构造全局 engine。

    桌面单机版只 bundle sqlite3 驱动;若 ``SQLALCHEMY_DATABASE_URI`` 指向
    PG/MySQL 但运行时缺对应驱动(``psycopg2`` / ``pymysql`` 等),会在 import
    阶段抛 ``ModuleNotFoundError``,把整条 ``db/models/__init__.py`` 副作用
    导入链条拉爆,后端 sidecar 进程根本起不来。

    单机产品默认应该 sqlite,这里加一道 fallback:
      - 用户选了 sqlite → 正常
      - 用户填了 PG/MySQL URI 但驱动可用 → 正常
      - 用户填了 PG/MySQL URI 但驱动缺失:
        * **单机版**(``is_single_machine()`` True)→ stderr 大声告警 + 回退到默认
          sqlite,让单机用户至少能起服务,自己再去配置面板修 URI;
        * **网络版**(False)→ **不静默回退**。管理员在面板里明明配了 PG/MySQL,
          若驱动缺失就偷偷写 sqlite,数据会落到错误的库里而管理员毫不知情。这里
          直接抛 ``RuntimeError`` 大声失败,提示装驱动后重启,而不是降级吞掉。

    生产部署有真 PG 的场景下 psycopg2 必然装好,不会触发 fallback。
    """
    bs = Settings.basic_settings
    uri = bs.SQLALCHEMY_DATABASE_URI

    if uri.startswith("sqlite:"):
        return _create_sqlite_engine(uri, bs)

    try:
        return _create_pooled_engine(uri, bs)
    except ModuleNotFoundError as e:
        # 延迟导入,避免 base.py 早期导入时产生循环依赖。
        try:
            from chayuan.server.profiles.bootstrap import is_single_machine
            single_machine = bool(is_single_machine())
        except Exception:  # noqa: BLE001
            # 探测失败时按更安全的「非单机」处理:宁可大声失败,也不静默降级 sqlite。
            single_machine = False

        # 复用项目统一的 URL 密码遮蔽器(凭证不入日志/异常)。延迟导入,避免
        # base.py 早期导入时引入 runtime 包的循环依赖。
        from chayuan.server.runtime.credentials import mask_password_in_url
        masked = mask_password_in_url(uri)

        if not single_machine:
            # 网络版:绝不静默回退 sqlite。大声失败,逼运维装驱动。
            msg = (
                f"[chayuan][db] SQLALCHEMY_DATABASE_URI={masked!r} 所需驱动未安装:{e};"
                f"网络版部署禁止静默回退 sqlite(否则数据会落到错误的库)。"
                f"请安装对应驱动(psycopg2 / pymysql 等)后重启服务。"
            )
            _log = logging.getLogger("chayuan.server.db")
            _log.error(msg)
            sys.stderr.write(msg + "\n")
            sys.stderr.flush()
            raise RuntimeError(msg) from e

        # 单机版:回退到默认 sqlite,保证起得来。
        from chayuan.settings import _default_sqlalchemy_uri
        fallback_uri = _default_sqlalchemy_uri()
        sys.stderr.write(
            f"[chayuan][db] ⚠️  SQLALCHEMY_DATABASE_URI={masked!r} 加载失败:{e};"
            f"该驱动未安装(单机版默认仅 bundle sqlite3),回退到 {fallback_uri!r}。"
            f"如需 PG/MySQL,请安装对应驱动包(psycopg2 / pymysql 等)后重启。\n"
        )
        sys.stderr.flush()
        # 同步把 URI 写回 settings 内存里,后续路径(create_tables / ensure_database_from_uri)读到的也是 sqlite,
        # 不然 startup 用的是新 engine、其它代码用 Settings 直读 URI 会两边不一致。
        try:
            bs.SQLALCHEMY_DATABASE_URI = fallback_uri  # type: ignore[misc]
        except Exception:  # noqa: BLE001
            pass
        return _create_sqlite_engine(fallback_uri, bs)


engine = _build_engine()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def probe_db_writable() -> bool:
    """启动期探一次主 DB 是否真能写:取一次写锁(``BEGIN IMMEDIATE``)再 ``ROLLBACK``,
    不改数据。只读 / 打不开时打一条醒目可操作的错误(带库路径 + chown 命令)并返回
    False;正常返回 True。

    背景:数据目录被某次 sudo/root 进程建成 root 属主后,普通用户跑 sidecar 写不动,
    之后**每个** DB 请求(知识库 / 视频任务 / 配置保存)都 500 刷屏却看不出根因。这里
    把它提前到启动期一条大字报。不抛、不阻断启动(配置面板仍可起来供用户修)。transient
    的 busy/locked 不算(避免误报)。用 raw_connection 绕开 SQLAlchemy 隐式事务。
    """
    import logging as _logging
    _log = _logging.getLogger("chayuan.server.db")
    _raw = None
    try:
        _raw = engine.raw_connection()
        _cur = _raw.cursor()
        _cur.execute("BEGIN IMMEDIATE")
        _cur.execute("ROLLBACK")
        _cur.close()
        return True
    except Exception as e:  # noqa: BLE001
        _m = str(e).lower()
        if not ("readonly" in _m or "read-only" in _m or "unable to open" in _m):
            # busy / locked / 非权限类 —— 不是只读/打不开,别误报
            _log.debug("[db-probe] 写探测非权限类异常,忽略:%r", e)
            return True
        try:
            _db_path = engine.url.database or ""
        except Exception:  # noqa: BLE001
            _db_path = ""
        _data_dir = os.path.dirname(_db_path) if _db_path else "<CHAYUAN_ROOT>/data"
        _banner = (
            "\n==================== 察元 数据库不可写 ====================\n"
            f"主数据库写入被拒:{type(e).__name__}: {e}\n"
            f"  库文件:{_db_path or '<未知>'}\n"
            "几乎都是数据目录被 root / 别的用户拥有(某次 sudo 或打包进程建的),\n"
            "当前进程写不动 -> 之后每个 DB 请求都会 500(知识库 / 视频任务 / 配置保存)。\n"
            "修复(改回自己属主后重启服务):\n"
            f'  sudo chown -R "$(whoami)" "{_data_dir}"\n'
            "本次不阻断启动,配置面板仍可打开。\n"
            "========================================================\n"
        )
        _log.error(_banner)
        sys.stderr.write(_banner)
        sys.stderr.flush()
        return False
    finally:
        if _raw is not None:
            try:
                _raw.close()
            except Exception:  # noqa: BLE001
                pass

Base: DeclarativeMeta = declarative_base()


# ---------------------------------------------------------------------------
# Async engine（T7）：懒建；未装 asyncpg/asyncmy/aiosqlite 时返回 None
# ---------------------------------------------------------------------------

_async_engine = None
_async_session_maker = None
_async_tried = False


def _infer_async_uri(sync_uri: str) -> str:
    """sync URI → async URI 简单映射；用户已显式设置 ASYNC_DATABASE_URI 时走那个。"""
    if not sync_uri:
        return ""
    # 常见前缀替换
    mapping = [
        ("postgresql+psycopg2://", "postgresql+asyncpg://"),
        ("postgresql+psycopg://", "postgresql+asyncpg://"),
        ("postgresql://", "postgresql+asyncpg://"),
        ("postgres://", "postgresql+asyncpg://"),
        ("mysql+pymysql://", "mysql+asyncmy://"),
        ("mysql://", "mysql+asyncmy://"),
        ("sqlite:///", "sqlite+aiosqlite:///"),
        ("sqlite:", "sqlite+aiosqlite:"),
    ]
    for a, b in mapping:
        if sync_uri.startswith(a):
            return b + sync_uri[len(a):]
    return sync_uri  # 已经是 async 前缀


def get_async_engine():
    """首次调用时创建 async engine；失败或驱动缺失返回 None（调用方应回退 sync）。"""
    global _async_engine, _async_session_maker, _async_tried
    if _async_engine is not None:
        return _async_engine
    if _async_tried:
        return None
    _async_tried = True
    try:
        from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
        from sqlalchemy.orm import sessionmaker as _sm
        bs = Settings.basic_settings
        uri = (getattr(bs, "ASYNC_DATABASE_URI", "") or "").strip() \
              or _infer_async_uri(bs.SQLALCHEMY_DATABASE_URI or "")
        if not uri:
            return None
        pool_size = int(getattr(bs, "DB_POOL_SIZE", 10) or 10)
        max_overflow = int(getattr(bs, "DB_MAX_OVERFLOW", 20) or 20)
        pool_recycle = int(getattr(bs, "DB_POOL_RECYCLE", 3600) or 3600)
        pool_pre_ping = bool(getattr(bs, "DB_POOL_PRE_PING", True))
        kwargs = {}
        if uri.startswith("sqlite+aiosqlite"):
            kwargs["connect_args"] = {"check_same_thread": False}
        else:
            kwargs.update({
                "pool_size": pool_size, "max_overflow": max_overflow,
                "pool_recycle": pool_recycle, "pool_pre_ping": pool_pre_ping,
            })
        _async_engine = create_async_engine(
            uri, json_serializer=lambda obj: json.dumps(obj, ensure_ascii=False),
            **kwargs,
        )
        _async_session_maker = _sm(
            _async_engine, class_=AsyncSession, expire_on_commit=False,
        )
        return _async_engine
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"[chayuan][db] async engine 初始化失败（回退 sync）：{e!r}\n")
        _async_engine = None
        _async_session_maker = None
        return None


def get_async_session_maker():
    """返回 async sessionmaker 或 None。"""
    if _async_session_maker is not None:
        return _async_session_maker
    if get_async_engine() is None:
        return None
    return _async_session_maker
