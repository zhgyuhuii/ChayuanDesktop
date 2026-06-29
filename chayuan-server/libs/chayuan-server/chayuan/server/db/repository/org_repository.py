"""组织仓库 —— 顶层组织 CRUD。"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from chayuan.server.db.models.org_model import OrganizationModel
from chayuan.server.db.models.dept_model import DepartmentModel
from chayuan.server.db.session import session_scope


def list_orgs() -> List[Dict[str, Any]]:
    with session_scope() as s:
        rows = s.query(OrganizationModel).order_by(
            OrganizationModel.order_num, OrganizationModel.id
        ).all()
        return [r.to_dict() for r in rows]


def get_org(org_id: int) -> Optional[Dict[str, Any]]:
    with session_scope() as s:
        r = s.query(OrganizationModel).filter(OrganizationModel.id == org_id).one_or_none()
        return r.to_dict() if r else None


def create_org(name: str, code: str, order_num: int = 0, remark: str = "") -> Dict[str, Any]:
    name = (name or "").strip()
    code = (code or "").strip()
    if not name:
        raise ValueError("组织名称不能为空")
    if not code:
        raise ValueError("组织编码不能为空")
    with session_scope() as s:
        if s.query(OrganizationModel).filter(OrganizationModel.code == code).one_or_none():
            raise ValueError(f"组织编码已存在：{code}")
        r = OrganizationModel(name=name, code=code, order_num=int(order_num or 0), remark=remark or "")
        s.add(r)
        s.flush()
        return r.to_dict()


def update_org(org_id: int, *, name=None, order_num=None, remark=None, status=None) -> Dict[str, Any]:
    with session_scope() as s:
        r = s.query(OrganizationModel).filter(OrganizationModel.id == org_id).one_or_none()
        if not r:
            raise ValueError(f"组织不存在：{org_id}")
        if name is not None:
            r.name = name.strip()
        if order_num is not None:
            r.order_num = int(order_num)
        if remark is not None:
            r.remark = remark
        if status is not None:
            r.status = status
        return r.to_dict()


def delete_org(org_id: int) -> bool:
    with session_scope() as s:
        r = s.query(OrganizationModel).filter(OrganizationModel.id == org_id).one_or_none()
        if not r:
            return False
        dept_count = s.query(DepartmentModel).filter(DepartmentModel.org_id == org_id).count()
        if dept_count:
            raise ValueError(f"组织下仍有 {dept_count} 个部门,请先删除部门")
        s.delete(r)
        return True
