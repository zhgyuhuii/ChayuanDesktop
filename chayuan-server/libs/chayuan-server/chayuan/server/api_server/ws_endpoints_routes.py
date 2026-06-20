"""WebSocket 端点(包装成 Agent 工具)管理 REST。挂 /api/v1/ws-endpoints。

复用 config_panel.websocket_endpoints_store(yaml 落盘 + 校验);React admin 消费。
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Body, HTTPException, Path as PathParam

from chayuan.server.api_server.api_schemas import BaseResponse

ws_endpoints_router = APIRouter(prefix="/api/v1/ws-endpoints", tags=["ws-endpoints"])


def _store():
    from chayuan.server.config_panel import websocket_endpoints_store as st
    return st


@ws_endpoints_router.get("", response_model=BaseResponse)
async def list_ws_endpoints():
    st = _store()
    return {"data": {"endpoints": [e.to_dict() for e in st.list_endpoints()]}}


@ws_endpoints_router.post("", response_model=BaseResponse)
async def create_ws_endpoint(payload: Dict[str, Any] = Body(...)):
    st = _store()
    spec = st._parse(payload)
    if not spec.name:
        raise HTTPException(status_code=400, detail="name 必填")
    if st.get_endpoint(spec.name) is not None:
        raise HTTPException(status_code=409, detail=f"端点已存在: {spec.name}")
    errs = st.validate_spec(spec)
    if errs:
        raise HTTPException(status_code=400, detail="；".join(errs))
    st.save_endpoint(spec)
    return {"data": st.get_endpoint(spec.name).to_dict()}


@ws_endpoints_router.put("/{name}", response_model=BaseResponse)
async def update_ws_endpoint(name: str = PathParam(..., min_length=1), payload: Dict[str, Any] = Body(...)):
    st = _store()
    if st.get_endpoint(name) is None:
        raise HTTPException(status_code=404, detail=f"端点不存在: {name}")
    payload = dict(payload)
    payload["name"] = name  # 名不可改
    spec = st._parse(payload)
    errs = st.validate_spec(spec)
    if errs:
        raise HTTPException(status_code=400, detail="；".join(errs))
    st.save_endpoint(spec)
    return {"data": st.get_endpoint(name).to_dict()}


@ws_endpoints_router.delete("/{name}", response_model=BaseResponse)
async def delete_ws_endpoint(name: str = PathParam(..., min_length=1)):
    st = _store()
    if not st.delete_endpoint(name):
        raise HTTPException(status_code=404, detail=f"端点不存在: {name}")
    return {"data": {"deleted": name}}
