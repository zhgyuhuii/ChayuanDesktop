"""视频生成模块对外服务 API。

API 路由层(M2)调本模块函数;前端不会直接看到这里。

接口:
    submit_task(params, owner_id, stop_at) -> dict  (task_id + 初始字段)
    cancel_task(task_id, owner_id)        -> bool
    get_task(task_id, owner_id)           -> dict | None
    list_tasks(owner_id, state, page, page_size) -> (list[dict], total)
    delete_task(task_id, owner_id)        -> bool
"""

from __future__ import annotations

import logging
import os
import shutil
from typing import Any, Dict, List, Optional, Tuple

from . import runner
from .schemas import VideoParams
from .store import tasks as tasks_store

logger = logging.getLogger("chayuan.video_generation.service")


def submit_task(
    params: VideoParams,
    *,
    owner_id: Optional[int] = None,
    stop_at: str = "video",
) -> Dict[str, Any]:
    """新建任务 + 入队。返回任务行字典(含 task_id)。

    stop_at 可选 ``script/terms/audio/subtitle/materials/video``,允许 wizard
    在中间步骤预览(只跑到 audio/subtitle 即停)。
    """

    row = tasks_store.create_task(params=params, owner_id=owner_id, stop_at=stop_at)
    runner.enqueue(row["task_id"], params, stop_at=stop_at)
    logger.info(
        "[service] submit_task %s owner=%s stop_at=%s",
        row["task_id"], owner_id, stop_at,
    )
    return row


def cancel_task(
    task_id: str, *, owner_id: Optional[int] = None,
) -> bool:
    """请求取消任务。返回是否找到 row。worker 在 step 边界响应。"""

    if owner_id is not None:
        # 校验归属;不属于该用户当不存在处理
        row = tasks_store.get_task(task_id, owner_id=owner_id)
        if not row:
            return False
    return runner.cancel(task_id)


def get_task(
    task_id: str, *, owner_id: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    return tasks_store.get_task(task_id, owner_id=owner_id)


def list_tasks(
    *,
    owner_id: Optional[int] = None,
    state: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> Tuple[List[Dict[str, Any]], int]:
    return tasks_store.list_tasks(
        owner_id=owner_id, state=state, page=page, page_size=page_size,
    )


def delete_task(
    task_id: str, *, owner_id: Optional[int] = None, drop_files: bool = True,
) -> bool:
    """删任务 row + 可选清理磁盘 task_dir。"""

    row = tasks_store.get_task(task_id, owner_id=owner_id)
    if not row:
        return False
    ok = tasks_store.delete_task(task_id, owner_id=owner_id)
    if ok and drop_files:
        try:
            from ._helpers import task_dir
            d = task_dir(task_id, create=False)
            if os.path.isdir(d):
                shutil.rmtree(d, ignore_errors=True)
        except Exception as e:  # noqa: BLE001
            logger.warning("[service] delete_task drop_files 失败: %r", e)
    return ok
