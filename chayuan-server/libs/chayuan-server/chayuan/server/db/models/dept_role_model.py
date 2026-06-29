"""部门-角色映射 ORM（部门成员继承这些角色；include_subtree=是否传给下级部门）。"""
from __future__ import annotations

from sqlalchemy import Boolean, Column, Integer, String

from chayuan.server.db.base import Base


class DeptRoleModel(Base):
    __tablename__ = "dept_roles"

    dept_id = Column(Integer, primary_key=True, nullable=False, comment="部门 id")
    role_name = Column(String(16), primary_key=True, nullable=False, comment="角色名")
    include_subtree = Column(Boolean, nullable=False, default=False, comment="是否传给下级部门")
