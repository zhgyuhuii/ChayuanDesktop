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
from .schemas import ScriptSource, VgTaskState, VideoParams
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


def submit_batch_tasks(
    subjects: List[str],
    shared_params: VideoParams,
    *,
    owner_id: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """N 个主题共享 shared_params 一键并发提交,每个主题独立 vg_task。

    BatchModePage 用 — 用户输入多个主题 + 一套全局参数 → 后端循环 submit。
    runner ThreadPoolExecutor(workers=4 默认)自动并发跑,各 task 独立 SSE
    通道,前端 N 个进度条独立订阅。

    shared_params.video_subject 会被各 subject 覆盖;其它字段(语音/字幕/
    画幅/BGM)统一共享。script_source 自动锁 'ai'(批量场景必走全自动)。
    """

    if not subjects:
        return []
    out: List[Dict[str, Any]] = []
    for s in subjects:
        s = (s or "").strip()
        if not s:
            continue
        # 拷贝 shared_params 然后覆盖 video_subject + 锁 ai 模式。
        # model_copy(update=...) 不做校验/强转 → 必须传 ScriptSource 枚举本身,
        # 传字符串 "ai" 会让 script_source 变裸 str,runner 调 .value 崩。
        p = shared_params.model_copy(update={
            "video_subject": s,
            "script_source": ScriptSource.ai,
        })
        row = tasks_store.create_task(params=p, owner_id=owner_id, stop_at="video")
        runner.enqueue(row["task_id"], p, stop_at="video")
        out.append(row)
    logger.info(
        "[service] submit_batch_tasks owner=%s count=%d (of %d input subjects)",
        owner_id, len(out), len(subjects),
    )
    return out


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


def reconcile_orphaned() -> int:
    """僵尸任务清理:state=pending/processing 但不在 runner 活跃 future 里
    (= 服务重启丢了 worker,任务永远卡 processing)→ 标 failed(可重试)。
    返回清理数。列表 endpoint 每次调,保证打开「我的视频」时不残留卡死任务。"""
    cleaned = 0
    for st in ("pending", "processing"):
        rows, _ = tasks_store.list_tasks(state=st, page=1, page_size=500)
        for r in rows:
            tid = r["task_id"]
            if tid in runner._active_futures:  # noqa: SLF001 — 同包内访问
                continue
            tasks_store.update_progress(
                tid, state=VgTaskState.failed.value, error="服务重启,任务已中断(可点重试继续)",
            )
            cleaned += 1
    if cleaned:
        logger.info("[service] reconcile_orphaned cleaned=%d", cleaned)
    return cleaned


def retry_task(task_id: str, *, owner_id: Optional[int] = None) -> bool:
    """重试/继续:用存的 params 重新入队(从头跑)。失败/取消/中断的任务都能重试。"""
    row = tasks_store.get_task(task_id, owner_id=owner_id)
    if not row:
        return False
    try:
        params = VideoParams.model_validate(row.get("params") or {})
    except Exception as e:  # noqa: BLE001
        logger.warning("[service] retry_task %s params 解析失败: %r", task_id, e)
        return False
    stop_at = row.get("stop_at") or "video"
    tasks_store.update_progress(task_id, state=VgTaskState.pending.value, progress=0)
    runner.enqueue(task_id, params, stop_at=stop_at)  # enqueue 内部会清掉旧的取消标记
    logger.info("[service] retry_task %s stop_at=%s", task_id, stop_at)
    return True


def finalize_task(
    task_id: str, timeline: Dict[str, Any], *, owner_id: Optional[int] = None,
) -> bool:
    """草稿收尾:校验草稿持有 audio/subtitle/materials,设 timeline,只跑 compose。"""
    row = tasks_store.get_task(task_id, owner_id=owner_id)
    if not row:
        return False
    result = row.get("result") or {}
    audio_file = result.get("audio_file")
    subtitle_path = result.get("subtitle_path")
    if not audio_file or not subtitle_path:
        logger.warning("[service] finalize_task %s 草稿缺 audio/subtitle", task_id)
        return False
    # 素材来自用户手拖的 EDL(P5a),不再要求草稿自动下的 materials;
    # 但视频轨必须有 clip,否则没东西可渲染。
    vclips = [
        c for tr in (timeline.get("tracks") or []) if tr.get("kind") == "video"
        for c in (tr.get("clips") or [])
    ]
    if not vclips:
        logger.warning("[service] finalize_task %s 视频轨为空,拒绝", task_id)
        return False
    try:
        params = VideoParams.model_validate(row.get("params") or {})
        from .schemas import Timeline
        params.timeline = Timeline.model_validate(timeline)
    except Exception as e:  # noqa: BLE001
        logger.warning("[service] finalize_task %s params/timeline 解析失败: %r", task_id, e)
        return False
    tasks_store.update_progress(task_id, state=VgTaskState.pending.value, progress=70)
    runner.enqueue_finalize(task_id, params, audio_file=audio_file, subtitle_path=subtitle_path)
    logger.info("[service] finalize_task %s 入队 compose-only", task_id)
    return True


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
