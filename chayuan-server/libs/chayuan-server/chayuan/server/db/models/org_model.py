"""组织 ORM —— 顶层平级组织(多个分公司/事业部)。

组织是部门树的归属容器;部门挂在组织下。数据不强隔离,admin 跨组织可见。
"""
from __future__ import annotations

from sqlalchemy import Column, DateTime, Integer, String, Text, func

from chayuan.server.db.base import Base


class OrganizationModel(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(64), nullable=False, comment="组织名称")
    code = Column(String(32), unique=True, nullable=False, index=True, comment="组织编码(唯一)")
    order_num = Column(Integer, default=0, nullable=False, comment="排序")
    status = Column(String(16), default="active", nullable=False, comment="active/disabled")
    remark = Column(Text, nullable=True, comment="备注")
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "code": self.code,
            "order_num": int(self.order_num or 0),
            "status": self.status,
            "remark": self.remark or "",
        }
