"""知识库 ACL 管理 REST(admin)。挂 /api/v1/admin/kb-acl。

可见性/owner 直改 KnowledgeBaseModel;授权走 auth.service(grant/revoke/list_kb_grants)。
port 自 config_panel.kb_acl_page,admin 身份直操作(不走 owner JWT 路径)。
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, HTTPException, Path as PathParam

from chayuan.server.api_server.api_schemas import BaseResponse

kb_acl_router = APIRouter(prefix="/api/v1/admin/kb-acl", tags=["admin-kb-acl"])


def _users_lite() -> Dict[int, str]:
    from chayuan.server.auth.service import list_users
    return {u.id: f"#{u.id} {u.username}" for u in list_users(limit=500)}


@kb_acl_router.get("", response_model=BaseResponse)
async def list_kb_acl():
    from chayuan.server.db.models.knowledge_base_model import KnowledgeBaseModel
    from chayuan.server.db.session import session_scope
    with session_scope() as s:
        rows = s.query(KnowledgeBaseModel).order_by(KnowledgeBaseModel.id.asc()).all()
        kbs = [{"id": kb.id, "kb_name": kb.kb_name, "owner_id": kb.owner_id,
                "visibility": kb.visibility or "private"} for kb in rows]
    users = [{"id": uid, "label": label} for uid, label in _users_lite().items()]
    return {"data": {"kbs": kbs, "users": users}}


@kb_acl_router.get("/{kb_id}/grants", response_model=BaseResponse)
async def list_grants(kb_id: int = PathParam(...)):
    from chayuan.server.auth.service import list_kb_grants
    users = _users_lite()
    out = [{"user_id": g.user_id, "user": users.get(g.user_id, f"#{g.user_id}"),
            "role": g.role, "granted_by": g.granted_by} for g in list_kb_grants(kb_id)]
    return {"data": {"grants": out}}


@kb_acl_router.patch("/{kb_id}/visibility", response_model=BaseResponse)
async def set_visibility(kb_id: int = PathParam(...), payload: Dict[str, Any] = Body(...)):
    vis = str(payload.get("visibility") or "")
    if vis not in ("private", "public"):
        raise HTTPException(status_code=400, detail="visibility 必须为 private/public")
    from chayuan.server.db.models.knowledge_base_model import KnowledgeBaseModel
    from chayuan.server.db.session import session_scope
    with session_scope() as s:
        kb = s.get(KnowledgeBaseModel, int(kb_id))
        if kb is None:
            raise HTTPException(status_code=404, detail="KB 不存在")
        kb.visibility = vis
    return {"data": {"kb_id": kb_id, "visibility": vis}}


@kb_acl_router.patch("/{kb_id}/owner", response_model=BaseResponse)
async def set_owner(kb_id: int = PathParam(...), payload: Dict[str, Any] = Body(...)):
    owner_id: Optional[int] = payload.get("owner_id")
    from chayuan.server.db.models.knowledge_base_model import KnowledgeBaseModel
    from chayuan.server.db.session import session_scope
    with session_scope() as s:
        kb = s.get(KnowledgeBaseModel, int(kb_id))
        if kb is None:
            raise HTTPException(status_code=404, detail="KB 不存在")
        kb.owner_id = int(owner_id) if owner_id else None
    return {"data": {"kb_id": kb_id, "owner_id": owner_id}}


@kb_acl_router.post("/{kb_id}/grants", response_model=BaseResponse)
async def add_grant(kb_id: int = PathParam(...), payload: Dict[str, Any] = Body(...)):
    user_id = payload.get("user_id")
    role = str(payload.get("role") or "reader")
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id 必填")
    from chayuan.server.auth.service import grant_kb_access
    grant_kb_access(int(kb_id), int(user_id), role, None)
    return {"data": {"kb_id": kb_id, "user_id": user_id, "role": role}}


@kb_acl_router.delete("/{kb_id}/grants/{user_id}", response_model=BaseResponse)
async def remove_grant(kb_id: int = PathParam(...), user_id: int = PathParam(...)):
    from chayuan.server.auth.service import revoke_kb_access
    revoke_kb_access(int(kb_id), int(user_id))
    return {"data": {"revoked": user_id}}
