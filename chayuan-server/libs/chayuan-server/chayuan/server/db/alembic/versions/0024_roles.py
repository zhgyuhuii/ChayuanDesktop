"""RBAC 角色表(按模块授权 #2)。

新增 ``roles`` 表:角色名(=User.role,String(16) 兼容,不改 users 表)+ modules(JSON
后台模块 key 列表)。seed 内置 admin(全模块)/user(空),is_system=True 不可删。
表已存在(create_all 模式先建过)则跳过建表,只补 seed —— 两种建表模式都安全。

Revision ID: 0024_roles
Revises: 0023_model_platform_text2video
Create Date: 2026-06-21
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0024_roles"
down_revision = "0023_model_platform_text2video"
branch_labels = None
depends_on = None

# 与 chayuan/server/admin/role_modules.py 的 ALL_MODULE_KEYS 对齐(seed admin 用)
_ALL_MODULES = [
    "users", "roles", "kbacl", "apps",
    "defaults", "platforms", "mcp", "tools", "modelcfg", "prompttpl",
    "services", "topology", "svcstatus",
    "kbcfg", "vstore", "kbmanage",
    "traces", "scores", "perf", "outbox", "prompts",
    "basic", "database", "redis", "storage", "datadir", "deployment",
]


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def upgrade() -> None:
    if not _has_table("roles"):
        op.create_table(
            "roles",
            sa.Column("id", sa.Integer(), nullable=False, autoincrement=True),
            sa.Column("name", sa.String(length=16), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("modules", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name", name="uq_roles_name"),
        )
        op.create_index("ix_roles_name", "roles", ["name"], unique=True)

    # seed 内置角色(幂等:已存在则跳过)
    import json
    bind = op.get_bind()
    existing = {r[0] for r in bind.execute(sa.text("SELECT name FROM roles")).fetchall()}
    rows = []
    if "admin" not in existing:
        rows.append({"name": "admin", "description": "超级管理员(全部模块)", "is_system": True, "modules": json.dumps(_ALL_MODULES)})
    if "user" not in existing:
        rows.append({"name": "user", "description": "普通用户(无后台权限)", "is_system": True, "modules": json.dumps([])})
    for r in rows:
        bind.execute(
            sa.text("INSERT INTO roles (name, description, is_system, modules) VALUES (:name, :description, :is_system, :modules)"),
            r,
        )


def downgrade() -> None:
    if _has_table("roles"):
        op.drop_index("ix_roles_name", table_name="roles")
        op.drop_table("roles")
