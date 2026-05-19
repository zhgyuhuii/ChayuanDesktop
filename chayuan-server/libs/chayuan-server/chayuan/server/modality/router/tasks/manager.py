"""TaskManager — 模态任务编排核心。

职责
====
1. ``create_task(req)``        把 GenerateReq 落库,返 task_id
2. ``run_task(task_id, req)``  在后台 asyncio.Task 里跑 connector.generate,
                                把事件推到 event_bus + 把状态写回 store
3. ``subscribe(task_id)``       订阅者拿 AsyncIterator[event](replay + live)
4. ``cancel(task_id)``         设 cancelled 标志,connector 下次 check 会退出

关键设计
========
后台 asyncio.Task **不绑** SSE 客户端的生命周期 — 即便所有订阅者断开,任务也
继续跑直到自然终态(succeeded / failed / cancelled)。这是"浏览器关了任务
不丢"的核心。

为什么不每事件都落库
====================
text-delta / progress 量大;落库会拖 SQLite 写锁。策略:
  - 事件全部进 event_bus(给 SSE 续流)
  - 落库只覆盖"状态切换 + 文件出来 + 文字段结束 + 错误"
  - text_out 在 text-end 时一次性 flush 整段

terminal cleanup
================
任务终态后通道保留 5 分钟(默认),给迟到的 SSE 客户端续流。超时后由
``_grace_cleanup`` 把 channel 从注册表移除;DB 行永久保留(任务历史)。
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, AsyncIterator, Dict, List, Optional

from chayuan.server.modality.router.connectors.base import pick_connector
from chayuan.server.modality.router.protocol import (
    Attachment,
    Cancelled,
    Capability,
    GenerateReq,
)
from chayuan.server.modality.router.sse_v5 import (
    data_part,
    error_event,
    finish_event,
    finish_step_event,
    start_event,
)
from chayuan.server.modality.router.tasks import event_bus, store

logger = logging.getLogger("chayuan.modality.tasks.manager")


# 终态后通道保留时长(秒) — 给"刷新页面续看"留窗口
TERMINAL_GRACE_SEC = 300

# 进度落库节流 — 5% 一档或 3 秒一次
_PROGRESS_PCT_STEP = 5
_PROGRESS_MIN_INTERVAL_S = 3.0


# ──────────────────────────────────────────────────────────────
# 后台 asyncio.Task 防 GC — Python doc 警告 create_task 返回的 Task 必须
# 保活,否则 weakref 收掉就静默丢。
# ──────────────────────────────────────────────────────────────
_running: Dict[str, asyncio.Task] = {}
_cancellers: Dict[str, Cancelled] = {}


def _gen_task_id() -> str:
    return uuid.uuid4().hex


# ──────────────────────────────────────────────────────────────
# 主 API
# ──────────────────────────────────────────────────────────────


async def create_task(req: GenerateReq) -> str:
    """落库一条 pending 任务,返 task_id。

    不启动后台跑 — 调用方应紧接着 ``run_task(task_id, req)``,通常通过
    ``dispatch_via_manager`` 一步完成两件事。
    """
    task_id = _gen_task_id()
    attachments_meta = [
        {"mime": a.mime, "url": a.url, "name": a.name}
        for a in (req.attachments or [])
    ]
    await store.create_task(
        task_id=task_id,
        capability=req.capability.value,
        model=req.model,
        platform_name=req.platform_name or None,
        prompt=req.prompt or None,
        params=dict(req.params or {}),
        attachments=attachments_meta,
        user_id=None,  # TODO 接入鉴权后填
        conversation_id=req.conversation_id,
        message_id=req.message_id,
    )
    return task_id


async def run_task(task_id: str, req: GenerateReq) -> None:
    """后台跑 — 不要 await 它,用 ``ensure_running`` 启动。"""
    ch = event_bus.get_or_create_channel(task_id)

    # 把取消信号挂到全局,API /tasks/<id>/cancel 用
    if req.cancelled is None:
        req.cancelled = Cancelled()
    _cancellers[task_id] = req.cancelled

    # 头两条事件 — 跟旧 dispatch 行为对齐,前端状态机不变
    ch.publish(start_event(message_id=task_id))
    ch.publish(data_part(
        "modality-meta",
        {
            "task_id": task_id,
            "capability": req.capability.value,
            "model": req.model,
            "platform_name": req.platform_name,
            "platform_type": req.platform_type,
        },
    ))

    cls = pick_connector(req.capability, req.model, req.platform_type)
    if cls is None:
        msg = (
            f"模态路由器还没接入 {req.capability.value}/{req.platform_type} 连接器。"
            f"  • 模型「{req.model}」需要专属上游协议(非 OpenAI 兼容)"
        )
        ch.publish(error_event(msg, code="connector_not_registered"))
        ch.publish(finish_step_event())
        ch.publish(finish_event())
        await store.patch_task(
            task_id,
            status="failed",
            error_text=msg,
            error_code="connector_not_registered",
        )
        ch.close()
        _schedule_grace_cleanup(task_id)
        return

    await store.patch_task(task_id, status="running", progress_percent=1, progress_message="启动连接器")

    # 落库节流状态
    last_pct = 0
    last_pct_at = 0.0
    text_buf: Dict[str, List[str]] = {}  # text_id -> [delta...]

    loop = asyncio.get_running_loop()
    connector = cls()
    try:
        async for ev in connector.generate(req):
            ch.publish(ev)
            await _persist_event(
                task_id, ev,
                last_pct=last_pct, last_pct_at=last_pct_at, text_buf=text_buf,
                loop_now=loop.time(),
            )
            # 把上面闭包改回的 last_pct 拉出来 — 函数里改了字典不行,用 inline 重算
            etype = ev.get("type")
            if etype == "data-task-progress":
                d = ev.get("data") or {}
                pct = int(d.get("percent") or 0)
                if abs(pct - last_pct) >= _PROGRESS_PCT_STEP:
                    last_pct = pct
                    last_pct_at = loop.time()
    except asyncio.CancelledError:
        # 进程结束 / 手动 cancel asyncio.Task — 一律标 cancelled
        logger.info("[task=%s] cancelled via asyncio.Task", task_id)
        ch.publish(error_event("任务已取消", code="cancelled"))
        ch.publish(finish_step_event())
        ch.publish(finish_event())
        await store.patch_task(task_id, status="cancelled", progress_message="已取消")
        ch.close()
        _schedule_grace_cleanup(task_id)
        raise
    except Exception as e:  # noqa: BLE001
        logger.exception("[task=%s] connector failed: %r", task_id, e)
        ch.publish(error_event(f"{type(e).__name__}: {e}", code="connector_error"))
        ch.publish(finish_step_event())
        ch.publish(finish_event())
        await store.patch_task(
            task_id,
            status="failed",
            error_text=str(e),
            error_code="connector_error",
        )
        ch.close()
        _schedule_grace_cleanup(task_id)
        return

    # 正常结束 — connector.generate 自己不发 finish,manager 兜底
    ch.publish(finish_step_event())
    ch.publish(finish_event())

    # 计算 text_out(把 text-delta 拼回去)
    text_out = "".join(s for parts in text_buf.values() for s in parts).strip() or None

    # 取消优先级:cancel 标志在终止前后被 set
    final_status = "cancelled" if req.cancelled.is_set() else "succeeded"
    patch_fields: Dict[str, Any] = {
        "status": final_status,
        "progress_percent": 100,
        "progress_message": "完成" if final_status == "succeeded" else "已取消",
    }
    if text_out:
        patch_fields["text_out"] = text_out
    await store.patch_task(task_id, **patch_fields)

    ch.close()
    _schedule_grace_cleanup(task_id)


async def _persist_event(
    task_id: str,
    ev: Dict,
    *,
    last_pct: int,
    last_pct_at: float,
    text_buf: Dict[str, List[str]],
    loop_now: float,
) -> None:
    """根据事件类型决定要不要落库 — text-delta / progress 节流,file / error 必落。"""
    etype = ev.get("type")
    if etype == "file":
        await store.append_file(
            task_id,
            {
                "mediaType": ev.get("mediaType"),
                "url": ev.get("url"),
                "metadata": ev.get("metadata") or {},
            },
        )
        return
    if etype == "data-task-progress":
        d = ev.get("data") or {}
        pct = int(d.get("percent") or 0)
        msg = d.get("message")
        ups = d.get("task_id")
        # 节流:5% 一档 或 3s 一次
        if abs(pct - last_pct) >= _PROGRESS_PCT_STEP or (loop_now - last_pct_at) >= _PROGRESS_MIN_INTERVAL_S:
            await store.patch_task(
                task_id,
                progress_percent=pct,
                progress_message=msg,
                upstream_task_id=ups if ups else None,
            )
        return
    if etype == "text-delta":
        tid = ev.get("id") or "t0"
        text_buf.setdefault(tid, []).append(str(ev.get("delta") or ""))
        return
    if etype == "error":
        # 错误事件由 manager 主 try/except 兜底落库 — 这里不重复
        return


def ensure_running(task_id: str, req: GenerateReq) -> asyncio.Task:
    """启动后台跑;同 id 已经跑则返回已有 Task,**不重复发**。

    通道**同步**创建 — 调用方 ``subscribe`` 紧跟着发请求时,要避免抢跑到
    DB replay 路径(任务刚启动 DB 行是 pending 没事件)。
    """
    existing = _running.get(task_id)
    if existing is not None and not existing.done():
        return existing
    # 先建通道,再起后台 task — 任意时刻 subscribe(task_id) 都能找到通道
    event_bus.get_or_create_channel(task_id)
    task = asyncio.create_task(run_task(task_id, req), name=f"modality-task-{task_id}")
    _running[task_id] = task

    def _on_done(_t: asyncio.Task) -> None:
        _running.pop(task_id, None)
        _cancellers.pop(task_id, None)
    task.add_done_callback(_on_done)
    return task


async def subscribe(task_id: str) -> AsyncIterator[Dict]:
    """订阅任务事件流。

    分四种情况:
      - 通道存在 + 未关闭 → 直接 replay buffer + live
      - 通道存在 + 已关闭 → replay buffer(包含 finish)然后终止
      - 通道不存在 + DB 有终态记录 → 合成 replay(start + meta + files + finish)
      - 通道不存在 + DB 也没有 → yield 一条 error 然后退出
    """
    ch = event_bus.get_channel(task_id)
    if ch is not None:
        async for ev in ch.subscribe():
            yield ev
        return

    # 通道丢了(grace 期已过 / 进程重启)— 从 DB 重建一次性回放
    row = await store.get_task(task_id)
    if row is None:
        yield error_event(f"任务 {task_id} 不存在", code="task_not_found")
        return
    async for ev in _replay_from_db(row):
        yield ev


async def _replay_from_db(row: Dict) -> AsyncIterator[Dict]:
    """从 DB 行合成一次性事件流 — 终态任务"再看一遍"用。"""
    yield start_event(message_id=row["id"])
    yield data_part(
        "modality-meta",
        {
            "task_id": row["id"],
            "capability": row["capability"],
            "model": row["model"],
            "platform_name": row["platform_name"],
            "platform_type": None,
        },
    )
    if row.get("text_out"):
        from chayuan.server.modality.router.sse_v5 import text_delta, text_end, text_start
        yield text_start("t0")
        yield text_delta("t0", row["text_out"])
        yield text_end("t0")
    for f in (row.get("files") or []):
        from chayuan.server.modality.router.sse_v5 import file_part
        yield file_part(
            media_type=f.get("mediaType") or "application/octet-stream",
            url=f.get("url") or "",
            metadata=f.get("metadata") or {},
        )
    if row.get("status") == "failed" and row.get("error_text"):
        yield error_event(row["error_text"], code=row.get("error_code") or "connector_error")
    yield finish_step_event()
    yield finish_event()


def cancel(task_id: str) -> bool:
    """请求取消 — 设 cancelled 标志,connector 下次 check 会自然退出。"""
    canc = _cancellers.get(task_id)
    if canc is None:
        return False
    canc.set()
    return True


# ──────────────────────────────────────────────────────────────
# Grace cleanup
# ──────────────────────────────────────────────────────────────


def _schedule_grace_cleanup(task_id: str) -> None:
    async def _later() -> None:
        try:
            await asyncio.sleep(TERMINAL_GRACE_SEC)
        except asyncio.CancelledError:
            return
        event_bus.drop_channel(task_id)

    asyncio.create_task(_later(), name=f"modality-grace-{task_id}")
