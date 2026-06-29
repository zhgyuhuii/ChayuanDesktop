"""知识库 ACL 管理 REST(admin)。挂 /api/v1/admin/kb-acl。

可见性/owner 直改 KnowledgeBaseModel;授权走泛化主体仓库 kb_grant_repository
(主体 user/role/dept,含子树),旧 user_id 接口映射成 subject_type='user' 兼容。
port 自 config_panel.kb_acl_page,admin 身份直操作(不走 owner JWT 路径)。
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, HTTPException, Path as PathParam, Query

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
    from chayuan.server.db.repository import kb_grant_repository as kg
    users = _users_lite()
    out = []
    for g in kg.list_grants(int(kb_id)):
        subject_type = g["subject_type"]
        subject_id = g["subject_id"]
        row = {
            "subject_type": subject_type,
            "subject_id": subject_id,
            "role": g["role"],
            "include_subtree": bool(g.get("include_subtree")),
            "granted_by": g.get("granted_by"),
        }
        if subject_type == "user":
            try:
                uid = int(subject_id)
            except (TypeError, ValueError):
                uid = None
            # 兼容旧返回字段:user grant 仍带 user_id / user 名
            row["user_id"] = uid
            row["user"] = users.get(uid, f"#{subject_id}") if uid is not None else f"#{subject_id}"
        out.append(row)
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
    role = str(payload.get("role") or "reader")
    subject_type = payload.get("subject_type")
    subject_id = payload.get("subject_id")
    include_subtree = bool(payload.get("include_subtree") or False)
    # 兼容:仅传 user_id(无 subject_type)→ 映射成 user 主体
    if not subject_type:
        user_id = payload.get("user_id")
        if not user_id:
            raise HTTPException(status_code=400, detail="subject_type+subject_id 或 user_id 必填")
        subject_type = "user"
        subject_id = str(user_id)
    if subject_id is None or str(subject_id) == "":
        raise HTTPException(status_code=400, detail="subject_id 必填")
    from chayuan.server.db.repository import kb_grant_repository as kg
    try:
        kg.add_grant(int(kb_id), str(subject_type), str(subject_id), role,
                     include_subtree=include_subtree, granted_by=None)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"data": {"kb_id": kb_id, "subject_type": subject_type,
                     "subject_id": str(subject_id), "role": role,
                     "include_subtree": include_subtree}}


@kb_acl_router.delete("/{kb_id}/grants", response_model=BaseResponse)
async def remove_grant_by_subject(kb_id: int = PathParam(...),
                                  subject_type: str = Query(...),
                                  subject_id: str = Query(...)):
    from chayuan.server.db.repository import kb_grant_repository as kg
    revoked = kg.revoke_grant(int(kb_id), str(subject_type), str(subject_id))
    return {"data": {"revoked": revoked, "subject_type": subject_type, "subject_id": subject_id}}


@kb_acl_router.delete("/{kb_id}/grants/{user_id}", response_model=BaseResponse)
async def remove_grant(kb_id: int = PathParam(...), user_id: int = PathParam(...)):
    # 兼容旧路径:按 user 主体撤销
    from chayuan.server.db.repository import kb_grant_repository as kg
    kg.revoke_grant(int(kb_id), "user", str(user_id))
    return {"data": {"revoked": user_id}}
