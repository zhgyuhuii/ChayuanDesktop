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

logger = logging.getLogger("chayuan.admin.db_config")
db_config_router = APIRouter(prefix="/api/v1/admin/db", tags=["admin-db"])
_ADMIN = require_role("admin")


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
    from chayuan.server.config_panel import yaml_store
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
    from chayuan.server.config_panel.db_config import build_uri, validate_connection, human_summary
    form = _form(body)
    uri = build_uri(form)
    # validate 失败/db_missing 都是正常结果(非业务错误),统一 code:0,结果在 data。
    res = validate_connection(uri, timeout=5)
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


@db_config_router.post("/save", summary="[admin] 保存 SQLALCHEMY_DATABASE_URI(需重启)")
def db_save(body: Dict[str, Any] = Body(default={}), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel import yaml_store
    from chayuan.server.config_panel.db_config import build_uri, validate_connection, human_summary
    form = _form(body)
    uri = build_uri(form)
    validated = validate_connection(uri, timeout=5)
    updates: Dict[str, Any] = {"SQLALCHEMY_DATABASE_URI": uri}
    # SQLite 同步写 DB_ROOT_PATH(向后兼容,与 NiceGUI 行为一致)
    if uri.startswith("sqlite") and form.sqlite_path.strip():
        updates["DB_ROOT_PATH"] = form.sqlite_path.strip()
    yaml_store.save_updates("basic_settings.yaml", updates)
    logger.warning("[db-config] SQLALCHEMY_DATABASE_URI saved: %s", human_summary(form))
    return {
        "code": 0,
        "msg": "ok",
        "data": {"restart_required": True, "masked": human_summary(form), "validated": validated},
    }
