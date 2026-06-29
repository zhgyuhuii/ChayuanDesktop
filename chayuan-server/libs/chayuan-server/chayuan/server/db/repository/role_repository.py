"""角色仓库 —— RBAC 按模块授权(#2)。

- 自 seed 内置 admin(全模块)/user(空),两种建表模式(create_all / alembic)下都保证存在。
- effective_modules(role_name):admin → 全部模块;其它 → 该角色 modules;未知 → []。
- 角色名 ≤16(User.role 列宽),只允许 [a-z0-9_]。
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

from chayuan.server.db.models.role_model import RoleModel
from chayuan.server.db.session import session_scope
from chayuan.server.admin.role_modules import ALL_MODULE_KEYS, sanitize_modules

logger = logging.getLogger("chayuan.role_repo")

_NAME_RE = re.compile(r"^[a-z0-9_]{1,16}$")
_seeded = False


def validate_name(name: str) -> Optional[str]:
    if not isinstance(name, str) or not _NAME_RE.match(name or ""):
        return "角色名只能是 1-16 位小写字母/数字/下划线"
    return None


def ensure_builtin_roles() -> None:
    """幂等 seed admin/user;只在进程内首次真正写一次。"""
    global _seeded
    if _seeded:
        return
    try:
        with session_scope() as s:
            existing = {r.name for r in s.query(RoleModel).all()}
            if "admin" not in existing:
                s.add(RoleModel(name="admin", description="超级管理员(全部模块)",
                                is_system=True, modules=list(ALL_MODULE_KEYS)))
            if "user" not in existing:
                s.add(RoleModel(name="user", description="普通用户(无后台权限)",
                                is_system=True, modules=[]))
        _seeded = True
    except Exception as e:  # noqa: BLE001 - seed 失败不应让上层崩
        logger.warning("[roles] ensure_builtin_roles 失败: %r", e)


def list_roles() -> List[Dict[str, Any]]:
    ensure_builtin_roles()
    with session_scope() as s:
        rows = s.query(RoleModel).order_by(RoleModel.is_system.desc(), RoleModel.name).all()
        return [r.to_dict() for r in rows]


def get_role(name: str) -> Optional[Dict[str, Any]]:
    with session_scope() as s:
        r = s.query(RoleModel).filter(RoleModel.name == name).one_or_none()
        return r.to_dict() if r else None


def create_role(name: str, description: str, modules: List[str]) -> Dict[str, Any]:
    ensure_builtin_roles()
    err = validate_name(name)
    if err:
        raise ValueError(err)
    with session_scope() as s:
        if s.query(RoleModel).filter(RoleModel.name == name).one_or_none():
            raise ValueError(f"角色已存在：{name}")
        r = RoleModel(name=name, description=description or "",
                      is_system=False, modules=sanitize_modules(modules))
        s.add(r)
        s.flush()
        return r.to_dict()


def update_role(name: str, *, description: Optional[str], modules: Optional[List[str]]) -> Dict[str, Any]:
    with session_scope() as s:
        r = s.query(RoleModel).filter(RoleModel.name == name).one_or_none()
        if not r:
            raise ValueError(f"角色不存在：{name}")
        if r.is_system and r.name == "admin":
            # admin 恒为全模块,只允许改描述
            if description is not None:
                r.description = description
            return r.to_dict()
        if description is not None:
            r.description = description
        if modules is not None:
            r.modules = sanitize_modules(modules)
        return r.to_dict()


def delete_role(name: str) -> bool:
    with session_scope() as s:
        r = s.query(RoleModel).filter(RoleModel.name == name).one_or_none()
        if not r:
            return False
        if r.is_system:
            raise ValueError("内置角色不可删除")
        # 是否有用户仍在用该角色
        from chayuan.server.db.models.user_model import UserModel
        in_use = s.query(UserModel).filter(UserModel.role == name).count()
        if in_use:
            raise ValueError(f"仍有 {in_use} 个用户使用该角色,请先改派")
        s.delete(r)
        return True


def effective_modules(role_name: Optional[str]) -> List[str]:
    """解析某角色实际可见的后台模块。admin → 全部;未知/None → []。"""
    if not role_name:
        return []
    if role_name == "admin":
        return list(ALL_MODULE_KEYS)
    ensure_builtin_roles()
    with session_scope() as s:
        r = s.query(RoleModel).filter(RoleModel.name == role_name).one_or_none()
        if not r:
            return []
        if r.is_system and r.name == "admin":
            return list(ALL_MODULE_KEYS)
        return list(r.modules or [])


def effective_modules_multi(role_names: List[str]) -> List[str]:
    """多角色合并可见模块。含 admin → 全部;否则各角色 modules 的并集。"""
    names = [n for n in (role_names or []) if n]
    if "admin" in names:
        return list(ALL_MODULE_KEYS)
    out: List[str] = []
    seen = set()
    for n in names:
        for m in effective_modules(n):
            if m not in seen:
                seen.add(m); out.append(m)
    return out
