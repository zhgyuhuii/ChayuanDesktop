"""角色自定义数据权限的部门集合（仅 data_scope=2 自定义时用）。"""
from __future__ import annotations

from sqlalchemy import Column, Integer, String

from chayuan.server.db.base import Base


class RoleScopeDeptModel(Base):
    __tablename__ = "role_scope_depts"

    role_name = Column(String(16), primary_key=True, nullable=False, comment="角色名")
    dept_id = Column(Integer, primary_key=True, nullable=False, comment="部门 id")
