"""视频生成任务执行器 — 在线程池跑 moviepy 合成,asyncio 跟进度。

设计要点:
- moviepy 是 sync CPU 绑定:在 asyncio 主线程里跑会卡死 FastAPI 事件
  循环 → 用 ``ThreadPoolExecutor`` 把 ``_run_pipeline`` 整体调度到工
  作线程。
- 每个 task 内部仍是顺序 6 步(脚本→关键词→TTS→字幕→素材→合成);并发
  来自"多个 task 同时跑"。pool 上限 ``CHAYUAN_VG_RUNNER_WORKERS`` env,
  默认 2(单机用户场景),避免内存/磁盘 IO 抢占。
- 状态全写到 store.tasks(update_progress),wizard 前端订阅 SSE 拿到。
- 取消:cancel_task 把 in-flight task_id 加入 ``_canceled``,worker
  在每个 step 边界检查 — 后续 step 直接跳过 + 写 state=canceled。

注意:M1 阶段 ``_run_pipeline`` 是骨架版本,六步顺序明确但 generate_audio /
generate_final_videos 等还没完全 wire 到 steps 模块(尤其音频与字幕
之间的 audio_duration 传参、materials 下载到 task_dir 等);M2 API 路由
端接入时一次性补齐 + 端到端验证。
"""

from __future__ import annotations

import logging
import os
import threading
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Optional

from .schemas import VgTaskState, VideoParams
from .store import tasks as tasks_store

logger = logging.getLogger("chayuan.video_generation.runner")


# ─────────────────────────────────────────────────────────────────────
# 全局 executor
# ─────────────────────────────────────────────────────────────────────


_WORKERS = max(1, int(os.environ.get("CHAYUAN_VG_RUNNER_WORKERS", "2")))
_executor: Optional[ThreadPoolExecutor] = None
_executor_lock = threading.Lock()
_canceled: set[str] = set()
_canceled_lock = threading.Lock()
_active_futures: dict[str, Future] = {}


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(
                max_workers=_WORKERS, thread_name_prefix="vg-runner"
            )
            logger.info("[runner] ThreadPoolExecutor workers=%d", _WORKERS)
        return _executor


def shutdown() -> None:
    """服务下线时调,优雅清理 executor。"""

    global _executor
    with _executor_lock:
        if _executor is not None:
            _executor.shutdown(wait=False, cancel_futures=True)
            _executor = None


# ─────────────────────────────────────────────────────────────────────
# 任务提交 / 取消
# ─────────────────────────────────────────────────────────────────────


def enqueue(task_id: str, params: VideoParams, *, stop_at: str = "video") -> Future:
    """提交任务到线程池。任务态 row 应该已经由 service.submit_task 写过。"""

    future = _get_executor().submit(_run_pipeline, task_id, params, stop_at)
    _active_futures[task_id] = future
    future.add_done_callback(lambda _f: _active_futures.pop(task_id, None))
    return future


def cancel(task_id: str) -> bool:
    """请求取消任务。worker 在 step 边界检查 → 跳过后续 step + 写
    state=canceled。若任务还在队列里没起来,直接 Future.cancel(); 已
    running 的只能等到下个边界。"""

    with _canceled_lock:
        _canceled.add(task_id)
    fut = _active_futures.get(task_id)
    if fut and not fut.running():
        fut.cancel()
    return True


def _is_canceled(task_id: str) -> bool:
    with _canceled_lock:
        return task_id in _canceled


# ─────────────────────────────────────────────────────────────────────
# 流水线 — 6 步骨架(M2 端到端验收时补完每步的 wiring)
# ─────────────────────────────────────────────────────────────────────


