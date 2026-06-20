"""开放平台 App 管理 REST。挂 /api/v1/admin/apps。复用 config_panel.apps_store。

app_secret 仅在创建/轮换时明文返回一次;列表/更新返回脱敏值。
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Body, HTTPException, Path as PathParam

from chayuan.server.api_server.api_schemas import BaseResponse

apps_router = APIRouter(prefix="/api/v1/admin/apps", tags=["admin-apps"])


def _store():
    from chayuan.server.config_panel import apps_store as st
    return st


@apps_router.get("", response_model=BaseResponse)
async def list_apps():
    st = _store()
    return {"data": {"apps": [a.to_dict(include_secret=False) for a in st.list_apps()]}}


@apps_router.post("", response_model=BaseResponse)
async def create_app(payload: Dict[str, Any] = Body(...)):
    st = _store()
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name 必填")
    spec = st.create_app(
        name,
        callback_url=str(payload.get("callback_url") or ""),
        callback_events=payload.get("callback_events") or [],
        scopes=payload.get("scopes") or [],
    )
    return {"data": spec.to_dict(include_secret=True)}  # secret 明文一次


@apps_router.put("/{app_id}", response_model=BaseResponse)
async def update_app(app_id: str = PathParam(..., min_length=1), payload: Dict[str, Any] = Body(...)):
    st = _store()
    spec = st.update_app(
        app_id,
        name=payload.get("name"),
        enabled=payload.get("enabled"),
        callback_url=payload.get("callback_url"),
        callback_events=payload.get("callback_events"),
        scopes=payload.get("scopes"),
        ku_ids=payload.get("ku_ids"),
        tool_ids=payload.get("tool_ids"),
    )
    if spec is None:
        raise HTTPException(status_code=404, detail=f"应用不存在: {app_id}")
    return {"data": spec.to_dict(include_secret=False)}


@apps_router.post("/{app_id}/rotate", response_model=BaseResponse)
async def rotate_app_secret(app_id: str = PathParam(..., min_length=1)):
    st = _store()
    spec = st.rotate_secret(app_id)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"应用不存在: {app_id}")
    return {"data": spec.to_dict(include_secret=True)}  # 新 secret 明文一次


@apps_router.delete("/{app_id}", response_model=BaseResponse)
async def delete_app(app_id: str = PathParam(..., min_length=1)):
    st = _store()
    if not st.delete_app(app_id):
        raise HTTPException(status_code=404, detail=f"应用不存在: {app_id}")
    return {"data": {"deleted": app_id}}
