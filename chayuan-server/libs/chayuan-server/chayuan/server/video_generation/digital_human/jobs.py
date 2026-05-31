"""数字人任务:单 worker 线程池 + 内存状态登记 + pipeline(tts → engine)。

桌面单用户场景:模型常驻(engine module 级缓存),队列顺序处理,不卡 UI。
进度走轮询(routes 暴露 GET status),不复用 vg 的 SSE(那条绑 VideoParams)。
"""
from __future__ import annotations
import logging, os, threading, uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Optional

from chayuan.server.video_generation import _helpers
from chayuan.server.video_generation._helpers import task_dir
from chayuan.server.video_generation.digital_human import store
from chayuan.server.video_generation.digital_human.engine import get_engine
from chayuan.server.video_generation.digital_human.schemas import DhTaskStatus
from chayuan.server.video_generation.digital_human.store import resolve_avatar_path, resolve_product_path
from chayuan.server.video_generation.digital_human.compose import render_with_product, render_with_product_matte

logger = logging.getLogger("chayuan.dh.jobs")

_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dh")
_STATUS: Dict[str, DhTaskStatus] = {}
_LOCK = threading.Lock()
# task_id → 入参。单写(submit)单读(单 worker pipeline),GIL 下 dict 操作安全,
# 故不加锁。注意:别把 _PENDING 操作塞进 _LOCK —— _set() 已持 _LOCK,在 _run_pipeline
# 内再对 _PENDING 加同一把锁会自死锁。
_PENDING: Dict[str, dict] = {}


def _set(tid: str, **kw) -> None:
    with _LOCK:
        cur = _STATUS.get(tid) or DhTaskStatus(task_id=tid, state="pending")
        _STATUS[tid] = cur.model_copy(update=kw)


def get_status(tid: str) -> DhTaskStatus:
    with _LOCK:
        return _STATUS.get(tid) or DhTaskStatus(task_id=tid, state="failed", error="未知任务")


def list_statuses() -> list[DhTaskStatus]:
    """所有已登记任务的状态快照(内存态;进程重启即清)。"""
    with _LOCK:
        return list(_STATUS.values())


def _synthesize_narration(text: str, preset, audio_path: str) -> str:
    """preset 绑定音色 → 旁白 wav。复用 AudioPipeline(含 clone:<id>)。"""
    from chayuan.server.modality.audio import AudioPipeline
    voice = preset.voice_name or ""
    if preset.voice_provider == "clone" and voice.startswith("clone:"):
        cid = voice[len("clone:"):]
        wav = os.path.join(_helpers.voice_clones_dir(), f"{cid}.wav")
        engine = "voxcpm"
        try:
            import json as _json
            with open(os.path.join(_helpers.voice_clones_dir(), f"{cid}.json"), "r", encoding="utf-8") as _f:
                engine = (_json.load(_f) or {}).get("engine") or "voxcpm"
        except Exception:  # noqa: BLE001
            pass
        voice = f"cosyvoice-clone:{wav}" if engine == "cosyvoice" else f"voxcpm:{wav}"
    data = AudioPipeline().synthesize(text, voice=voice or None, fmt="wav")
    with open(audio_path, "wb") as f:
        f.write(data)
    return audio_path


def _probe_duration_ms(path: str) -> int:
    """ffprobe 取媒体时长(ms);失败返 0。"""
    try:
        import imageio_ffmpeg, subprocess, json as _json
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        ffprobe = ff.replace("ffmpeg", "ffprobe")
        out = subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration",
                              "-of", "json", path], capture_output=True, text=True, timeout=30)
        dur = float(_json.loads(out.stdout or "{}").get("format", {}).get("duration") or 0)
        return int(dur * 1000)
    except Exception:  # noqa: BLE001
        return 0


def _gen_slot_clips(tid, preset, slots, global_text, engine, td, width, height):
    """为每个形象槽各生成一段说话片段(片段自带音频,引擎已 mux)。
    台词:槽自带 lines,空则用全局 text;某槽形象文件缺失则跳过。全缺则抛异常。"""
    clips = []
    n = max(1, len(slots))
    for i, slot in enumerate(slots):
        av = resolve_avatar_path(slot.ref)
        if not av:
            logger.warning("[dh] 槽 %d 形象缺失,跳过: %s", i, slot.ref)
            continue
        seg_text = (getattr(slot, "lines", "") or "").strip() or global_text
        a_path = os.path.join(td, f"seg{i}.wav")
        c_path = os.path.join(td, f"seg{i}.mp4")
        _synthesize_narration(seg_text, preset, a_path)
        get_engine(engine).generate(
            avatar_path=av, audio_path=a_path, out_path=c_path,
            width=width, height=height, on_progress=None,
        )
        clips.append(c_path)
        _set(tid, progress=10 + int((i + 1) * 78 / n))
    if not clips:
        raise RuntimeError("没有可用形象片段(全部形象文件缺失)")
    return clips


