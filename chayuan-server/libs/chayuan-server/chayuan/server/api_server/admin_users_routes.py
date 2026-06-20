"""后台用户管理 REST(挂 /api/v1/admin/users)。React admin 消费,require_role admin。"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from chayuan.server.admin.users_analytics import build_users_snapshot
from chayuan.server.admin.persona import generate_persona_analysis
from chayuan.server.auth.deps import require_role

admin_users_router = APIRouter(prefix="/api/v1/admin/users", tags=["admin-users"])

# require_role 每次返回新依赖函数;固定成模块级单例,便于测试 dependency_overrides。
_ADMIN = require_role("admin")


@admin_users_router.get("/snapshot")
def get_users_snapshot(_=Depends(_ADMIN)):
    return build_users_snapshot()


@admin_users_router.post("/{user_id}/persona-analysis")
def post_persona_analysis(user_id: int, _=Depends(_ADMIN)):
    from fastapi import HTTPException
    res = generate_persona_analysis(user_id)
    if not res.get("ok"):
        reason = res.get("reason")
        if reason == "user-not-found":
            raise HTTPException(status_code=404, detail=reason)
        raise HTTPException(status_code=503, detail=reason or "persona-failed")
    return {"model": res["model"], "analysis": res["analysis"], "generated_at": res["generated_at"]}
