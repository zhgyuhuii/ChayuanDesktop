"""widen conversation/message id 列到 64(客户端 UUID 36 字符,varchar(32) 截断)

conversation.id / message.id / message.conversation_id 原为 String(32),但客户端生成的
带连字符 UUID 是 36 字符。v2 对话自动建会话(add_conversation_to_db)插入时 postgres 报
StringDataRightTruncation('value too long for type character varying(32)'),导致每次对话
都建不了服务端会话记录(网络版 /chat/conversations 列表缺这些会话)。加宽到 64。

sqlite(单机版)不强制 varchar 长度、不会截断,故跳过(也避免 batch 重建表风险)。

Revision ID: 0026_widen_conv_ids
Revises: 0025_deployment_identity
Create Date: 2026-06-25
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0026_widen_conv_ids"
down_revision = "0025_deployment_identity"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        return  # sqlite 不强制 varchar 长度,无需加宽
    if _has_table("conversation"):
        op.alter_column("conversation", "id",
                        type_=sa.String(length=64), existing_type=sa.String(length=32))
    if _has_table("message"):
        op.alter_column("message", "id",
                        type_=sa.String(length=64), existing_type=sa.String(length=32))
        op.alter_column("message", "conversation_id",
                        type_=sa.String(length=64), existing_type=sa.String(length=32))


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        return
    if _has_table("message"):
        op.alter_column("message", "conversation_id",
                        type_=sa.String(length=32), existing_type=sa.String(length=64))
        op.alter_column("message", "id",
                        type_=sa.String(length=32), existing_type=sa.String(length=64))
    if _has_table("conversation"):
        op.alter_column("conversation", "id",
                        type_=sa.String(length=32), existing_type=sa.String(length=64))
