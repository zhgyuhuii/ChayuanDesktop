"""用户多角色 + 部门归属(P2 org-RBAC)。

新增 user_roles(用户-角色 多对多) + dept_roles(部门-角色映射) 两表;
给 users 加 dept_id 列(可空);回填存量 user 的 role 到 user_roles。
两种建表模式(create_all/alembic)都安全:表/列已存在则跳过。

Revision ID: 0029_user_dept_roles
Revises: 0028_org_dept
Create Date: 2026-06-29
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0029_user_dept_roles"
down_revision = "0028_org_dept"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def _has_col(table: str, col: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return col in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    if not _has_table("user_roles"):
        op.create_table(
            "user_roles",
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("role_name", sa.String(length=16), nullable=False),
            sa.PrimaryKeyConstraint("user_id", "role_name"),
        )
    if not _has_table("dept_roles"):
        op.create_table(
            "dept_roles",
            sa.Column("dept_id", sa.Integer(), nullable=False),
            sa.Column("role_name", sa.String(length=16), nullable=False),
            sa.Column("include_subtree", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.PrimaryKeyConstraint("dept_id", "role_name"),
        )
    if _has_table("users") and not _has_col("users", "dept_id"):
        op.add_column("users", sa.Column("dept_id", sa.Integer(), nullable=True))
        op.create_index("ix_users_dept_id", "users", ["dept_id"])

    # 回填:存量 user.role -> user_roles(幂等:仅插不存在的对)
    bind = op.get_bind()
    bind.execute(sa.text(
        "INSERT INTO user_roles (user_id, role_name) "
        "SELECT id, role FROM users u "
        "WHERE role IS NOT NULL AND role <> '' "
        "AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_name = u.role)"
    ))


def downgrade() -> None:
    if _has_table("users") and _has_col("users", "dept_id"):
        try:
            op.drop_index("ix_users_dept_id", table_name="users")
        except Exception:  # noqa: BLE001 - 某些后端无该索引
            pass
        op.drop_column("users", "dept_id")
    if _has_table("dept_roles"):
        op.drop_table("dept_roles")
    if _has_table("user_roles"):
        op.drop_table("user_roles")
