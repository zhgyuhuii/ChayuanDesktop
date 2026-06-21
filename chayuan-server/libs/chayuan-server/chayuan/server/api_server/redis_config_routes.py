"""Redis 配置 admin REST(P3)。把原 8502 redis_config.py 的卡片能力暴露成端点,
供 React 控制台「Redis」域消费。复用 redis_config 的 build_url/parse_url/validate_connection
与 yaml_store。改 REDIS_URL 后多数模块需重启生效。
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Body, Depends

from chayuan.server.auth.deps import require_role

redis_config_router = APIRouter(prefix="/api/v1/admin/redis", tags=["admin-redis"])
_ADMIN = require_role("admin")


def _form(body: Dict[str, Any]):
    from chayuan.server.config_panel.redis_config import RedisFormValues
    return RedisFormValues(
        scheme=(body.get("scheme") or "redis"),
        host=(body.get("host") or "127.0.0.1"),
        port=str(body.get("port") or "6379"),
        db=str(body.get("db") or "0"),
        username=(body.get("username") or ""),
        password=(body.get("password") or ""),
    )


def _url_from(body: Dict[str, Any]) -> str:
    from chayuan.server.config_panel.redis_config import build_url
    direct = (body.get("url") or "").strip()
    return direct or build_url(_form(body))


@redis_config_router.get("/status", summary="[admin] 当前 Redis 配置(含表单)+探活")
def redis_status(_=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel import yaml_store
    from chayuan.server.config_panel.redis_config import (
        RedisFormValues,
        parse_url,
        masked_url,
    )

    res = yaml_store.load_yaml("basic_settings.yaml")
    url = str((res.doc or {}).get("REDIS_URL") or "").strip()
    v = parse_url(url) if url else RedisFormValues()
    probe: Dict[str, Any] = {"ok": False, "reason": "未配置"}
    if url:
        try:
            from chayuan.server.shared.redis_health import sync_probe
            ok, reason = sync_probe(timeout=2.0)
            probe = {"ok": bool(ok), "reason": reason}
        except Exception as e:  # noqa: BLE001
            probe = {"ok": False, "reason": str(e)}
    return {
        "code": 0,
        "msg": "ok",
        "data": {
            "configured": bool(url),
            "form": v.to_dict(),
            "masked": masked_url(v) if url else "",
            "probe": probe,
        },
    }


@redis_config_router.post("/test", summary="[admin] 测试 Redis 连通(不落盘)")
def redis_test(body: Dict[str, Any] = Body(default={}), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel.redis_config import validate_connection
    url = _url_from(body)
    res = validate_connection(url, timeout=3.0)
    # 探测失败是正常结果(非业务错误),统一 code:0,ok 标记在 data.ok,避免前端拆壳抛异常吞 detail。
    return {"code": 0, "msg": "ok", "data": res}


@redis_config_router.post("/save", summary="[admin] 保存 REDIS_URL 到 basic_settings.yaml(需重启)")
def redis_save(body: Dict[str, Any] = Body(default={}), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel import yaml_store
    from chayuan.server.config_panel.redis_config import parse_url, masked_url
    url = _url_from(body)
    yaml_store.save_updates("basic_settings.yaml", {"REDIS_URL": url})
    return {
        "code": 0,
        "msg": "ok",
        "data": {"masked": masked_url(parse_url(url)), "restart_required": True},
    }


@redis_config_router.post("/clear", summary="[admin] 清空 REDIS_URL(退化为单机内存模式,需重启)")
def redis_clear(_=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel import yaml_store
    yaml_store.save_updates("basic_settings.yaml", {"REDIS_URL": ""})
    return {"code": 0, "msg": "ok", "data": {"restart_required": True}}
