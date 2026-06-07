"""model_platform.text2video_models — 文生/图生视频模型清单列。

P1+ 加了 text2video 能力,但 ``model_platform`` 表一直缺这一列 → 视频模型清单
无法持久化(只能靠 catalog 默认填充显示)。本迁移补上该列。

幂等:create_all 路径(dev / 新库)可能已按 ORM 建好该列,这里先探在不在,
不存在才 add_column —— 避免 "duplicate column" 报错,适配 alembic / create_all 两种装库方式。

Revision ID: 0023_model_platform_text2video
Revises: 0022_vg_sources_config
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0023_model_platform_text2video"
down_revision = "0022_vg_sources_config"
branch_labels = None
depends_on = None

_TABLE = "model_platform"
_COL = "text2video_models"


def _has_column(table: str, col: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    try:
        return col in [c["name"] for c in insp.get_columns(table)]
    except Exception:  # noqa: BLE001  - 表不存在等异常时当作没有
        return False


def upgrade() -> None:
    if _has_column(_TABLE, _COL):
        return
    op.add_column(
        _TABLE,
        sa.Column(_COL, sa.JSON(), nullable=False, server_default="[]",
                  comment="文生/图生视频模型清单"),
    )


def downgrade() -> None:
    if not _has_column(_TABLE, _COL):
        return
    op.drop_column(_TABLE, _COL)
