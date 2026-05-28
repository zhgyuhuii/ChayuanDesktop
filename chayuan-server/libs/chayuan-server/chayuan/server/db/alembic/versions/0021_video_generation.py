"""视频生成模块表:vg_tasks / vg_materials / vg_videos。

承接 chayuan-video-generation(MoneyPrinterTurbo)集成 plan M1.C4。

为什么三张表合一个 migration:
* 它们紧密关联 — 一个 vg_task 完成产出 ≥1 vg_video,可能用到 N 个 vg_material。
* 同一次 schema 演化(陈年表 ALTER 较少时)合一个 revision 更利于回滚。

为什么不做 FK:
* ``owner_id`` 指向 users.id,但视频生成模块要支持单机匿名(GUEST,owner_id=NULL),
  做 NOT NULL FK 反而限制使用形态;ondelete=SET NULL 又会让 admin 清账户时
  把素材库孤立。维持 ``Integer + index`` + ApplicationCode 在 service 层校验。
* ``task_id`` 是 UUID 字符串,FK 自身导致跨表 join 性能不佳;素材/视频跟任务的
  追溯关系用 task_id_str 字符串字段 + index 即可。

Revision ID: 0021_video_generation
Revises: 0020_app_kb_grant
Create Date: 2026-05-28
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0021_video_generation"
down_revision = "0020_app_kb_grant"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ─────────────────────────────────────────────────────────────────
    # vg_tasks — 视频生成任务态(pending/processing/complete/failed/canceled)
    # ─────────────────────────────────────────────────────────────────
    op.create_table(
        "vg_tasks",
        sa.Column("task_id", sa.String(length=64), nullable=False,
                  comment="UUID4 字符串,由 service.submit 生成,前端订阅 SSE 用同样的 id"),
        sa.Column("owner_id", sa.Integer(), nullable=True,
                  comment="users.id;NULL=GUEST/单机匿名;单用户模式所有任务都是 NULL"),
        sa.Column("state", sa.String(length=16), nullable=False, server_default="pending",
                  comment="VgTaskState 枚举值:pending/processing/complete/failed/canceled"),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0",
                  comment="0-100;wizard step 完成时跳档 5/10/20/30/40/50/...100"),
        sa.Column("stop_at", sa.String(length=16), nullable=False, server_default="video",
                  comment="script/terms/audio/subtitle/materials/video 允许部分流程跑完即停"),
        sa.Column("params_json", sa.Text(), nullable=False,
                  comment="VideoParams.model_dump_json() — 包含三模式分支字段 + 字幕样式 + TTS 选择等全部用户配置"),
        sa.Column("result_json", sa.Text(), nullable=True,
                  comment="中间产物路径聚合:{script, terms, audio_file, subtitle_path, materials[], final_videos[], combined_videos[]}"),
        sa.Column("error", sa.Text(), nullable=True,
                  comment="state=failed 时填错误信息(含 stacktrace 关键行)"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("task_id"),
    )
    op.create_index("ix_vg_tasks_owner_id", "vg_tasks", ["owner_id"])
    op.create_index("ix_vg_tasks_state", "vg_tasks", ["state"])
    op.create_index("ix_vg_tasks_created_at", "vg_tasks", ["created_at"])

    # ─────────────────────────────────────────────────────────────────
    # vg_materials — 素材库(用户上传 + 内置 + 在线下载缓存)
    # ─────────────────────────────────────────────────────────────────
    op.create_table(
        "vg_materials",
        sa.Column("material_id", sa.String(length=64), nullable=False,
                  comment="UUID4 字符串"),
        sa.Column("owner_id", sa.Integer(), nullable=True,
                  comment="NULL=全局/内置 bundled clips;非 NULL=用户私有素材"),
        sa.Column("source", sa.String(length=16), nullable=False,
                  comment="upload(用户拖入) / pexels / pixabay(在线缓存)/ bundled(出厂)"),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("path", sa.String(length=512), nullable=False,
                  comment="相对 CHAYUAN_ROOT 的素材文件路径"),
        sa.Column("mime", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("size", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0",
                  comment="视频时长,前端展示用,合成时也避免拼接错位"),
        sa.Column("width", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("height", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("thumbnail_path", sa.String(length=512), nullable=True,
                  comment="预生成缩略图(JPEG 320 px 短边),网格视图直接用"),
        sa.Column("tags_json", sa.Text(), nullable=False, server_default="[]",
                  comment="JSON 数组,用户自定义标签 + 自动从文件名/视频内容提取"),
        sa.Column("used_count", sa.Integer(), nullable=False, server_default="0",
                  comment="累计被多少视频用过;库内排序 + 推荐用"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("material_id"),
    )
    op.create_index("ix_vg_materials_owner_id", "vg_materials", ["owner_id"])
    op.create_index("ix_vg_materials_source", "vg_materials", ["source"])
    op.create_index("ix_vg_materials_created_at", "vg_materials", ["created_at"])

    # ─────────────────────────────────────────────────────────────────
    # vg_videos — 成品视频索引("我的视频"页用)
    # ─────────────────────────────────────────────────────────────────
    op.create_table(
        "vg_videos",
        sa.Column("video_id", sa.String(length=64), nullable=False,
                  comment="UUID4 字符串"),
        sa.Column("task_id", sa.String(length=64), nullable=False,
                  comment="对应 vg_tasks.task_id;一次任务 video_count=N 时产生 N 条 vg_videos"),
        sa.Column("owner_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("path", sa.String(length=512), nullable=False,
                  comment="相对 CHAYUAN_ROOT 的成品 mp4 路径"),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("width", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("height", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("thumbnail_path", sa.String(length=512), nullable=True),
        sa.Column("params_snapshot_json", sa.Text(), nullable=False, server_default="{}",
                  comment="生成时的 VideoParams 快照;'复制参数重做'功能用,避免任务表被 GC 后无法回溯"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("video_id"),
    )
    op.create_index("ix_vg_videos_task_id", "vg_videos", ["task_id"])
    op.create_index("ix_vg_videos_owner_id", "vg_videos", ["owner_id"])
    op.create_index("ix_vg_videos_created_at", "vg_videos", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_vg_videos_created_at", table_name="vg_videos")
    op.drop_index("ix_vg_videos_owner_id", table_name="vg_videos")
    op.drop_index("ix_vg_videos_task_id", table_name="vg_videos")
    op.drop_table("vg_videos")

    op.drop_index("ix_vg_materials_created_at", table_name="vg_materials")
    op.drop_index("ix_vg_materials_source", table_name="vg_materials")
    op.drop_index("ix_vg_materials_owner_id", table_name="vg_materials")
    op.drop_table("vg_materials")

    op.drop_index("ix_vg_tasks_created_at", table_name="vg_tasks")
    op.drop_index("ix_vg_tasks_state", table_name="vg_tasks")
    op.drop_index("ix_vg_tasks_owner_id", table_name="vg_tasks")
    op.drop_table("vg_tasks")
