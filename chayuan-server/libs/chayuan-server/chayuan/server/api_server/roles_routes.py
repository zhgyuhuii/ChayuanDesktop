"""角色管理 admin REST(RBAC 按模块授权 #2)。

- GET    /api/v1/admin/roles            列角色 + 模块目录(前端渲染勾选框)
- POST   /api/v1/admin/roles            建角色(name<=16 [a-z0-9_], 选模块)
- PATCH  /api/v1/admin/roles/{name}     改描述/模块(内置 admin 只可改描述)
- DELETE /api/v1/admin/roles/{name}     删角色(内置不可删;有用户在用则拦)
均 admin-only。
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from chayuan.server.auth.deps import require_role

roles_router = APIRouter(prefix="/api/v1/admin/roles", tags=["admin-roles"])
_ADMIN = require_role("admin")


@roles_router.get("", summary="[admin] 列角色 + 模块目录")
def list_roles(_=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import role_repository as repo
    from chayuan.server.admin.role_modules import MODULE_CATALOG
    return {
        "code": 0,
        "msg": "ok",
        "data": {"roles": repo.list_roles(), "module_catalog": MODULE_CATALOG},
    }


@roles_router.post("", summary="[admin] 新建角色")
def create_role(body: Dict[str, Any] = Body(...), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import role_repository as repo
    name = str(body.get("name") or "").strip()
    description = str(body.get("description") or "")
    modules = body.get("modules") or []
    if not isinstance(modules, list):
        raise HTTPException(status_code=400, detail="modules 必须是数组")
    try:
        role = repo.create_role(name, description, modules)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"code": 0, "msg": "ok", "data": role}


@roles_router.patch("/{name}", summary="[admin] 改角色描述/模块")
def update_role(name: str, body: Dict[str, Any] = Body(...), _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import role_repository as repo
    description: Optional[str] = body.get("description")
    modules: Optional[List[str]] = body.get("modules")
    if modules is not None and not isinstance(modules, list):
        raise HTTPException(status_code=400, detail="modules 必须是数组")
    try:
        role = repo.update_role(name, description=description, modules=modules)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"code": 0, "msg": "ok", "data": role}


@roles_router.delete("/{name}", summary="[admin] 删角色")
def delete_role(name: str, _=Depends(_ADMIN)) -> Dict[str, Any]:
    from chayuan.server.db.repository import role_repository as repo
    try:
        ok = repo.delete_role(name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not ok:
        raise HTTPException(status_code=404, detail=f"角色不存在：{name}")
    return {"code": 0, "msg": "ok", "data": {"deleted": name}}