def _run_pipeline(tid: str) -> None:
    args = _PENDING.get(tid) or {}
    try:
        _set(tid, state="running", progress=5)
        preset = store.get_preset(args["preset_id"])
        if preset is None:
            raise RuntimeError("数字人不存在")
        td = task_dir(f"dh-{tid}", create=True)
        out_path = os.path.join(td, "digital_human.mp4")
        # 多形象:同框(coframe)/分段(sequential),>=2 槽且非 single 才走。
        # 各槽各自生片段(自带音频),再用 compose_multi 合成;合成失败回退首片段。
        slots = list(getattr(preset, "avatars", None) or [])
        mode = getattr(preset, "compose_mode", "single") or "single"
        if mode in ("coframe", "sequential") and len(slots) >= 2:
            clips = _gen_slot_clips(tid, preset, slots, args["text"],
                                    args.get("engine") or "wav2lip", td,
                                    args["width"], args["height"])
            from chayuan.server.video_generation.digital_human import compose_multi as _cm
            _set(tid, progress=90)
            try:
                if mode == "coframe":
                    _cm.render_coframe(clips, layout=getattr(preset, "layout", "side") or "side",
                                       out_path=out_path, width=args["width"], height=args["height"])
                else:
                    _cm.render_sequential(clips, out_path=out_path,
                                          width=args["width"], height=args["height"])
            except Exception as e:  # noqa: BLE001
                logger.warning("[dh] %s 合成失败,回退首个形象片段: %r", mode, e)
                import shutil
                shutil.copyfile(clips[0], out_path)
            _set(tid, state="complete", progress=100, result_path=out_path)
            return
        # ---- 单形象(原路径)----
        avatar = resolve_avatar_path(preset.avatar_ref)
        if not avatar:
            raise RuntimeError("形象文件缺失")
        audio_path = os.path.join(td, "narration.wav")
        _synthesize_narration(args["text"], preset, audio_path)
        _set(tid, progress=30)
        get_engine(args.get("engine") or "wav2lip").generate(
            avatar_path=avatar, audio_path=audio_path, out_path=out_path,
            width=args["width"], height=args["height"],
            on_progress=lambda pct: _set(tid, progress=30 + int(pct * 0.7)),
        )
        result_path = out_path
        product_ref = args.get("product_ref")
        template = args.get("template") or "none"
        if product_ref and template != "none":
            product_path = resolve_product_path(product_ref)
            if not product_path:
                raise RuntimeError("商品图缺失")
            _set(tid, progress=88)
            presenter_keep = os.path.join(td, "presenter.mp4")
            final_path = os.path.join(td, "digital_human.mp4")
            os.replace(out_path, presenter_keep)  # presenter 让出最终文件名
            dur_ms = _probe_duration_ms(presenter_keep) or _probe_duration_ms(audio_path) or 5000
            renderer = render_with_product_matte if args.get("matte") else render_with_product
            renderer(
                presenter_path=presenter_keep, product_path=product_path, template=template,
                audio_path=audio_path, out_path=final_path, width=args["width"], height=args["height"],
                dur_ms=dur_ms,
            )
            result_path = final_path
        _set(tid, state="complete", progress=100, result_path=result_path)
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] task %s 失败: %r", tid, e, exc_info=True)
        _set(tid, state="failed", error=str(e))
    finally:
        _PENDING.pop(tid, None)


def submit(*, preset_id: str, text: str, width: int, height: int,
           product_ref: Optional[str] = None, template: str = "none",
           matte: bool = False, engine: str = "wav2lip") -> str:
    tid = uuid.uuid4().hex[:12]
    _PENDING[tid] = {"preset_id": preset_id, "text": text, "width": width, "height": height,
                     "product_ref": product_ref, "template": template, "matte": matte,
                     "engine": engine}
    _set(tid, state="pending", progress=0)
    _POOL.submit(_run_pipeline, tid)
    return tid


def run_sync(tid: str) -> None:
    """测试用:同步跑,不经线程池。"""
    _run_pipeline(tid)
