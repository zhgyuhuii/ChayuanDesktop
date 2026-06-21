"""角色 ORM —— RBAC「按模块分配」(#2)。

角色持有一组后台模块 key(modules JSON 列)。User.role 仍存**角色名**(String(16),
向后兼容,不改 users 表),按名关联本表。内置 admin/user 由 role_repository 自动 seed,
is_system=True 不可删/改名。admin 的 modules 语义上=全部(由 repo 在解析时展开)。
"""
from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text, JSON, func

from chayuan.server.db.base import Base


class RoleModel(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(16), unique=True, nullable=False, index=True, comment="角色名(=User.role)")
    description = Column(Text, nullable=True, comment="角色说明")
    is_system = Column(Boolean, default=False, nullable=False, comment="内置角色(admin/user)不可删")
    modules = Column(JSON, nullable=False, default=list, comment="授权的后台模块 key 列表")
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description or "",
            "is_system": bool(self.is_system),
            "modules": list(self.modules or []),
        }
