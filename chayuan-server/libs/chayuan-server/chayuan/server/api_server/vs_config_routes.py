"""向量库配置 admin REST(S2)。把原 8502 config_panel/vs_config.py 的 7 种向量库
选型 + 连接测试 + 写盘能力暴露成端点,供 React 控制台「向量库」域消费。

向量库选型存 kb_settings.yaml:DEFAULT_VS_TYPE(默认类型)+ kbs_config.<type>.<field>
(各类型连接参数,保存时只动当前类型、其它类型原样保留)。改后多数模块需重启生效。

端点(均 admin-only):
- GET  /api/v1/admin/vectorstore/schema  返回 7 种类型字段 schema + 当前默认 + 各类型现值(password 脱敏)。
- POST /api/v1/admin/vectorstore/test    {type, values} 连接测试(不落盘)。
- POST /api/v1/admin/vectorstore/save    {type, values, set_as_default} 写 kb_settings.yaml。
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends, HTTPException

from chayuan.server.auth.deps import require_role

vs_config_router = APIRouter(prefix="/api/v1/admin/vectorstore", tags=["admin-vectorstore"])
_ADMIN = require_role("admin")

_MASK = "********"


def reset_vector_store() -> None:
    """丢弃进程内缓存的 kb_settings,使下次建/查向量库按最新 DEFAULT_VS_TYPE +
    kbs_config.<type> 重建。

    向量库本身没有「长连接客户端单例」缓存——``KBServiceFactory.get_service`` 每次
    新建 KBService,所有连接参数从 ``Settings.kb_settings`` **实时读**。真正会让保存
    不生效的缓存是 ``settings_property`` 包的 ``_cached_settings``:它按 yaml mtime
    (整秒粒度)做 LRU 缓存,保存后同一秒内再访问可能拿到旧值。这里显式清掉该缓存,
    下次 ``Settings.kb_settings`` 即强制重读 kb_settings.yaml。
    """
    from chayuan.server import shared
    shared.clear_settings_lru()


def _field_to_dict(f: Any) -> Dict[str, Any]:
    return {
        "name": f.name,
        "label": f.label,
        "widget": f.widget,
        "default": f.default,
        "choices": list(f.choices) if getattr(f, "choices", None) else None,
        "placeholder": getattr(f, "placeholder", "") or "",
        "help": getattr(f, "help", "") or "",
    }


def _type_to_dict(t: Any) -> Dict[str, Any]:
    return {
        "key": t.key,
        "label": t.label,
        "help": getattr(t, "help", "") or "",
        "install_hint": getattr(t, "install_hint", "") or "",
        "fields": [_field_to_dict(f) for f in t.fields],
    }


def _mask_values(t: Any, values: Dict[str, Any]) -> Dict[str, Any]:
    """password 字段非空时脱敏。"""
    out = dict(values)
    for f in t.fields:
        if f.widget == "password" and out.get(f.name):
            out[f.name] = _MASK
    return out


@vs_config_router.get("/schema", summary="[admin] 向量库类型 schema + 当前值")
def vs_schema(_=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel import vs_config, yaml_store

    res = yaml_store.load_yaml("kb_settings.yaml")
    doc = res.doc if res.exists else {}
    default_key = str((doc or {}).get("DEFAULT_VS_TYPE") or "milvus")

    types: List[Dict[str, Any]] = []
    values: Dict[str, Dict[str, Any]] = {}
    for t in vs_config.VS_TYPES:
        types.append(_type_to_dict(t))
        values[t.key] = _mask_values(t, vs_config.load_values(t, doc))

    return {
        "code": 0,
        "msg": "ok",
        "data": {"types": types, "default_type": default_key, "values": values},
    }


def _resolve_type(key: str):
    from chayuan.server.config_panel import vs_config

    t = vs_config.vs_type_by_key(key)
    if t is None:
        raise HTTPException(status_code=404, detail=f"未知向量库类型: {key}")
    return t


def _merge_masked(t: Any, incoming: Dict[str, Any], doc: Dict[str, Any]) -> Dict[str, Any]:
    """password 字段提交值 == _MASK → 用 yaml 里已存的真值替换,避免抹掉密钥。"""
    from chayuan.server.config_panel import vs_config

    stored = vs_config.load_values(t, doc)
    merged = dict(incoming)
    for f in t.fields:
        if f.widget == "password" and merged.get(f.name) == _MASK:
            merged[f.name] = stored.get(f.name, "")
    return merged


@vs_config_router.post("/test", summary="[admin] 向量库连接测试(不落盘)")
def vs_test(body: Dict[str, Any] = Body(...), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel import vs_config, yaml_store

    key = str(body.get("type") or "")
    t = _resolve_type(key)
    incoming = body.get("values") or {}
    if not isinstance(incoming, dict):
        raise HTTPException(status_code=400, detail="values 必须是对象")
    res = yaml_store.load_yaml("kb_settings.yaml")
    doc = res.doc if res.exists else {}
    values = _merge_masked(t, incoming, doc)
    try:
        result = vs_config.validate_connection(t, values, timeout=6.0)
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "message": str(e), "detail": ""}
    return {"code": 0, "msg": "ok", "data": result}


@vs_config_router.post("/save", summary="[admin] 保存向量库配置(写 kb_settings.yaml)")
def vs_save(body: Dict[str, Any] = Body(...), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel import vs_config, yaml_store

    key = str(body.get("type") or "")
    t = _resolve_type(key)
    incoming = body.get("values") or {}
    if not isinstance(incoming, dict):
        raise HTTPException(status_code=400, detail="values 必须是对象")
    set_default = bool(body.get("set_as_default", True))
    res = yaml_store.load_yaml("kb_settings.yaml")
    doc = res.doc if res.exists else {}
    values = _merge_masked(t, incoming, doc)
    changes = vs_config.save_values(t, values, set_as_default=set_default)
    # 热生效:清掉缓存的 kb_settings,下次建/查向量库即按最新 DEFAULT_VS_TYPE + kbs_config 重读。
    reset_vector_store()
    return {
        "code": 0,
        "msg": "ok",
        "data": {"changed": list(changes.keys()), "needs_restart": False},
    }
