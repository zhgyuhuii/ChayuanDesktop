"""组织 + 部门 表(P1 org-RBAC)。

新增 organizations(顶层平级组织) + departments(组织下部门树, ancestors 自包含逗号路径)。
seed 一个默认组织 'default'。两种建表模式(create_all/alembic)都安全:表已存在则跳过。

Revision ID: 0028_org_dept
Revises: 0027_conv_config_snapshot
Create Date: 2026-06-29
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0028_org_dept"
down_revision = "0027_conv_config_snapshot"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def upgrade() -> None:
    if not _has_table("organizations"):
        op.create_table(
            "organizations",
            sa.Column("id", sa.Integer(), nullable=False, autoincrement=True),
            sa.Column("name", sa.String(length=64), nullable=False),
            sa.Column("code", sa.String(length=32), nullable=False),
            sa.Column("order_num", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
            sa.Column("remark", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("code", name="uq_organizations_code"),
        )
        op.create_index("ix_organizations_code", "organizations", ["code"], unique=True)

    if not _has_table("departments"):
        op.create_table(
            "departments",
            sa.Column("id", sa.Integer(), nullable=False, autoincrement=True),
            sa.Column("org_id", sa.Integer(), nullable=False),
            sa.Column("parent_id", sa.Integer(), nullable=True),
            sa.Column("ancestors", sa.String(length=255), nullable=False, server_default=","),
            sa.Column("name", sa.String(length=64), nullable=False),
            sa.Column("order_num", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("leader_user_id", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_departments_org_id", "departments", ["org_id"])
        op.create_index("ix_departments_parent_id", "departments", ["parent_id"])

    # seed 默认组织(幂等)
    bind = op.get_bind()
    existing = bind.execute(sa.text("SELECT id FROM organizations WHERE code = 'default'")).fetchall()
    if not existing:
        bind.execute(sa.text(
            "INSERT INTO organizations (name, code, order_num, status) "
            "VALUES ('默认组织', 'default', 0, 'active')"
        ))


def downgrade() -> None:
    if _has_table("departments"):
        op.drop_index("ix_departments_parent_id", table_name="departments")
        op.drop_index("ix_departments_org_id", table_name="departments")
        op.drop_table("departments")
    if _has_table("organizations"):
        op.drop_index("ix_organizations_code", table_name="organizations")
        op.drop_table("organizations")
