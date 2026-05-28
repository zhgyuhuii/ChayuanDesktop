"""vg_tasks CRUD。

跟 chayuan.server.db.repository.* 同风格,@with_session 包装,返回 dict
避开 detached ORM 实例使用。

字段大头:
- params_json / result_json 都是字符串,业务侧 json.loads/dumps
- state 字符串值由 schemas.VgTaskState 枚举约束
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import desc
from sqlalchemy.orm import Session

from chayuan.server.db.models.video_generation_model import VgTaskModel
from chayuan.server.db.session import with_session

from ..schemas import VgTaskState, VideoParams

logger = logging.getLogger("chayuan.video_generation.store.tasks")


def _row_to_dict(row: VgTaskModel) -> Dict[str, Any]:
    return {
        "task_id": row.task_id,
        "owner_id": row.owner_id,
        "state": row.state,
        "progress": row.progress,
        "stop_at": row.stop_at,
        "params": json.loads(row.params_json) if row.params_json else {},
        "result": json.loads(row.result_json) if row.result_json else {},
        "error": row.error,
        "created_at": int(row.created_at.timestamp() * 1000) if row.created_at else None,
        "updated_at": int(row.updated_at.timestamp() * 1000) if row.updated_at else None,
    }


@with_session
def create_task(
    session: Session,
    *,
    params: VideoParams,
    owner_id: Optional[int] = None,
    stop_at: str = "video",
) -> Dict[str, Any]:
    """新建任务,返回行字典。task_id 由内部生成 UUID4。"""

    task_id = str(uuid.uuid4())
    row = VgTaskModel(
        task_id=task_id,
        owner_id=owner_id,
        state=VgTaskState.pending.value,
        progress=0,
        stop_at=stop_at,
        params_json=params.model_dump_json(),
        result_json=None,
        error=None,
    )
    session.add(row)
    session.flush()
    logger.info("[vg_tasks] create %s owner=%s stop_at=%s", task_id, owner_id, stop_at)
    return _row_to_dict(row)


@with_session
def get_task(
    session: Session, task_id: str, *, owner_id: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """读单个任务。owner_id 传入时做归属校验。"""

    q = session.query(VgTaskModel).filter(VgTaskModel.task_id == task_id)
    if owner_id is not None:
        q = q.filter(VgTaskModel.owner_id == owner_id)
    row = q.one_or_none()
    return _row_to_dict(row) if row else None


@with_session
def list_tasks(
    session: Session,
    *,
    owner_id: Optional[int] = None,
    state: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> Tuple[List[Dict[str, Any]], int]:
    """分页列任务,默认按 created_at 倒序。"""

    page = max(page, 1)
    page_size = max(min(page_size, 100), 1)
    q = session.query(VgTaskModel)
    if owner_id is not None:
        q = q.filter(VgTaskModel.owner_id == owner_id)
    if state:
        q = q.filter(VgTaskModel.state == state)
    total = q.count()
    rows = (
        q.order_by(desc(VgTaskModel.created_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [_row_to_dict(r) for r in rows], total


@with_session
def update_progress(
    session: Session, task_id: str, *,
    state: Optional[str] = None,
    progress: Optional[int] = None,
    result_patch: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
) -> bool:
    """局部更新任务态。result_patch 是 dict,会 merge 进现有 result_json。

    返回是否找到并更新成功。
    """

    row = session.query(VgTaskModel).filter(VgTaskModel.task_id == task_id).one_or_none()
    if not row:
        return False

    if state is not None:
        row.state = state
    if progress is not None:
        row.progress = max(0, min(100, int(progress)))

    if result_patch:
        try:
            cur = json.loads(row.result_json) if row.result_json else {}
        except (TypeError, ValueError):
            cur = {}
        if not isinstance(cur, dict):
            cur = {}
        cur.update(result_patch)
        row.result_json = json.dumps(cur, ensure_ascii=False)

    if error is not None:
        row.error = error

    session.flush()
    return True


@with_session
def delete_task(
    session: Session, task_id: str, *, owner_id: Optional[int] = None,
) -> bool:
    """删任务记录(磁盘文件由 caller 单独清,store 层只管 row)。"""

    q = session.query(VgTaskModel).filter(VgTaskModel.task_id == task_id)
    if owner_id is not None:
        q = q.filter(VgTaskModel.owner_id == owner_id)
    deleted = q.delete()
    return deleted > 0
