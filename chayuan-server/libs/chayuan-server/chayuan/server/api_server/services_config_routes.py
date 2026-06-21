"""服务配置 / 运行时 admin REST(P6)。只读就绪状态 + 框架健康 + 外部运行时端点注册。
复用 service_checks.probe_all / runtime_framework_panel.probe_all_frameworks /
external_runtimes。框架容器启停(docker compose up/down)风险高且无现成顶层函数,延后。
"""
from __future__ import annotations

import dataclasses
from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends

from chayuan.server.auth.deps import require_role

services_config_router = APIRouter(prefix="/api/v1/admin/services", tags=["admin-services"])
_ADMIN = require_role("admin")


@services_config_router.get("/readiness", summary="[admin] 基础设施/默认模型就绪状态卡")
def services_readiness(_=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel import service_checks
    try:
        statuses = service_checks.probe_all()
        ready = service_checks.system_ready(statuses)
    except Exception as e:  # noqa: BLE001
        return {"code": 1, "msg": f"探测失败：{e}", "data": {"statuses": [], "system_ready": False}}
    return {
        "code": 0,
        "msg": "ok",
        "data": {
            "statuses": [dataclasses.asdict(s) for s in statuses],
            "system_ready": bool(ready),
        },
    }


@services_config_router.get("/frameworks", summary="[admin] 运行时框架健康卡(只读)")
def services_frameworks(_=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel.runtime_framework_panel import probe_all_frameworks
    try:
        healths = probe_all_frameworks(force=False)
    except Exception as e:  # noqa: BLE001
        return {"code": 1, "msg": f"探测失败：{e}", "data": {"frameworks": []}}
    out: List[Dict[str, Any]] = []
    for h in healths:
        spec = getattr(h, "spec", None)
        out.append({
            "name": h.name,
            "label": getattr(spec, "label", h.name) if spec else h.name,
            "state": h.state,
            "url": h.url or "",
            "models_served": getattr(h, "models_served", 0),
            "capabilities": list(getattr(spec, "capabilities", []) or []) if spec else [],
        })
    return {"code": 0, "msg": "ok", "data": {"frameworks": out}}


@services_config_router.get("/external", summary="[admin] 列出已注册的外部运行时端点")
def services_external_list(_=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel.external_runtimes import list_external_runtimes
    return {"code": 0, "msg": "ok", "data": {"runtimes": list_external_runtimes()}}


@services_config_router.post("/external", summary="[admin] 注册/更新一条外部运行时端点")
def services_external_set(body: Dict[str, Any] = Body(default={}), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel.external_runtimes import set_external_url
    name = (body.get("name") or "").strip()
    url = (body.get("url") or "").strip()
    health_path = body.get("health_path")
    enabled = bool(body.get("enabled", True))
    if not name or not url:
        return {"code": 1, "msg": "name 和 url 必填", "data": {}}
    ok, message = set_external_url(name, url, health_path=health_path, enabled=enabled)
    return {"code": 0 if ok else 1, "msg": message, "data": {"ok": ok, "message": message}}


@services_config_router.post("/external/probe", summary="[admin] 探测外部端点连通(不落盘)")
def services_external_probe(body: Dict[str, Any] = Body(default={}), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.config_panel.external_runtimes import probe_external
    url = (body.get("url") or "").strip()
    if not url:
        return {"code": 0, "msg": "ok", "data": {"ok": False, "message": "url 为空"}}
    ok, message = probe_external(url)
    # 探测结果统一 code:0,ok 在 data,避免前端拆壳抛异常。
    return {"code": 0, "msg": "ok", "data": {"ok": ok, "message": message}}
