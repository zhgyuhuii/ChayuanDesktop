from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from chayuan.server.auth.deps import require_auth_enabled
from chayuan.server.file_service import registry
from chayuan.server.file_service.base import FileRequestError
import chayuan.server.file_service.adapters as _adapters_pkg  # noqa: F401  触发自注册

file_router = APIRouter(prefix="/v1/files", tags=["Files"])


@file_router.get("", summary="统一文件下载/预览(kind 分发到各来源 adapter)")
def get_file(
    request: Request,
    kind: str = Query(..., description="kb-doc|image|artifact|dh-*|vg-*"),
    download: bool = Query(False),
    user=Depends(require_auth_enabled()),
):
    params = {k: v for k, v in request.query_params.items() if k not in ("kind", "download", "token")}
    try:
        return registry.dispatch(kind, params, user=user, download=download)
    except FileRequestError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
