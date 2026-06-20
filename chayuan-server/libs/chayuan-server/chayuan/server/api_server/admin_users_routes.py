"""后台用户管理 REST(挂 /api/v1/admin/users)。React admin 消费,require_role admin。"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from chayuan.server.admin.users_analytics import build_users_snapshot
from chayuan.server.auth.deps import require_role

admin_users_router = APIRouter(prefix="/api/v1/admin/users", tags=["admin-users"])

# require_role 每次返回新依赖函数;固定成模块级单例,便于测试 dependency_overrides。
_ADMIN = require_role("admin")


@admin_users_router.get("/snapshot")
def get_users_snapshot(_=Depends(_ADMIN)):
    return build_users_snapshot()
