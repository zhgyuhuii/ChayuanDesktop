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


_PERSISTED_LOADED = False
_MAX_PERSIST = 100  # 只留最近 N 条,避免无限增长


def _tasks_path() -> str:
    import os as _os
    return _os.path.join(_helpers.digital_human_dir(create=True), "tasks.json")


def _persist_locked() -> None:
    """把当前任务状态写盘(调用方须已持 _LOCK)。失败忽略,不阻塞主链路。"""
    try:
        import json as _json
        rows = [st.model_dump() for st in _STATUS.values()]
        rows = rows[-_MAX_PERSIST:]
        with open(_tasks_path(), "w", encoding="utf-8") as f:
            _json.dump(rows, f, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        logger.debug("[dh] 任务持久化失败(忽略): %r", e)


def _ensure_loaded_locked() -> None:
    """首次访问时从盘加载历史任务(调用方须已持 _LOCK)。"""
    global _PERSISTED_LOADED
    if _PERSISTED_LOADED:
        return
    _PERSISTED_LOADED = True
    try:
        import json as _json, os as _os
        p = _tasks_path()
        if not _os.path.isfile(p):
            return
        with open(p, "r", encoding="utf-8") as f:
            rows = _json.load(f) or []
        for r in rows:
            try:
                st = DhTaskStatus(**r)
                # 重启后仍"运行中"的是僵尸(进程没了),标失败,避免前端永远转圈
                if st.state in ("pending", "running"):
                    st = st.model_copy(update={"state": "failed", "error": "进程已重启,任务中断"})
                _STATUS.setdefault(st.task_id, st)
            except Exception:  # noqa: BLE001
                continue
    except Exception as e:  # noqa: BLE001
        logger.debug("[dh] 任务历史加载失败(忽略): %r", e)


def _set(tid: str, **kw) -> None:
    with _LOCK:
        _ensure_loaded_locked()
        cur = _STATUS.get(tid) or DhTaskStatus(task_id=tid, state="pending")
        _STATUS[tid] = cur.model_copy(update=kw)
        _persist_locked()


def get_status(tid: str) -> DhTaskStatus:
    with _LOCK:
        _ensure_loaded_locked()
        return _STATUS.get(tid) or DhTaskStatus(task_id=tid, state="failed", error="未知任务")


def list_statuses() -> list[DhTaskStatus]:
    """所有已登记任务的状态快照(已落盘,进程重启后仍在;运行中僵尸标失败)。"""
    with _LOCK:
        _ensure_loaded_locked()
        return list(_STATUS.values())


def _voice_string(provider: str, name: str):
    """provider + voice_name → AudioPipeline.synthesize 的 voice 串(按前缀分派)。
    clone→voxcpm:/cosyvoice-clone:(读 clones_dir);sherpa→sherpa:<name>;
    piper/edge→name 原样;空→None。集中此处,单/多形象(每槽各自音色)共用。"""
    provider = (provider or "").strip()
    voice = name or ""
    if provider == "clone" and voice.startswith("clone:"):
        cid = voice[len("clone:"):]
        wav = os.path.join(_helpers.voice_clones_dir(), f"{cid}.wav")
        engine = "voxcpm"
        try:
            import json as _json
            with open(os.path.join(_helpers.voice_clones_dir(), f"{cid}.json"), "r", encoding="utf-8") as _f:
                engine = (_json.load(_f) or {}).get("engine") or "voxcpm"
        except Exception:  # noqa: BLE001
            pass
        return f"cosyvoice-clone:{wav}" if engine == "cosyvoice" else f"voxcpm:{wav}"
    if provider == "sherpa" and voice and not voice.startswith("sherpa:"):
        # sherpa voice_name 是裸 id,synthesize 按前缀分派,不补 sherpa: 会被当 piper id
        # 去找/下载 → 音色不对、piper 失败甚至空音频致 wav2lip 口型不动。
        return "sherpa:" + voice
    return voice or None


def _synth_to_wav(text: str, provider: str, name: str, audio_path: str) -> str:
    """指定音色合成旁白 wav。"""
    from chayuan.server.modality.audio import AudioPipeline
    voice = _voice_string(provider, name)
    logger.info("[dh] narration provider=%s voice=%r", provider, voice)
    data = AudioPipeline().synthesize(text, voice=voice, fmt="wav")
    with open(audio_path, "wb") as f:
        f.write(data)
    return audio_path


def _synthesize_narration(text: str, preset, audio_path: str) -> str:
    """preset 绑定音色 → 旁白 wav(单形象/默认路径)。"""
    return _synth_to_wav(text, preset.voice_provider, preset.voice_name, audio_path)


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
        prov = (getattr(slot, "voice_provider", "") or "") or (preset.voice_provider or "")
        nm = (getattr(slot, "voice_name", "") or "") or (preset.voice_name or "")
        _synth_to_wav(seg_text, prov, nm, a_path)
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
        # 画布尺寸:优先预设(video_width/height),否则用请求传入的 args(默认 720x1280)。
        gw = int(getattr(preset, "video_width", 0) or args["width"])
        gh = int(getattr(preset, "video_height", 0) or args["height"])
        args["width"], args["height"] = gw, gh
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
