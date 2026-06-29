"""组织 + 部门 管理 admin REST(P1 org-RBAC)。

- /api/v1/admin/orgs           组织 CRUD
- /api/v1/admin/depts          部门树 CRUD + move
均 admin-only。返回 {"code":0,"msg":"ok","data":...} 信封。
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel

from chayuan.server.auth.deps import require_role

orgs_router = APIRouter(prefix="/api/v1/admin/orgs", tags=["admin-orgs"])
depts_router = APIRouter(prefix="/api/v1/admin/depts", tags=["admin-depts"])
_ADMIN = require_role("admin")


# ---- 组织 ----
@orgs_router.get("", summary="[admin] 列组织")
def list_orgs(_=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import org_repository as repo
    return {"code": 0, "msg": "ok", "data": {"orgs": repo.list_orgs()}}


@orgs_router.post("", summary="[admin] 建组织")
def create_org(body: Dict[str, Any] = Body(...), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import org_repository as repo
    try:
        org = repo.create_org(
            str(body.get("name") or ""),
            str(body.get("code") or ""),
            int(body.get("order_num") or 0),
            str(body.get("remark") or ""),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"code": 0, "msg": "ok", "data": org}


@orgs_router.patch("/{org_id}", summary="[admin] 改组织")
def update_org(org_id: int, body: Dict[str, Any] = Body(...), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import org_repository as repo
    try:
        org = repo.update_org(
            org_id,
            name=body.get("name"),
            order_num=body.get("order_num"),
            remark=body.get("remark"),
            status=body.get("status"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"code": 0, "msg": "ok", "data": org}


@orgs_router.delete("/{org_id}", summary="[admin] 删组织")
def delete_org(org_id: int, _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import org_repository as repo
    try:
        ok = repo.delete_org(org_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not ok:
        raise HTTPException(status_code=404, detail=f"组织不存在：{org_id}")
    return {"code": 0, "msg": "ok", "data": {"deleted": org_id}}


# ---- 部门 ----
@depts_router.get("", summary="[admin] 部门树")
def dept_tree(org_id: int, _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import dept_repository as repo
    return {"code": 0, "msg": "ok", "data": {"tree": repo.dept_tree(org_id)}}


@depts_router.post("", summary="[admin] 建部门")
def create_dept(body: Dict[str, Any] = Body(...), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import dept_repository as repo
    try:
        dept = repo.create_dept(
            int(body["org_id"]),
            body.get("parent_id"),
            str(body.get("name") or ""),
            int(body.get("order_num") or 0),
            body.get("leader_user_id"),
        )
    except KeyError:
        raise HTTPException(status_code=400, detail="缺少 org_id")
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e) or "参数错误")
    return {"code": 0, "msg": "ok", "data": dept}


@depts_router.patch("/{dept_id}", summary="[admin] 改部门")
def update_dept(dept_id: int, body: Dict[str, Any] = Body(...), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import dept_repository as repo
    try:
        dept = repo.update_dept(
            dept_id,
            name=body.get("name"),
            order_num=body.get("order_num"),
            leader_user_id=body.get("leader_user_id"),
            status=body.get("status"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"code": 0, "msg": "ok", "data": dept}


@depts_router.post("/{dept_id}/move", summary="[admin] 移动部门")
def move_dept(dept_id: int, body: Dict[str, Any] = Body(...), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import dept_repository as repo
    try:
        dept = repo.move_dept(dept_id, body.get("new_parent_id"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"code": 0, "msg": "ok", "data": dept}


@depts_router.delete("/{dept_id}", summary="[admin] 删部门")
def delete_dept(dept_id: int, _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import dept_repository as repo
    try:
        ok = repo.delete_dept(dept_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not ok:
        raise HTTPException(status_code=404, detail=f"部门不存在：{dept_id}")
    return {"code": 0, "msg": "ok", "data": {"deleted": dept_id}}


# ---- 部门继承角色 + 成员 ----
class _DeptRolesBody(BaseModel):
    roles: list = []


@depts_router.put("/{dept_id}/roles", summary="[admin] 设置部门继承角色")
def set_dept_roles_route(dept_id: int, body: "_DeptRolesBody", _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import dept_repository as repo
    saved = repo.set_dept_roles(dept_id, body.roles)
    return {"code": 0, "msg": "ok", "data": {"roles": saved}}


@depts_router.get("/{dept_id}/roles", summary="[admin] 部门继承角色")
def get_dept_roles_route(dept_id: int, _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import dept_repository as repo
    return {"code": 0, "msg": "ok", "data": {"roles": repo.get_dept_roles(dept_id)}}


@depts_router.get("/{dept_id}/members", summary="[admin] 部门成员")
def dept_members_route(dept_id: int, include_subtree: bool = False, keyword: str = "",
                       _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import dept_repository as repo
    from chayuan.server.db.repository import user_role_repository as urr
    from chayuan.server.db.models.user_model import UserModel
    from chayuan.server.db.session import session_scope
    dept_ids = repo.subtree_ids(dept_id) if include_subtree else [dept_id]
    with session_scope() as s:
        q = s.query(UserModel).filter(UserModel.dept_id.in_(dept_ids))
        if keyword:
            like = f"%{keyword}%"
            q = q.filter(UserModel.username.like(like))
        rows = q.order_by(UserModel.id).all()
        members = [{"id": u.id, "username": u.username, "email": u.email,
                    "dept_id": u.dept_id, "is_active": bool(u.is_active),
                    "roles": urr.get_user_roles(u.id)} for u in rows]
    return {"code": 0, "msg": "ok", "data": {"members": members}}
