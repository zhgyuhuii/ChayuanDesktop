"""deployment_identity 单例表(网络版部署身份 DB 化)。

新增 deployment_identity 表(key PK / fingerprint / license_json / updated_at)。
表已存在(create_all 模式先建过)则跳过。本迁移不导入旧本地文件,文件迁移由 seat_store 运行时首访完成。

Revision ID: 0025_deployment_identity
Revises: 0024_roles
Create Date: 2026-06-24
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0025_deployment_identity"
down_revision = "0024_roles"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(name)


def upgrade() -> None:
    if not _has_table("deployment_identity"):
        op.create_table(
            "deployment_identity",
            sa.Column("key", sa.String(length=32), nullable=False),
            sa.Column("fingerprint", sa.String(length=128), nullable=False),
            sa.Column("license_json", sa.Text(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
            sa.PrimaryKeyConstraint("key"),
        )


def downgrade() -> None:
    if _has_table("deployment_identity"):
        op.drop_table("deployment_identity")
