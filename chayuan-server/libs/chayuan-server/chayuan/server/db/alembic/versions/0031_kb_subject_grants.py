"""KB 授权泛化:kb_subject_grants 表 + 迁移存量 user 授权(P4 org-RBAC)。

新增 kb_subject_grants(主体 user/role/dept);把旧 kb_access_grants 的 user 授权
拷成 subject_type='user'。旧表保留不动。两种建表模式都安全。

Revision ID: 0031_kb_subject_grants
Revises: 0030_role_data_scope
Create Date: 2026-06-29
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0031_kb_subject_grants"
down_revision = "0030_role_data_scope"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def upgrade() -> None:
    if not _has_table("kb_subject_grants"):
        op.create_table(
            "kb_subject_grants",
            sa.Column("id", sa.Integer(), nullable=False, autoincrement=True),
            sa.Column("kb_id", sa.Integer(), nullable=False),
            sa.Column("subject_type", sa.String(length=8), nullable=False),
            sa.Column("subject_id", sa.String(length=64), nullable=False),
            sa.Column("role", sa.String(length=16), nullable=False, server_default="reader"),
            sa.Column("include_subtree", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("granted_by", sa.Integer(), nullable=True),
            sa.Column("granted_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("kb_id", "subject_type", "subject_id", name="uq_kb_subject_grant"),
        )
        op.create_index("ix_kb_subject_grants_kb_id", "kb_subject_grants", ["kb_id"])

    # 迁移存量 user 授权(幂等:仅插不存在的)
    if _has_table("kb_access_grants"):
        bind = op.get_bind()
        bind.execute(sa.text(
            "INSERT INTO kb_subject_grants (kb_id, subject_type, subject_id, role, include_subtree, granted_by) "
            "SELECT g.kb_id, 'user', CAST(g.user_id AS CHAR), g.role, 0, g.granted_by "
            "FROM kb_access_grants g "
            "WHERE NOT EXISTS (SELECT 1 FROM kb_subject_grants k "
            "  WHERE k.kb_id = g.kb_id AND k.subject_type = 'user' AND k.subject_id = CAST(g.user_id AS CHAR))"
        ))


def downgrade() -> None:
    if _has_table("kb_subject_grants"):
        op.drop_table("kb_subject_grants")
