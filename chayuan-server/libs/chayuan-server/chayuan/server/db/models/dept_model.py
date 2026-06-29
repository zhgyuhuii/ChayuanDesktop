"""部门 ORM —— 组织下的部门树。

ancestors: 自包含、逗号包裹的祖先路径(含自身 id),如根部门 ",5," 子部门 ",5,9,"。
子树查询用 `ancestors LIKE '%,<id>,%'`,逗号包裹避免 id 前缀误匹配
(",11," 不含子串 ",1,",因此查 dept 1 不会误命中 dept 11)。
"""
from __future__ import annotations

from sqlalchemy import Column, DateTime, Integer, String, func

from chayuan.server.db.base import Base


class DepartmentModel(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(Integer, nullable=False, index=True, comment="所属组织 id")
    parent_id = Column(Integer, nullable=True, index=True, comment="父部门 id(根为 NULL)")
    ancestors = Column(String(255), default=",", nullable=False, comment="自包含逗号路径 ',5,9,'")
    name = Column(String(64), nullable=False, comment="部门名称")
    order_num = Column(Integer, default=0, nullable=False, comment="排序")
    leader_user_id = Column(Integer, nullable=True, comment="部门负责人用户 id")
    status = Column(String(16), default="active", nullable=False, comment="active/disabled")
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "org_id": int(self.org_id),
            "parent_id": self.parent_id,
            "ancestors": self.ancestors or ",",
            "name": self.name,
            "order_num": int(self.order_num or 0),
            "leader_user_id": self.leader_user_id,
            "status": self.status,
        }
