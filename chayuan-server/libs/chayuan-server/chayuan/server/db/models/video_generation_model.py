"""视频生成模块 ORM 模型 — vg_tasks / vg_materials / vg_videos。

对应 alembic 0021_video_generation。表设计 + 字段语义详见迁移文件。

注意:本模块定义的三张表通过 ``db.models.__init__`` 触发副作用 import
注册到 ``Base.metadata``,Server 启动期 create_all / alembic 都能看到。
"""
from __future__ import annotations

from sqlalchemy import BigInteger, Column, DateTime, Integer, String, Text, func

from chayuan.server.db.base import Base


class VgTaskModel(Base):
    __tablename__ = "vg_tasks"

    task_id = Column(String(64), primary_key=True,
                     comment="UUID4 字符串,service.submit 生成")
    owner_id = Column(Integer, nullable=True, index=True,
                      comment="users.id;NULL=GUEST/单机匿名")
    state = Column(String(16), nullable=False, default="pending", index=True,
                   comment="pending/processing/complete/failed/canceled")
    progress = Column(Integer, nullable=False, default=0,
                      comment="0-100 整数")
    stop_at = Column(String(16), nullable=False, default="video",
                     comment="script/terms/audio/subtitle/materials/video")
    params_json = Column(Text, nullable=False,
                         comment="VideoParams.model_dump_json()")
    result_json = Column(Text, nullable=True,
                         comment="{script, terms, audio_file, subtitle_path, ...}")
    error = Column(Text, nullable=True,
                   comment="state=failed 时的错误信息")
    created_at = Column(DateTime, server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime, server_default=func.now(),
                        onupdate=func.now(), nullable=False)

    def __repr__(self) -> str:
        return (
            f"<VgTask(task_id={self.task_id!r}, state={self.state!r}, "
            f"progress={self.progress}, owner_id={self.owner_id})>"
        )


class VgMaterialModel(Base):
    __tablename__ = "vg_materials"

    material_id = Column(String(64), primary_key=True)
    owner_id = Column(Integer, nullable=True, index=True,
                      comment="NULL=全局 bundled/内置;非 NULL=用户私有")
    source = Column(String(16), nullable=False, index=True,
                    comment="upload / pexels / pixabay / bundled")
    name = Column(String(255), nullable=False)
    path = Column(String(512), nullable=False,
                  comment="相对 CHAYUAN_ROOT 的素材文件路径")
    mime = Column(String(64), nullable=False, default="")
    size = Column(BigInteger, nullable=False, default=0)
    duration_ms = Column(Integer, nullable=False, default=0)
    width = Column(Integer, nullable=False, default=0)
    height = Column(Integer, nullable=False, default=0)
    thumbnail_path = Column(String(512), nullable=True)
    tags_json = Column(Text, nullable=False, default="[]",
                       comment="JSON 数组,用户标签 + 自动提取")
    used_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, server_default=func.now(), nullable=False, index=True)

    def __repr__(self) -> str:
        return (
            f"<VgMaterial(material_id={self.material_id!r}, name={self.name!r}, "
            f"source={self.source!r}, owner_id={self.owner_id})>"
        )


class VgVideoModel(Base):
    __tablename__ = "vg_videos"

    video_id = Column(String(64), primary_key=True)
    task_id = Column(String(64), nullable=False, index=True,
                     comment="对应 vg_tasks.task_id")
    owner_id = Column(Integer, nullable=True, index=True)
    title = Column(String(255), nullable=False, default="")
    path = Column(String(512), nullable=False,
                  comment="相对 CHAYUAN_ROOT 的成品 mp4")
    duration_ms = Column(Integer, nullable=False, default=0)
    width = Column(Integer, nullable=False, default=0)
    height = Column(Integer, nullable=False, default=0)
    thumbnail_path = Column(String(512), nullable=True)
    params_snapshot_json = Column(Text, nullable=False, default="{}",
                                  comment="生成时 VideoParams 快照;'复制重做' 用")
    created_at = Column(DateTime, server_default=func.now(), nullable=False, index=True)

    def __repr__(self) -> str:
        return (
            f"<VgVideo(video_id={self.video_id!r}, task_id={self.task_id!r}, "
            f"title={self.title!r}, owner_id={self.owner_id})>"
        )
