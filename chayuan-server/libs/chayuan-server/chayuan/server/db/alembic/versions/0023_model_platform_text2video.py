"""model_platform.text2video_models — 占位 no-op。

原打算给 model_platform 表加 text2video_models 列以持久化视频模型清单,但桌面版
用 ``create_all`` 装库(不跑 alembic),给 ORM 加列后 create_all 不会给已存在的表
补列 → 现存库 INSERT/SELECT 撞 "no such column" 崩溃。已回退 ORM 加列,视频模型
清单改由 ``_resolved_platforms`` 用 catalog 默认填充展示(不入 DB)。

本迁移保留为 no-op:维持 revision 链不断(避免已 stamp 到 0023 的库孤儿化),但
不做任何 DDL。日后若要真正持久化,应改为「启动期 PRAGMA 探列 + ALTER TABLE ADD
COLUMN」的运行时补列方案(兼容 create_all 模式),而非纯 alembic 迁移。

Revision ID: 0023_model_platform_text2video
Revises: 0022_vg_sources_config
"""
from __future__ import annotations


revision = "0023_model_platform_text2video"
down_revision = "0022_vg_sources_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # no-op:见模块 docstring。视频模型清单不入 DB,由 catalog 默认填充展示。
    pass


def downgrade() -> None:
    pass
