"""vg_sources_config — 视频生成在线素材源 API Key 存储。

简化:key-value 表,source_name 主键。API Key 当前明文落 sqlite,后续生产
建议接 chayuan-server 现有的 encryption(参考 model_platform 加密机制)。

Revision ID: 0022_vg_sources_config
Revises: 0021_video_generation
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0022_vg_sources_config"
down_revision = "0021_video_generation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vg_sources_config",
        sa.Column("source_name", sa.String(length=32), nullable=False,
                  comment="pexels / pixabay / unsplash / youtube / vimeo / ytdlp"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("api_key", sa.Text(), nullable=True,
                  comment="API Key 或 token;ytdlp 这种无 Key 类型可空"),
        sa.Column("config_json", sa.Text(), nullable=True,
                  comment="扩展配置(如 region/lang)"),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(),
                  onupdate=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("source_name"),
    )


def downgrade() -> None:
    op.drop_table("vg_sources_config")
