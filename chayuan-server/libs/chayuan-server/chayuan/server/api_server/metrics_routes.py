"""性能指标 REST(admin)。挂 /api/v1/admin/metrics。"""
from __future__ import annotations

from fastapi import APIRouter

from chayuan.server.api_server.api_schemas import BaseResponse
from chayuan.server.admin.metrics import collect_hardware_snapshot

metrics_router = APIRouter(prefix="/api/v1/admin/metrics", tags=["admin-metrics"])


@metrics_router.get("/hardware", response_model=BaseResponse)
async def hardware_metrics():
    return {"data": collect_hardware_snapshot()}