def _run_pipeline(task_id: str, params: VideoParams, stop_at: str) -> None:
    """6 步顺序执行,每步上报进度。失败/取消时写终态。

    步骤:
      1. script    — generate_script(LLM) 或直接用 params.video_script
                     (manual/srt 模式)
      2. terms     — 在线素材源用;本地素材模式跳过
      3. audio     — TTS 文本 → 音频文件 + cues
      4. subtitle  — cues(or ASR/SubMaker) → SRT 落盘
      5. materials — 在线下载 OR 用户预选 OR 内置 clips
      6. compose   — moviepy 合成最终 mp4

    stop_at 可截断流程(wizard 单步预览):"script" / "terms" / "audio" /
    "subtitle" / "materials" / "video"(默认全跑完)。
    """

    from . import binaries
    from .steps import script as _script_step
    from .steps import tts as _tts_step
    from .steps import subtitle as _subtitle_step

    # 任务态:processing 5%
    tasks_store.update_progress(task_id, state=VgTaskState.processing.value, progress=5)

    # 启动时确保二进制环境变量注入(idempotent;configure 已被 server 启动期调过)
    binaries.configure(strict=False)

    try:
        # ── 1. script ──────────────────────────────────────────────
        if _is_canceled(task_id):
            return _mark_canceled(task_id)

        if params.script_source.value == "ai":
            video_script = _script_step.generate_script(
                params.video_subject,
                language=params.video_language,
                paragraph_number=params.paragraph_number,
            )
        else:
            # manual / srt 模式 — script 由用户提供
            video_script = params.video_script
        if not video_script and params.script_source.value != "srt":
            return _mark_failed(task_id, "脚本为空(LLM 调用失败或用户未填)")
        tasks_store.update_progress(
            task_id, progress=10, result_patch={"script": video_script},
        )
        if stop_at == "script":
            return _mark_complete(task_id, progress=100)

        # ── 2. terms ───────────────────────────────────────────────
        if _is_canceled(task_id):
            return _mark_canceled(task_id)
        video_terms: list[str] = []
        if params.video_source != "local" and params.script_source.value == "ai":
            video_terms = _script_step.generate_terms(
                params.video_subject, video_script, amount=5,
            )
        tasks_store.update_progress(
            task_id, progress=20, result_patch={"terms": video_terms},
        )
        if stop_at == "terms":
            return _mark_complete(task_id, progress=100)

        # ── 3. audio (TTS) ─────────────────────────────────────────
        if _is_canceled(task_id):
            return _mark_canceled(task_id)
        audio_file = _resolve_audio_path(task_id)
        tts_result = _tts_step.synthesize(
            video_script, audio_file,
            voice_provider=params.voice_provider,
            voice_name=params.voice_name or None,
            voice_rate=params.voice_rate, voice_volume=params.voice_volume,
        )
        if not tts_result:
            return _mark_failed(task_id, "TTS 失败 — provider 都没成功")
        tasks_store.update_progress(
            task_id, progress=35,
            result_patch={
                "audio_file": tts_result.audio_file,
                "audio_duration_ms": tts_result.duration_ms,
                "tts_provider": tts_result.provider,
            },
        )
        if stop_at == "audio":
            return _mark_complete(task_id, progress=100)

        # ── 4. subtitle ────────────────────────────────────────────
        if _is_canceled(task_id):
            return _mark_canceled(task_id)
        subtitle_path = _resolve_subtitle_path(task_id)
        if params.script_source.value == "srt" and params.srt_cues:
            cues = list(params.srt_cues)
        else:
            cues = tts_result.cues
        if cues:
            _subtitle_step.write_srt(cues, subtitle_path)
        tasks_store.update_progress(
            task_id, progress=50, result_patch={"subtitle_path": subtitle_path},
        )
        if stop_at == "subtitle":
            return _mark_complete(task_id, progress=100)

        # ── 5. materials ──────────────────────────────────────────
        # M1 占位:在线下载逻辑由 steps.materials.download_videos 实现,
        # 但还需要 task_dir 写入,以及 owner_id 关联本地素材库的检索。
        # 完整 wiring 留 M2 端到端验收时一起完成。
        if _is_canceled(task_id):
            return _mark_canceled(task_id)
        materials_paths: list[str] = []
        # TODO(M2): 接 steps/materials.download_videos + store.materials.list
        tasks_store.update_progress(
            task_id, progress=70, result_patch={"materials": materials_paths},
        )
        if stop_at == "materials":
            return _mark_complete(task_id, progress=100)

        # ── 6. compose ────────────────────────────────────────────
        # TODO(M2): 接 steps.compose.combine_videos + generate_video,
        # 完成后 final_videos/combined_videos 写回 result + 同步 vg_videos。
        if _is_canceled(task_id):
            return _mark_canceled(task_id)
        final_videos: list[str] = []
        tasks_store.update_progress(
            task_id, progress=95, result_patch={"final_videos": final_videos},
        )

        return _mark_complete(task_id, progress=100)

    except Exception as e:  # noqa: BLE001
        logger.error(
            "[runner] task %s pipeline 异常: %s\n%s",
            task_id, e, traceback.format_exc(),
        )
        return _mark_failed(task_id, f"{type(e).__name__}: {e}")
    finally:
        # 取消标记一次性,任务终态后从集合移除
        with _canceled_lock:
            _canceled.discard(task_id)


# ─────────────────────────────────────────────────────────────────────
# 内部 helpers
# ─────────────────────────────────────────────────────────────────────


def _mark_canceled(task_id: str) -> None:
    tasks_store.update_progress(task_id, state=VgTaskState.canceled.value)


def _mark_complete(task_id: str, *, progress: int = 100) -> None:
    tasks_store.update_progress(
        task_id, state=VgTaskState.complete.value, progress=progress,
    )


def _mark_failed(task_id: str, msg: str) -> None:
    logger.warning("[runner] task %s failed: %s", task_id, msg)
    tasks_store.update_progress(task_id, state=VgTaskState.failed.value, error=msg)


def _resolve_audio_path(task_id: str) -> str:
    from ._helpers import task_dir
    return os.path.join(task_dir(task_id), "audio.wav")


def _resolve_subtitle_path(task_id: str) -> str:
    from ._helpers import task_dir
    return os.path.join(task_dir(task_id), "subtitle.srt")
