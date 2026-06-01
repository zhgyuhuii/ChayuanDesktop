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


def _af_filter(rate: float, volume: float) -> str:
    """ffmpeg -af 滤镜串;rate≈1 且 volume≈1 → 空串(不处理)。atempo 仅 0.5-2.0。"""
    parts = []
    r = max(0.5, min(2.0, float(rate or 1.0)))
    if abs(r - 1.0) > 1e-3:
        parts.append("atempo=%.3f" % r)
    v = float(volume or 1.0)
    if abs(v - 1.0) > 1e-3:
        parts.append("volume=%.3f" % v)
    return ",".join(parts)


def _synth_to_wav(text: str, provider: str, name: str, audio_path: str, rate: float = 1.0, volume: float = 1.0) -> str:
    """指定音色合成旁白 wav。"""
    from chayuan.server.modality.audio import AudioPipeline
    voice = _voice_string(provider, name)
    logger.info("[dh] narration provider=%s voice=%r", provider, voice)
    data = AudioPipeline().synthesize(text, voice=voice, fmt="wav")
    with open(audio_path, "wb") as f:
        f.write(data)
    af = _af_filter(rate, volume)
    if af:
        try:
            import subprocess as _sp, imageio_ffmpeg, os as _os2
            ff = imageio_ffmpeg.get_ffmpeg_exe()
            tmp = audio_path + ".af.wav"
            _sp.run([ff, "-y", "-i", audio_path, "-af", af, tmp],
                    check=True, stdout=_sp.DEVNULL, stderr=_sp.DEVNULL)
            _os2.replace(tmp, audio_path)
        except Exception as e:  # noqa: BLE001
            logger.warning("[dh] 语速/音量后处理失败(忽略,用原速): %r", e)
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


def _gen_slot_clips(tid, preset, slots, global_text, engine, td, width, height, role_scripts=None):
    """按 script_router 规划的合成单元生成片段:并发合成各单元音频(各自音色/语速/音量),
    再串行跑 wav2lip(引擎模型共享,避免显存争用)。返回片段路径(按单元顺序)。"""
    from chayuan.server.video_generation.digital_human import script_router as _sr
    from concurrent.futures import ThreadPoolExecutor
    dh_type = getattr(preset, "compose_mode", "single") or "single"
    units = _sr.plan(dh_type, global_text, role_scripts, slots)
    if not units:
        raise RuntimeError("无可合成台词")

    def _do_synth(pair):
        i, u = pair
        ap = os.path.join(td, "seg%d.wav" % i)
        _synth_to_wav(u.text, u.provider, u.voice_name, ap, rate=u.rate, volume=u.volume)
        return i, ap, u

    with ThreadPoolExecutor(max_workers=min(4, len(units))) as ex:
        synthd = list(ex.map(_do_synth, list(enumerate(units))))
    synthd.sort(key=lambda t: t[0])

    clips = []
    n = max(1, len(units))
    for i, ap, u in synthd:
        av = resolve_avatar_path(slots[u.role_index].ref)
        if not av:
            logger.warning("[dh] 角色 %d 形象缺失,跳过: %s", u.role_index, slots[u.role_index].ref)
            continue
        cp = os.path.join(td, "seg%d.mp4" % i)
        get_engine(engine).generate(avatar_path=av, audio_path=ap, out_path=cp,
                                    width=width, height=height, on_progress=None)
        clips.append(cp)
        _set(tid, progress=10 + int((i + 1) * 78 / n))
    if not clips:
        raise RuntimeError("没有可用片段(形象缺失)")
    return clips


def _apply_overlays(result_path, td, preset, slots, text, width, height):
    """成片叠昵称标签+字幕(fail-safe);返回新成片路径(失败返原 result_path)。"""
    try:
        from chayuan.server.video_generation.digital_human import overlay as _ov
        from chayuan.server.video_generation.digital_human.timeline_bridge import build_cues_from_script
        from chayuan.server.video_generation.steps.subtitle import _probe_audio_duration_ms
        labels = [((getattr(s, "name", "") or ""),
                   float(getattr(s, "x", 0.0) or 0.0),
                   min(0.95, float(getattr(s, "y", 0.0) or 0.0))) for s in (slots or []) if getattr(s, "name", "")]
        cues = []
        if getattr(preset, "subtitle_enabled", True):
            dur = _probe_audio_duration_ms(result_path) or 0
            cues = build_cues_from_script(text or "", dur)
        if not labels and not cues:
            return result_path
        ov_out = os.path.join(td, "with_overlay.mp4")
        r2 = _ov.add_overlays(result_path, ov_out, labels=labels, cues=cues, width=width, height=height)
        return r2 if (r2 and os.path.isfile(r2)) else result_path
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] overlay 接入失败(忽略): %r", e)
        return result_path


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
                                    args["width"], args["height"],
                                    role_scripts=args.get("role_scripts"))
            from chayuan.server.video_generation.digital_human import compose_multi as _cm
            _set(tid, progress=90)
            try:
                if mode == "coframe":
                    positions = [(float(getattr(s, "x", 0.0) or 0.0),
                                  float(getattr(s, "y", 0.0) or 0.0),
                                  float(getattr(s, "scale", 1.0) or 1.0)) for s in slots]
                    _cm.render_coframe(clips, layout=getattr(preset, "layout", "side") or "side",
                                       out_path=out_path, width=args["width"], height=args["height"],
                                       positions=positions)
                else:
                    _cm.render_sequential(clips, out_path=out_path,
                                          width=args["width"], height=args["height"])
            except Exception as e:  # noqa: BLE001
                logger.warning("[dh] %s 合成失败,回退首个形象片段: %r", mode, e)
                import shutil
                shutil.copyfile(clips[0], out_path)
            out_path = _apply_overlays(out_path, td, preset, slots, args.get("text"), args["width"], args["height"])
            _set(tid, state="complete", progress=100, result_path=out_path,
                 script=args.get("text", ""))
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
        result_path = _apply_overlays(result_path, td, preset, getattr(preset, "avatars", None) or [], args.get("text"), args["width"], args["height"])
        _set(tid, state="complete", progress=100, result_path=result_path,
             script=args.get("text", ""))
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] task %s 失败: %r", tid, e, exc_info=True)
        _set(tid, state="failed", error=str(e))
    finally:
        _PENDING.pop(tid, None)


def submit(*, preset_id: str, text: str, width: int, height: int,
           product_ref: Optional[str] = None, template: str = "none",
           matte: bool = False, engine: str = "wav2lip",
           role_scripts=None, script=None) -> str:
    tid = uuid.uuid4().hex[:12]
    _PENDING[tid] = {"preset_id": preset_id, "text": text, "width": width, "height": height,
                     "product_ref": product_ref, "template": template, "matte": matte,
                     "engine": engine, "role_scripts": role_scripts, "script": script}
    _set(tid, state="pending", progress=0)
    _POOL.submit(_run_pipeline, tid)
    return tid


def run_sync(tid: str) -> None:
    """测试用:同步跑,不经线程池。"""
    _run_pipeline(tid)
