"""用户-角色 多对多 ORM（按角色名键，role_name=RoleModel.name/User.role）。"""
from __future__ import annotations

from sqlalchemy import Column, Integer, String

from chayuan.server.db.base import Base


class UserRoleModel(Base):
    __tablename__ = "user_roles"

    user_id = Column(Integer, primary_key=True, nullable=False, comment="用户 id")
    role_name = Column(String(16), primary_key=True, nullable=False, comment="角色名")
