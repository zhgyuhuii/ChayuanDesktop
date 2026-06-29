"""KB 授权(泛化主体) ORM —— 主体可为 用户/角色/部门。

subject_type: 'user'|'role'|'dept'; subject_id: user→str(uid), dept→str(dept_id), role→role_name。
include_subtree 仅 dept 有意义(是否含下级部门)。owner 仍由 knowledge_base.owner_id 给。
"""
from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, Integer, String, UniqueConstraint, func

from chayuan.server.db.base import Base


class KbSubjectGrantModel(Base):
    __tablename__ = "kb_subject_grants"
    __table_args__ = (
        UniqueConstraint("kb_id", "subject_type", "subject_id", name="uq_kb_subject_grant"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    kb_id = Column(Integer, nullable=False, index=True, comment="knowledge_base.id")
    subject_type = Column(String(8), nullable=False, comment="user|role|dept")
    subject_id = Column(String(64), nullable=False, comment="user→uid, dept→dept_id, role→role_name")
    role = Column(String(16), default="reader", nullable=False, comment="reader|editor")
    include_subtree = Column(Boolean, nullable=False, default=False, comment="dept 是否含下级")
    granted_by = Column(Integer, nullable=True, comment="授予者 users.id")
    granted_at = Column(DateTime, default=func.now())
