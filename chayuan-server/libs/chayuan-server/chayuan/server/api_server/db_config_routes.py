"""数据库配置 admin REST(P5)。把原 8502 db_config.py 的主业务库卡片能力暴露成端点,
供 React 控制台「数据库」域消费。复用 db_config 的 parse_uri/build_uri/validate_connection/
create_database 与 yaml_store。

⚠️ /create 是 DDL(CREATE DATABASE),admin-only;前端必须二次确认。改 SQLALCHEMY_DATABASE_URI
需重启服务后生效。db_config.create_database 内部已有 _assert_safe_identifier 防注入。
"""
from __future__ import annotations

import dataclasses
import logging
from typing import Any, Dict

from fastapi import APIRouter, Body, Depends

from chayuan.server.auth.deps import require_role
from chayuan.server.config_panel import yaml_store

logger = logging.getLogger("chayuan.admin.db_config")
db_config_router = APIRouter(prefix="/api/v1/admin/db", tags=["admin-db"])
_ADMIN = require_role("admin")


def _validate_uri(uri: str, timeout: int = 5) -> Dict[str, Any]:
    """对提交的 URI 走真实连通性校验(与 /validate 端点同一函数)。

    返回 ``{"ok", "message", "detail", "db_missing"}``。抽成模块级薄包装,便于
    save 流程复用,也便于单测 monkeypatch。
    """
    from chayuan.server.config_panel.db_config import validate_connection
    return validate_connection(uri, timeout=timeout)


def _is_single_machine() -> bool:
    """是否单机版部署。薄包装,便于单测 monkeypatch。

    单机版 CHAYUAN_PROFILE 会在下次启动时把 DB 强制改回 sqlite,因此保存非 sqlite
    配置时需告警(profile_warning)。
    """
    try:
        from chayuan.server.profiles.bootstrap import is_single_machine
        return bool(is_single_machine())
    except Exception as e:  # noqa: BLE001 — 探测失败时按网络版处理(fail-open),但要可见
        logger.warning("_is_single_machine probe failed, assuming network mode: %r", e)
        return False


def _form(body: Dict[str, Any]):
    from chayuan.server.config_panel.db_config import DbFormValues
    return DbFormValues(
        db_type=(body.get("db_type") or "sqlite"),
        sqlite_path=(body.get("sqlite_path") or ""),
        host=(body.get("host") or ""),
        port=str(body.get("port") or ""),
        database=(body.get("database") or ""),
        schema=(body.get("schema") or ""),
        username=(body.get("username") or ""),
        password=(body.get("password") or ""),
        charset=(body.get("charset") or ""),
    )


def _db_types() -> list:
    from chayuan.server.config_panel.db_config import DB_TYPES
    return [
        {
            "key": t.key,
            "label": t.label,
            "has_host": t.has_host,
            "has_schema": t.has_schema,
            "has_charset": t.has_charset,
            "default_port": t.default_port,
            "default_db": t.default_db,
            "default_schema": t.default_schema,
            "default_charset": t.default_charset,
            "driver_hint": t.driver_hint,
            "install_hint": t.install_hint,
        }
        for t in DB_TYPES
    ]


@db_config_router.get("/status", summary="[admin] 当前数据库配置(解析成表单)+ 类型清单")
def db_status(_=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel.db_config import (
        DB_TYPES,
        defaults_for,
        parse_uri,
        human_summary,
    )

    res = yaml_store.load_yaml("basic_settings.yaml")
    uri = str((res.doc or {}).get("SQLALCHEMY_DATABASE_URI") or "").strip()
    form = parse_uri(uri) if uri else defaults_for(DB_TYPES[0])
    return {
        "code": 0,
        "msg": "ok",
        "data": {
            "configured": bool(uri),
            "form": dataclasses.asdict(form),
            "summary": human_summary(form),
            "db_types": _db_types(),
        },
    }


@db_config_router.post("/validate", summary="[admin] 测试数据库连接(只读,不落盘)")
def db_validate(body: Dict[str, Any] = Body(default={}), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel.db_config import build_uri, human_summary
    form = _form(body)
    uri = build_uri(form)
    # validate 失败/db_missing 都是正常结果(非业务错误),统一 code:0,结果在 data。
    res = _validate_uri(uri, timeout=5)
    res["uri_masked"] = human_summary(form)
    return {"code": 0, "msg": "ok", "data": res}


@db_config_router.post("/create", summary="[admin] 创建目标数据库(DDL,敏感)")
def db_create(body: Dict[str, Any] = Body(default={}), _=Depends(_ADMIN)) -> Dict[str, Any]:
    """CREATE DATABASE。前端必须二次确认。内部 _assert_safe_identifier 防注入。"""
    from chayuan.server.config_panel.db_config import create_database, human_summary
    form = _form(body)
    logger.warning("[db-config] CREATE DATABASE requested: %s", human_summary(form))
    res = create_database(form, timeout=5)
    return {"code": 0, "msg": "ok", "data": res}


def _save_db_config(body: Dict[str, Any]) -> Dict[str, Any]:
    """validate-then-save 核心逻辑(纯函数,可单测)。

    流程:
      1. 构造 URI;
      2. **保存前强制校验**——validate 不通过(且非「库不存在」)直接返回 code!=0,
         不落盘,避免把错误配置写进 yaml 让服务下次启动连不上又静默回退 sqlite;
      3. validate 通过(或仅 db_missing,库不存在但能连/认证通过,保存后可自动创建)
         才写 yaml;
      4. 单机版返回 profile_warning=True,提示 CHAYUAN_PROFILE 下次启动会把 DB 改回 sqlite。
    """
    from chayuan.server.config_panel.db_config import build_uri, human_summary
    form = _form(body)
    uri = build_uri(form)
    masked = human_summary(form)

    validated = _validate_uri(uri, timeout=5)
    # db_missing=True:库不存在但连接/认证 OK —— 允许保存,保存后走自动创建链路。
    ok_to_save = bool(validated.get("ok")) or bool(validated.get("db_missing"))
    if not ok_to_save:
        logger.warning(
            "[db-config] 拒绝保存:连接校验未通过 %s -> %s / %s",
            masked,
            validated.get("message"),
            validated.get("detail"),
        )
        return {
            "code": 1,
            "msg": validated.get("message") or "数据库连接校验未通过",
            "data": {
                "saved": False,
                "masked": masked,
                "validated": validated,
            },
        }

    updates: Dict[str, Any] = {"SQLALCHEMY_DATABASE_URI": uri}
    # SQLite 同步写 DB_ROOT_PATH(向后兼容,与 NiceGUI 行为一致)
    if uri.startswith("sqlite") and form.sqlite_path.strip():
        updates["DB_ROOT_PATH"] = form.sqlite_path.strip()
    yaml_store.save_updates("basic_settings.yaml", updates)

    profile_warning = bool(_is_single_machine()) and not uri.startswith("sqlite")
    logger.warning(
        "[db-config] SQLALCHEMY_DATABASE_URI saved: %s (profile_warning=%s)",
        masked,
        profile_warning,
    )
    return {
        "code": 0,
        "msg": "ok",
        "data": {
            "saved": True,
            "restart_required": True,
            "masked": masked,
            "validated": validated,
            "profile_warning": profile_warning,
        },
    }


@db_config_router.post("/save", summary="[admin] 保存 SQLALCHEMY_DATABASE_URI(需重启)")
def db_save(body: Dict[str, Any] = Body(default={}), _=Depends(_ADMIN)) -> Dict[str, Any]:
    return _save_db_config(body)
