"""角色数据权限 data_scope(P3 org-RBAC)。

roles 加 data_scope 列(默认3本部门);新增 role_scope_depts 表(自定义范围部门集);
seed:admin→1全部, user→5仅本人。两种建表模式都安全。

Revision ID: 0030_role_data_scope
Revises: 0029_user_dept_roles
Create Date: 2026-06-29
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0030_role_data_scope"
down_revision = "0029_user_dept_roles"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def _has_col(table: str, col: str) -> bool:
    return col in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if _has_table("roles") and not _has_col("roles", "data_scope"):
        op.add_column("roles", sa.Column("data_scope", sa.Integer(), nullable=False, server_default="3"))
    if not _has_table("role_scope_depts"):
        op.create_table(
            "role_scope_depts",
            sa.Column("role_name", sa.String(length=16), nullable=False),
            sa.Column("dept_id", sa.Integer(), nullable=False),
            sa.PrimaryKeyConstraint("role_name", "dept_id"),
        )
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE roles SET data_scope = 1 WHERE name = 'admin'"))
    bind.execute(sa.text("UPDATE roles SET data_scope = 5 WHERE name = 'user'"))


def downgrade() -> None:
    if _has_table("role_scope_depts"):
        op.drop_table("role_scope_depts")
    if _has_table("roles") and _has_col("roles", "data_scope"):
        op.drop_column("roles", "data_scope")
