"""用户-角色仓库（直接多角色读写 + 同步 User.role 主角色）。

角色键用 role_name。主角色规则:含 admin → "admin";否则取第一个;空 → "user"。
有效角色(含部门继承)见 effective_roles()。
"""
from __future__ import annotations

from typing import List, Optional

from chayuan.server.db.models.user_model import UserModel
from chayuan.server.db.models.user_role_model import UserRoleModel
from chayuan.server.db.models.dept_role_model import DeptRoleModel
from chayuan.server.db.session import session_scope


def _primary_role(role_names: List[str]) -> str:
    if "admin" in role_names:
        return "admin"
    return role_names[0] if role_names else "user"


def get_user_roles(user_id: int) -> List[str]:
    with session_scope() as s:
        rows = s.query(UserRoleModel.role_name).filter(
            UserRoleModel.user_id == user_id
        ).order_by(UserRoleModel.role_name).all()
        return [r[0] for r in rows]


def set_user_roles(user_id: int, role_names: List[str]) -> List[str]:
    # 去重、保序;空 → ["user"] 兜底
    seen = []
    for r in (role_names or []):
        r = (r or "").strip()
        if r and r not in seen:
            seen.append(r)
    if not seen:
        seen = ["user"]
    with session_scope() as s:
        s.query(UserRoleModel).filter(UserRoleModel.user_id == user_id).delete()
        for r in seen:
            s.add(UserRoleModel(user_id=user_id, role_name=r))
        u = s.query(UserModel).filter(UserModel.id == user_id).one_or_none()
        if u is not None:
            u.role = _primary_role(seen)  # 同步主角色(向后兼容)
    return seen


def _ancestor_ids(ancestors: Optional[str], self_id: int) -> List[int]:
    """从 ',a,b,self,' 解析祖先 id(不含 self)。"""
    if not ancestors:
        return []
    ids = [int(x) for x in ancestors.split(",") if x.strip().isdigit()]
    return [i for i in ids if i != self_id]


def effective_roles(user_id: int, dept_id: Optional[int]) -> List[str]:
    """有效角色 = 直接角色 ∪ 部门链继承角色。"""
    with session_scope() as s:
        direct = {r[0] for r in s.query(UserRoleModel.role_name).filter(
            UserRoleModel.user_id == user_id).all()}
        inherited: set = set()
        if dept_id is not None:
            from chayuan.server.db.models.dept_model import DepartmentModel
            dept = s.query(DepartmentModel).filter(DepartmentModel.id == dept_id).one_or_none()
            if dept is not None:
                # 直属部门:不论 include_subtree 都继承
                for r in s.query(DeptRoleModel.role_name).filter(
                        DeptRoleModel.dept_id == dept_id).all():
                    inherited.add(r[0])
                # 上级部门:仅 include_subtree=True 的传下来
                anc = _ancestor_ids(dept.ancestors, dept_id)
                if anc:
                    for r in s.query(DeptRoleModel.role_name).filter(
                            DeptRoleModel.dept_id.in_(anc),
                            DeptRoleModel.include_subtree.is_(True)).all():
                        inherited.add(r[0])
        return sorted(direct | inherited)
