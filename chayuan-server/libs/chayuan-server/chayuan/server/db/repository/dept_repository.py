"""部门仓库 —— 组织下部门树 CRUD + ancestors 维护 + 子树查询 + move。

ancestors 自包含逗号路径(含自身),根 ",<id>," 子 ",<parent...>,<id>,"。
子树 = `ancestors LIKE '%,<id>,%'`(逗号包裹防前缀误匹配)。
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from chayuan.server.db.models.dept_model import DepartmentModel
from chayuan.server.db.models.org_model import OrganizationModel
from chayuan.server.db.session import session_scope


def _ancestors_for(parent: Optional[DepartmentModel], self_id: int) -> str:
    base = parent.ancestors if parent is not None else ","
    return f"{base}{self_id},"


def get_dept(dept_id: int) -> Optional[Dict[str, Any]]:
    with session_scope() as s:
        r = s.query(DepartmentModel).filter(DepartmentModel.id == dept_id).one_or_none()
        return r.to_dict() if r else None


def create_dept(org_id, parent_id, name, order_num=0, leader_user_id=None) -> Dict[str, Any]:
    name = (name or "").strip()
    if not name:
        raise ValueError("部门名称不能为空")
    with session_scope() as s:
        if not s.query(OrganizationModel).filter(OrganizationModel.id == org_id).one_or_none():
            raise ValueError(f"组织不存在：{org_id}")
        parent = None
        if parent_id is not None:
            parent = s.query(DepartmentModel).filter(DepartmentModel.id == parent_id).one_or_none()
            if not parent:
                raise ValueError(f"父部门不存在：{parent_id}")
            if int(parent.org_id) != int(org_id):
                raise ValueError("父部门与所选组织不一致")
        r = DepartmentModel(org_id=int(org_id), parent_id=parent_id, name=name,
                            order_num=int(order_num or 0), leader_user_id=leader_user_id,
                            ancestors=",")
        s.add(r)
        s.flush()  # 拿到 r.id
        r.ancestors = _ancestors_for(parent, r.id)
        return r.to_dict()


def update_dept(dept_id, *, name=None, order_num=None, leader_user_id=None, status=None) -> Dict[str, Any]:
    with session_scope() as s:
        r = s.query(DepartmentModel).filter(DepartmentModel.id == dept_id).one_or_none()
        if not r:
            raise ValueError(f"部门不存在：{dept_id}")
        if name is not None:
            r.name = name.strip()
        if order_num is not None:
            r.order_num = int(order_num)
        if leader_user_id is not None:
            r.leader_user_id = leader_user_id
        if status is not None:
            r.status = status
        return r.to_dict()


def move_dept(dept_id, new_parent_id) -> Dict[str, Any]:
    # 注: 若目标父部门属于另一组织, 整棵子树的 org_id 会一并迁过去(跨组织移动)。
    with session_scope() as s:
        d = s.query(DepartmentModel).filter(DepartmentModel.id == dept_id).one_or_none()
        if not d:
            raise ValueError(f"部门不存在：{dept_id}")
        new_parent = None
        new_org = d.org_id
        if new_parent_id is not None:
            new_parent = s.query(DepartmentModel).filter(DepartmentModel.id == new_parent_id).one_or_none()
            if not new_parent:
                raise ValueError(f"目标父部门不存在：{new_parent_id}")
            if f",{dept_id}," in (new_parent.ancestors or ","):
                raise ValueError("不能把部门移动到它自己的子部门下")
            new_org = new_parent.org_id
        old_prefix = d.ancestors                       # ",1,5,"
        new_prefix = _ancestors_for(new_parent, d.id)  # ",2,5,"
        subtree = s.query(DepartmentModel).filter(
            DepartmentModel.ancestors.like(old_prefix + "%")
        ).all()
        for node in subtree:
            node.ancestors = new_prefix + node.ancestors[len(old_prefix):]
            node.org_id = new_org
        d.parent_id = new_parent_id
        return d.to_dict()


def delete_dept(dept_id) -> bool:
    with session_scope() as s:
        r = s.query(DepartmentModel).filter(DepartmentModel.id == dept_id).one_or_none()
        if not r:
            return False
        child_count = s.query(DepartmentModel).filter(DepartmentModel.parent_id == dept_id).count()
        if child_count:
            raise ValueError(f"部门下仍有 {child_count} 个子部门,请先删除子部门")
        # 注: P2 给 users 加 dept_id 后,这里要再拦"部门下有用户"
        s.delete(r)
        return True


def subtree_ids(dept_id) -> List[int]:
    with session_scope() as s:
        rows = s.query(DepartmentModel.id).filter(
            DepartmentModel.ancestors.like(f"%,{dept_id},%")
        ).all()
        return [row[0] for row in rows]


def dept_tree(org_id) -> List[Dict[str, Any]]:
    with session_scope() as s:
        rows = s.query(DepartmentModel).filter(
            DepartmentModel.org_id == org_id
        ).order_by(DepartmentModel.order_num, DepartmentModel.id).all()
        nodes = {r.id: {**r.to_dict(), "children": []} for r in rows}
        roots = []
        for r in rows:
            node = nodes[r.id]
            if r.parent_id and r.parent_id in nodes:
                nodes[r.parent_id]["children"].append(node)
            else:
                roots.append(node)
        return roots
