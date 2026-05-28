"""vg_videos CRUD。

"我的视频"页用。一次任务 video_count=N 时插 N 条 row,跟 vg_tasks
是 N:1 关联(用 task_id 字符串引用,不做 FK)。
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import desc
from sqlalchemy.orm import Session

from chayuan.server.db.models.video_generation_model import VgVideoModel
from chayuan.server.db.session import with_session

logger = logging.getLogger("chayuan.video_generation.store.videos")


def _row_to_dict(row: VgVideoModel) -> Dict[str, Any]:
    try:
        snap = json.loads(row.params_snapshot_json) if row.params_snapshot_json else {}
    except (TypeError, ValueError):
        snap = {}
    return {
        "video_id": row.video_id,
        "task_id": row.task_id,
        "owner_id": row.owner_id,
        "title": row.title,
        "path": row.path,
        "duration_ms": row.duration_ms,
        "width": row.width,
        "height": row.height,
        "thumbnail_path": row.thumbnail_path,
        "params_snapshot": snap,
        "created_at": int(row.created_at.timestamp() * 1000) if row.created_at else None,
    }


@with_session
def create_video(
    session: Session,
    *,
    task_id: str,
    title: str,
    path: str,
    owner_id: Optional[int] = None,
    duration_ms: int = 0,
    width: int = 0,
    height: int = 0,
    thumbnail_path: Optional[str] = None,
    params_snapshot: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    video_id = str(uuid.uuid4())
    row = VgVideoModel(
        video_id=video_id,
        task_id=task_id,
        owner_id=owner_id,
        title=title,
        path=path,
        duration_ms=duration_ms,
        width=width,
        height=height,
        thumbnail_path=thumbnail_path,
        params_snapshot_json=json.dumps(params_snapshot or {}, ensure_ascii=False),
    )
    session.add(row)
    session.flush()
    logger.info(
        "[vg_videos] create %s task=%s title=%r owner=%s",
        video_id, task_id, title, owner_id,
    )
    return _row_to_dict(row)


@with_session
def get_video(
    session: Session, video_id: str, *, owner_id: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    q = session.query(VgVideoModel).filter(VgVideoModel.video_id == video_id)
    if owner_id is not None:
        q = q.filter(VgVideoModel.owner_id == owner_id)
    row = q.one_or_none()
    return _row_to_dict(row) if row else None


@with_session
def list_videos(
    session: Session,
    *,
    owner_id: Optional[int] = None,
    task_id: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> Tuple[List[Dict[str, Any]], int]:
    """分页列成品视频,默认按 created_at 倒序。"""

    page = max(page, 1)
    page_size = max(min(page_size, 200), 1)
    q = session.query(VgVideoModel)
    if owner_id is not None:
        q = q.filter(VgVideoModel.owner_id == owner_id)
    if task_id:
        q = q.filter(VgVideoModel.task_id == task_id)
    total = q.count()
    rows = (
        q.order_by(desc(VgVideoModel.created_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [_row_to_dict(r) for r in rows], total


@with_session
def delete_video(
    session: Session, video_id: str, *, owner_id: Optional[int] = None,
) -> bool:
    q = session.query(VgVideoModel).filter(VgVideoModel.video_id == video_id)
    if owner_id is not None:
        q = q.filter(VgVideoModel.owner_id == owner_id)
    deleted = q.delete()
    return deleted > 0
