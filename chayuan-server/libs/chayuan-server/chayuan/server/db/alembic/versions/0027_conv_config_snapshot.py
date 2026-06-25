"""conversation 加 config_snapshot 列(对话配置漫游用)

ConversationModel 新增 JSON 列 config_snapshot,存对话的 model/kb/检索参数快照,
用于跨设备/浏览器漫游还原 composer 配置。旧行迁移为 NULL,不影响兼容。

Revision ID: 0027_conv_config_snapshot
Revises: 0026_widen_conv_ids
Create Date: 2026-06-25
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0027_conv_config_snapshot"
down_revision = "0026_widen_conv_ids"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def _has_column(table: str, column: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return any(c["name"] == column for c in insp.get_columns(table))


def upgrade() -> None:
    if _has_table("conversation") and not _has_column("conversation", "config_snapshot"):
        op.add_column("conversation", sa.Column("config_snapshot", sa.JSON(), nullable=True))


def downgrade() -> None:
    if _has_table("conversation") and _has_column("conversation", "config_snapshot"):
        op.drop_column("conversation", "config_snapshot")
