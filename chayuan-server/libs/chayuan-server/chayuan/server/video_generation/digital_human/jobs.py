"""数字人任务:单 worker 线程池 + 内存状态登记 + pipeline(tts → engine)。

桌面单用户场景:模型常驻(engine module 级缓存),队列顺序处理,不卡 UI。
进度走轮询(routes 暴露 GET status),不复用 vg 的 SSE(那条绑 VideoParams)。
"""
from __future__ import annotations
import logging, os, threading, uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Dict

from chayuan.server.video_generation import _helpers
from chayuan.server.video_generation._helpers import task_dir
from chayuan.server.video_generation.digital_human import store
from chayuan.server.video_generation.digital_human.engine import get_engine
from chayuan.server.video_generation.digital_human.schemas import DhTaskStatus
from chayuan.server.video_generation.digital_human.store import resolve_avatar_path

logger = logging.getLogger("chayuan.dh.jobs")

_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dh")
_STATUS: Dict[str, DhTaskStatus] = {}
_LOCK = threading.Lock()
_PENDING: Dict[str, dict] = {}  # task_id → 入参


def _set(tid: str, **kw) -> None:
    with _LOCK:
        cur = _STATUS.get(tid) or DhTaskStatus(task_id=tid, state="pending")
        _STATUS[tid] = cur.model_copy(update=kw)


def get_status(tid: str) -> DhTaskStatus:
    with _LOCK:
        return _STATUS.get(tid) or DhTaskStatus(task_id=tid, state="failed", error="未知任务")


def _synthesize_narration(text: str, preset, audio_path: str) -> str:
    """preset 绑定音色 → 旁白 wav。复用 AudioPipeline(含 clone:<id>)。"""
    from chayuan.server.modality.audio import AudioPipeline
    voice = preset.voice_name or ""
    if preset.voice_provider == "clone" and voice.startswith("clone:"):
        cid = voice[len("clone:"):]
        wav = os.path.join(_helpers.voice_clones_dir(), f"{cid}.wav")
        voice = f"voxcpm:{wav}"
    data = AudioPipeline().synthesize(text, voice=voice or None, fmt="wav")
    with open(audio_path, "wb") as f:
        f.write(data)
    return audio_path


def _run_pipeline(tid: str) -> None:
    args = _PENDING.get(tid) or {}
    try:
        _set(tid, state="running", progress=5)
        preset = store.get_preset(args["preset_id"])
        if preset is None:
            raise RuntimeError("数字人不存在")
        avatar = resolve_avatar_path(preset.avatar_ref)
        if not avatar:
            raise RuntimeError("形象文件缺失")
        td = task_dir(f"dh-{tid}", create=True)
        audio_path = os.path.join(td, "narration.wav")
        out_path = os.path.join(td, "digital_human.mp4")
        _synthesize_narration(args["text"], preset, audio_path)
        _set(tid, progress=30)
        get_engine().generate(
            avatar_path=avatar, audio_path=audio_path, out_path=out_path,
            width=args["width"], height=args["height"],
            on_progress=lambda pct: _set(tid, progress=30 + int(pct * 0.7)),
        )
        _set(tid, state="complete", progress=100, result_path=out_path)
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] task %s 失败: %r", tid, e, exc_info=True)
        _set(tid, state="failed", error=str(e))
    finally:
        _PENDING.pop(tid, None)


def submit(*, preset_id: str, text: str, width: int, height: int) -> str:
    tid = uuid.uuid4().hex[:12]
    _PENDING[tid] = {"preset_id": preset_id, "text": text, "width": width, "height": height}
    _set(tid, state="pending", progress=0)
    _POOL.submit(_run_pipeline, tid)
    return tid


def run_sync(tid: str) -> None:
    """测试用:同步跑,不经线程池。"""
    _run_pipeline(tid)
