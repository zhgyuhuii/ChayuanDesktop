"""数字人任务:单 worker 线程池 + 内存状态登记 + pipeline(tts → engine)。

桌面单用户场景:模型常驻(engine module 级缓存),队列顺序处理,不卡 UI。
进度走轮询(routes 暴露 GET status),不复用 vg 的 SSE(那条绑 VideoParams)。
"""
from __future__ import annotations
import logging, os, threading, time, uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Optional

from chayuan.server.video_generation import _helpers
from chayuan.server.video_generation._helpers import task_dir
from chayuan.server.video_generation.digital_human import store
from chayuan.server.video_generation.digital_human.engine import get_engine
from chayuan.server.video_generation.digital_human.schemas import DhTaskStatus
from chayuan.server.video_generation.digital_human.store import resolve_avatar_path, resolve_product_path
from chayuan.server.video_generation.digital_human.compose import (
    render_with_product, render_with_product_matte, render_with_products, render_scene_layered,
)

logger = logging.getLogger("chayuan.dh.jobs")

def _max_parallel() -> int:
    # 多任务并行生成:默认 2(均衡 CPU/显存),可用 CHAYUAN_DH_MAX_PARALLEL 调高用于大批量。
    try:
        return max(1, int(os.environ.get("CHAYUAN_DH_MAX_PARALLEL", "2")))
    except Exception:  # noqa: BLE001
        return 2


_POOL = ThreadPoolExecutor(max_workers=_max_parallel(), thread_name_prefix="dh")
_STATUS: Dict[str, DhTaskStatus] = {}
_LOCK = threading.Lock()
# task_id → 入参。多 worker 并行,但每个 task 只读/弹自己的 tid(不同 key),GIL 下 dict
# 操作安全,故不加锁。注意:别把 _PENDING 操作塞进 _LOCK —— _set() 已持 _LOCK,在
# _run_pipeline 内再对 _PENDING 加同一把锁会自死锁。
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
    if provider == "edge" and voice and not voice.startswith("edge:"):
        # edge 音色必须带 edge: 前缀:否则 synthesize 先试 piper,piper 见 *Neural
        # 名字会被替换成默认音色并返回,edge 永远走不到 → 选 edge 音色不生效。
        return "edge:" + voice
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
    """preset 绑定音色 → 旁白 wav(单形象/默认路径)。语速/音量取首个角色(avatars[0]),
    与多形象路径一致(预设级无 rate/volume,角色级才有)。"""
    role0 = (getattr(preset, "avatars", None) or [None])[0]
    rate = float(getattr(role0, "voice_rate", 1.0) or 1.0) if role0 is not None else 1.0
    volume = float(getattr(role0, "voice_volume", 1.0) or 1.0) if role0 is not None else 1.0
    return _synth_to_wav(text, preset.voice_provider, preset.voice_name, audio_path,
                         rate=rate, volume=volume)


def delete_task(tid: str, *, drop_files: bool = True) -> bool:
    """删任务记录(+可选删产物目录)。镜像 VG delete_task。"""
    with _LOCK:
        st = _STATUS.pop(tid, None)
        if st is not None:
            _persist_locked()
    _PENDING.pop(tid, None)
    if st is None:
        return False
    if drop_files:
        import shutil
        try:
            d = task_dir(f"dh-{tid}")
            if d and os.path.isdir(d):
                shutil.rmtree(d, ignore_errors=True)
        except Exception:  # noqa: BLE001
            pass
    return True


def _parse_ffmpeg_duration_ms(stderr_text: str) -> int:
    """从 ffmpeg -i 的 stderr 解析 ``Duration: HH:MM:SS.xx`` → 毫秒;无则 0。"""
    import re
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", stderr_text or "")
    if not m:
        return 0
    h, mnt, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return int((h * 3600 + mnt * 60 + s) * 1000)


def _probe_duration_ms(path: str) -> int:
    """媒体时长(ms);失败返 0。imageio_ffmpeg 只带 ffmpeg、不带 ffprobe,
    旧实现 ff.replace("ffmpeg","ffprobe") 得到的 exe 不存在 → 永远返 0 →
    商品图合成 dur_ms 落 5000 兜底 → 成片 5 秒后黑屏。改用存在的 ffmpeg -i 解析 Duration。"""
    try:
        import imageio_ffmpeg, subprocess
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        out = subprocess.run([ff, "-i", path], capture_output=True, text=True, timeout=30)
        return _parse_ffmpeg_duration_ms(out.stderr or "")
    except Exception:  # noqa: BLE001
        return 0


def _gen_slot_clips(tid, preset, slots, global_text, engine, td, width, height, role_scripts=None, role_segments=None):
    """按 script_router 规划的合成单元生成片段:并发合成各单元音频(各自音色/语速/音量),
    再串行跑 wav2lip(引擎模型共享,避免显存争用)。返回片段路径(按单元顺序)。"""
    from chayuan.server.video_generation.digital_human import script_router as _sr
    from concurrent.futures import ThreadPoolExecutor
    dh_type = getattr(preset, "compose_mode", "single") or "single"
    # 空音色的槽继承预设级音色（对齐 schema 注释：voice_provider/voice_name 空=继承预设级）。
    # 在 jobs 层预处理，plan/_unit 保持纯；浅拷贝以免改原 preset.avatars。
    eff_slots = []
    for s in slots:
        prov = getattr(s, "voice_provider", "") or ""
        vname = getattr(s, "voice_name", "") or ""
        if prov and vname:
            eff_slots.append(s)
            continue
        es = s.model_copy()
        es.voice_provider = prov or (getattr(preset, "voice_provider", "") or "")
        es.voice_name = vname or (getattr(preset, "voice_name", "") or "")
        eff_slots.append(es)
    units = _sr.plan(dh_type, script=global_text, role_scripts=role_scripts,
                     role_segments=role_segments, roles=eff_slots)
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
    unit_roles = []
    seg_meta = []  # 各段元数据(供模式相关多轨建轨):role_index/path/text/duration_ms
    n = max(1, len(units))
    for i, ap, u in synthd:
        av = resolve_avatar_path(slots[u.role_index].ref)
        if not av:
            logger.warning("[dh] 角色 %d 形象缺失,跳过: %s", u.role_index, slots[u.role_index].ref)
            continue
        cp = os.path.join(td, "seg%d.mp4" % i)
        # 按形象原始宽高比生成(不再强制画布 9:16,否则形象被拉伸);capped 到画布尺寸。
        gw, gh = width, height
        try:
            from PIL import Image as _Img
            with _Img.open(av) as _im:
                _aw, _ah = _im.size
            if _aw > 0 and _ah > 0:
                _ratio = min(width / _aw, height / _ah, 1.0)  # 不放大、不超画布
                gw = max(2, int(round(_aw * _ratio)))
                gh = max(2, int(round(_ah * _ratio)))
                gw -= gw % 2; gh -= gh % 2  # 偶数,h264 友好
        except Exception:  # noqa: BLE001
            gw, gh = width, height  # 视频形象/读失败 → 回退画布尺寸
        get_engine(engine).generate(avatar_path=av, audio_path=ap, out_path=cp,
                                    width=gw, height=gh, on_progress=None)
        clips.append(cp)
        unit_roles.append(u.role_index)
        seg_meta.append({"role_index": int(u.role_index), "path": cp,
                         "text": getattr(u, "text", "") or "",
                         "duration_ms": _probe_duration_ms(cp)})
        _set(tid, progress=10 + int((i + 1) * 78 / n))
    if not clips:
        raise RuntimeError("没有可用片段(形象缺失)")
    return clips, unit_roles, seg_meta


def _apply_overlays(result_path, td, preset, slots, text, width, height):
    """成片叠昵称标签+字幕(fail-safe);返回新成片路径(失败返原 result_path)。
    昵称标签仅多角色(coframe/sequential)烧入——single 是干净口播,不烧名字。"""
    try:
        from chayuan.server.video_generation.digital_human import overlay as _ov
        from chayuan.server.video_generation.digital_human.timeline_bridge import build_cues_from_script
        from chayuan.server.video_generation.steps.subtitle import _probe_audio_duration_ms
        compose_mode = getattr(preset, "compose_mode", "single") or "single"
        labels = ([((getattr(s, "name", "") or ""),
                    float(getattr(s, "x", 0.0) or 0.0),
                    min(0.95, float(getattr(s, "y", 0.0) or 0.0))) for s in (slots or []) if getattr(s, "name", "")]
                  if compose_mode in ("coframe", "sequential") else [])
        cues = []
        if getattr(preset, "subtitle_enabled", True):
            dur = _probe_audio_duration_ms(result_path) or 0
            cues = build_cues_from_script(text or "", dur)
        if not labels and not cues:
            return result_path
        ov_out = os.path.join(td, "with_overlay.mp4")
        style = {
            "subtitle_position": getattr(preset, "subtitle_position", "bottom"),
            "font_name": getattr(preset, "font_name", ""),
            "font_size": getattr(preset, "font_size", 0),
            "text_fore_color": getattr(preset, "text_fore_color", ""),
            "stroke_color": getattr(preset, "stroke_color", ""),
            "stroke_width": getattr(preset, "stroke_width", None),
        }
        r2 = _ov.add_overlays(result_path, ov_out, labels=labels, cues=cues, width=width, height=height, style=style)
        return r2 if (r2 and os.path.isfile(r2)) else result_path
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] overlay 接入失败(忽略): %r", e)
        return result_path


_VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv", ".avi"}


def _build_subtitle(td, preset, text, width, height, dur_ms):
    """构建字幕场景片段 {cues, style, ass_path} 给 ffcompose 烧入;无字幕/失败返 None。"""
    try:
        if not getattr(preset, "subtitle_enabled", True):
            return None
        from chayuan.server.video_generation.digital_human.timeline_bridge import build_cues_from_script
        from chayuan.server.video_generation.digital_human import overlay as _ov
        from chayuan.server.video_generation.digital_human import subtitle_ass as _sa
        cues = build_cues_from_script(text or "", int(dur_ms or 0))
        if not cues:
            return None
        style = {
            "subtitle_position": getattr(preset, "subtitle_position", "bottom"),
            "font_name": getattr(preset, "font_name", ""),
            "font_size": getattr(preset, "font_size", 0),
            "text_fore_color": getattr(preset, "text_fore_color", ""),
            "stroke_color": getattr(preset, "stroke_color", ""),
            "stroke_width": getattr(preset, "stroke_width", None),
        }
        font = _ov._resolve_font_path(getattr(preset, "font_name", "") or None)
        ass = _sa.build_ass(cues, style, os.path.join(td, "sub.ass"),
                            width=width, height=height, font_path=font)
        return {"cues": cues, "style": style, "ass_path": ass}
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] 字幕构建失败(忽略): %r", e)
        return None


def _concat_wavs(wavs, out_path, ffmpeg_exe):
    """按顺序拼接 wav → 一条连续音频(coframe 各段轮流即顺序)。失败抛异常。"""
    import shutil
    import subprocess
    wavs = [w for w in (wavs or []) if w and os.path.isfile(w)]
    if not wavs:
        raise RuntimeError("无可拼接音频段")
    if len(wavs) == 1:
        shutil.copyfile(wavs[0], out_path)
        return out_path
    listf = out_path + ".list.txt"
    with open(listf, "w", encoding="utf-8") as f:
        for w in wavs:
            f.write("file '%s'\n" % w.replace("'", "'\\''"))
    subprocess.run([ffmpeg_exe, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                    "-i", listf, "-ar", "44100", "-ac", "1", out_path], check=True)
    return out_path


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
            clips, unit_roles, seg_meta = _gen_slot_clips(tid, preset, slots, args["text"],
                                    args.get("engine") or "wav2lip", td,
                                    args["width"], args["height"],
                                    role_scripts=args.get("role_scripts"),
                                    role_segments=args.get("role_segments"))
            from chayuan.server.video_generation.digital_human import compose_multi as _cm
            _set(tid, progress=90)
            # 合成写帧进度 90→99(节流:仅整数变化时上报),避免长视频合成看着卡在 90%。
            _pg = [90]
            def _op(f):
                v = 90 + int(max(0.0, min(1.0, f)) * 9)
                if v != _pg[0]:
                    _pg[0] = v
                    _set(tid, progress=v)
            try:
                if mode == "coframe":
                    positions = [(float(getattr(s, "x", 0.0) or 0.0),
                                  float(getattr(s, "y", 0.0) or 0.0),
                                  float(getattr(s, "scale", 1.0) or 1.0)) for s in slots]
                    avatars = [resolve_avatar_path(s.ref) for s in slots]
                    zs = [getattr(s, "z", None) for s in slots]  # 工作台调的图层叠放顺序
                    ops = [getattr(s, "opacity", None) for s in slots]  # 各角色不透明度
                    # 商品图层(coframe 之前完全没合成商品 → 丢失);解析成可摆放项随角色一起合成。
                    co_items = []
                    for _q in (getattr(preset, "products", None) or []):
                        _pp = resolve_product_path(getattr(_q, "ref", ""))
                        if _pp:
                            co_items.append({"path": _pp,
                                             "x": float(getattr(_q, "x", 0.66) if getattr(_q, "x", None) is not None else 0.66),
                                             "y": float(getattr(_q, "y", 0.60) if getattr(_q, "y", None) is not None else 0.60),
                                             "scale": float(getattr(_q, "scale", 0.32) if getattr(_q, "scale", None) is not None else 0.32),
                                             "z": getattr(_q, "z", None), "opacity": getattr(_q, "opacity", None)})
                    # 先试 ffcompose 统一图层合成(每角色 idle 底 + 说话段时间窗 + 商品,按 z 叠);
                    # 失败回退 moviepy turntaking。字幕+昵称仍由后面的 _apply_overlays 处理。
                    _ff_ok = False
                    try:
                        from chayuan.server.video_generation.digital_human import ffcompose as _ff
                        from chayuan.server.video_generation.compute import get_compute as _gc
                        _durs = [max(1, int(m.get("duration_ms") or 0)) for m in seg_meta]
                        _coaud = os.path.join(td, "coframe_audio.wav")
                        _concat_wavs([os.path.splitext(c)[0] + ".wav" for c in clips], _coaud, _gc().ffmpeg_exe)
                        _W, _H = args["width"], args["height"]
                        _layers = []
                        for _ri in range(len(slots)):
                            _av = avatars[_ri]
                            if not _av:
                                continue
                            _k = "video" if os.path.splitext(_av)[1].lower() in _VIDEO_EXT else "image"
                            _layers.append({"src": _av, "kind": _k, "x": positions[_ri][0], "y": positions[_ri][1],
                                            "scale": positions[_ri][2], "z": zs[_ri], "opacity": ops[_ri],
                                            "loop": (_k == "video"), "windows": None})
                        _acc = 0
                        for _i, _c in enumerate(clips):
                            _ri = unit_roles[_i]
                            _st = _acc
                            _acc += _durs[_i]
                            _layers.append({"src": _c, "kind": "video", "x": positions[_ri][0], "y": positions[_ri][1],
                                            "scale": positions[_ri][2], "z": zs[_ri], "opacity": ops[_ri],
                                            "loop": False, "windows": [{"start_ms": _st, "end_ms": _acc}]})
                        for _it in co_items:
                            _k = "video" if os.path.splitext(_it["path"])[1].lower() in _VIDEO_EXT else "image"
                            _layers.append({"src": _it["path"], "kind": _k, "x": _it["x"], "y": _it["y"],
                                            "scale": _it["scale"], "z": _it["z"], "opacity": _it["opacity"],
                                            "loop": (_k == "video"), "windows": None})
                        _scene = {"width": _W, "height": _H, "duration_ms": _acc or 5000,
                                  "audio_path": _coaud, "layers": _layers, "subtitle": None}
                        _ff.render(_scene, out_path, on_progress=_op)
                        _ff_ok = True
                        logger.info("[dh-timing] mode=coframe compose=ffcompose encoder=%s", _gc().video_encoder)
                    except Exception as e:  # noqa: BLE001
                        logger.warning("[dh] coframe ffcompose 失败,回退 moviepy turntaking: %r", e)
                    if not _ff_ok:
                        try:
                            _cm.render_coframe_turntaking(clips, unit_roles, positions, avatars, zs=zs, opacities=ops,
                                                          out_path=out_path, width=args["width"], height=args["height"],
                                                          on_progress=_op, products=co_items)
                        except Exception as e:  # noqa: BLE001
                            logger.warning("[dh] 同框轮流合成失败,回退按句顺序: %r", e)
                            _cm.render_sequential(clips, out_path=out_path, width=args["width"], height=args["height"], on_progress=_op)
                else:
                    _cm.render_sequential(clips, out_path=out_path, width=args["width"], height=args["height"], on_progress=_op)
            except Exception as e:  # noqa: BLE001
                logger.warning("[dh] %s 合成失败,回退首个形象片段: %r", mode, e)
                import shutil
                shutil.copyfile(clips[0], out_path)
            out_path = _apply_overlays(out_path, td, preset, slots, args.get("text"), args["width"], args["height"])
            _set(tid, state="complete", progress=100, result_path=out_path,
                 script=args.get("text", ""), segments=seg_meta)
            return
        # ---- 单形象(原路径)----
        avatar = resolve_avatar_path(preset.avatar_ref)
        if not avatar:
            raise RuntimeError("形象文件缺失")
        audio_path = os.path.join(td, "narration.wav")
        _tt = time.perf_counter()
        _synthesize_narration(args["text"], preset, audio_path)
        _t_tts = time.perf_counter() - _tt
        _set(tid, progress=30)
        _tt = time.perf_counter()
        get_engine(args.get("engine") or "wav2lip").generate(
            avatar_path=avatar, audio_path=audio_path, out_path=out_path,
            width=args["width"], height=args["height"],
            on_progress=lambda pct: _set(tid, progress=30 + int(pct * 0.7)),
        )
        _t_infer = time.perf_counter() - _tt
        logger.info("[dh-timing] mode=single tts=%.1fs infer(wav2lip)=%.1fs", _t_tts, _t_infer)
        result_path = out_path
        W, H = args["width"], args["height"]
        _slot0 = (getattr(preset, "avatars", None) or [None])[0]
        matte = bool(args.get("matte"))
        # 商品图层解析(preset.products 优先;旧 product_ref 兼容)
        items = []
        for q in (getattr(preset, "products", None) or []):
            pp = resolve_product_path(getattr(q, "ref", ""))
            if pp:
                items.append({"path": pp,
                              "x": float(getattr(q, "x", 0.66) if getattr(q, "x", None) is not None else 0.66),
                              "y": float(getattr(q, "y", 0.60) if getattr(q, "y", None) is not None else 0.60),
                              "scale": float(getattr(q, "scale", 0.32) if getattr(q, "scale", None) is not None else 0.32),
                              "z": getattr(q, "z", None), "opacity": getattr(q, "opacity", None)})
        if not items:
            _argref = args.get("product_ref")
            _pp = resolve_product_path(_argref) if _argref else None
            if _pp:
                items.append({"path": _pp,
                              "x": float(getattr(preset, "product_x", 0.66) or 0.66),
                              "y": float(getattr(preset, "product_y", 0.60) or 0.60),
                              "scale": float(getattr(preset, "product_scale", 0.32) or 0.32),
                              "z": getattr(preset, "product_z", None),
                              "opacity": getattr(preset, "product_opacity", None)})

        avatar_layer = {
            "x": float(getattr(_slot0, "x", 0.0) or 0.0) if _slot0 is not None else 0.0,
            "y": float(getattr(_slot0, "y", 0.0) or 0.0) if _slot0 is not None else 0.0,
            "scale": float(getattr(_slot0, "scale", 1.0) or 1.0) if _slot0 is not None else 1.0,
            "z": getattr(_slot0, "z", None) if _slot0 is not None else None,
            "opacity": getattr(_slot0, "opacity", None) if _slot0 is not None else None,
        }
        presenter_raw = os.path.join(td, "presenter.mp4")
        final_path = os.path.join(td, "digital_human.mp4")
        os.replace(out_path, presenter_raw)   # 原始全屏 presenter 让出最终名
        dur_ms = _probe_duration_ms(presenter_raw) or _probe_duration_ms(audio_path) or 5000
        _set(tid, progress=88)

        if matte:
            # matte(绿键)P0 仍走 moviepy + _apply_overlays(ffmpeg 绿键留后续)
            if items:
                render_with_product_matte(presenter_path=presenter_raw, avatar=avatar_layer, products=items,
                                          audio_path=audio_path, out_path=final_path, width=W, height=H, dur_ms=dur_ms)
            else:
                os.replace(presenter_raw, final_path)
            result_path = _apply_overlays(final_path, td, preset, getattr(preset, "avatars", None) or [], args.get("text"), W, H)
        else:
            # 非 matte:形象 + 商品 + 字幕 一趟 ffcompose;失败回退 moviepy。
            _t0 = time.perf_counter()
            sub = _build_subtitle(td, preset, args.get("text"), W, H, dur_ms)
            _full = (avatar_layer["scale"] >= 0.999 and avatar_layer["x"] < 0.001
                     and avatar_layer["y"] < 0.001
                     and (avatar_layer["opacity"] is None or float(avatar_layer["opacity"]) >= 0.999))
            if not items and sub is None and _full:
                # 最简单:全屏形象、无商品、无字幕 → 直接用原始 presenter,免无谓重编码。
                os.replace(presenter_raw, final_path)
                result_path = final_path
                _set(tid, state="complete", progress=100, result_path=result_path, script=args.get("text", ""))
                return
            layers = [dict(avatar_layer, src=presenter_raw, kind="video", loop=False, windows=None)]
            for it in items:
                _kind = "video" if os.path.splitext(it["path"])[1].lower() in _VIDEO_EXT else "image"
                layers.append({"src": it["path"], "kind": _kind, "x": it["x"], "y": it["y"],
                               "scale": it["scale"], "z": it["z"], "opacity": it["opacity"],
                               "loop": (_kind == "video"), "windows": None})
            scene = {"width": W, "height": H, "duration_ms": dur_ms, "audio_path": audio_path,
                     "layers": layers, "subtitle": sub}
            try:
                from chayuan.server.video_generation.digital_human import ffcompose as _ff
                _ff.render(scene, final_path)
                result_path = final_path
                from chayuan.server.video_generation.compute import get_compute as _gc
                logger.info("[dh-timing] mode=single compose(ffcompose)=%.1fs encoder=%s",
                            time.perf_counter() - _t0, _gc().video_encoder)
            except Exception as e:  # noqa: BLE001
                logger.warning("[dh] ffcompose 失败,回退 moviepy: %r", e)
                if items:
                    render_scene_layered(presenter_path=presenter_raw, avatar=avatar_layer, products=items,
                                         audio_path=audio_path, out_path=final_path, width=W, height=H, dur_ms=dur_ms, matte=False)
                else:
                    _sc, _sx, _sy = avatar_layer["scale"], avatar_layer["x"], avatar_layer["y"]
                    _sop = avatar_layer["opacity"]
                    if _sc < 0.999 or _sx > 0.001 or _sy > 0.001 or (_sop is not None and float(_sop) < 0.999):
                        try:
                            from chayuan.server.video_generation.digital_human import compose_multi as _cm
                            _cm.render_coframe([presenter_raw], layout="side", out_path=final_path,
                                               width=W, height=H, positions=[(_sx, _sy, _sc)], opacities=[_sop])
                        except Exception as e2:  # noqa: BLE001
                            logger.warning("[dh] 单形象摆放回退失败,用全屏: %r", e2)
                            os.replace(presenter_raw, final_path)
                    else:
                        os.replace(presenter_raw, final_path)
                result_path = _apply_overlays(final_path, td, preset, getattr(preset, "avatars", None) or [], args.get("text"), W, H)
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
           role_scripts=None, role_segments=None, script=None,
           script_model: str = "") -> str:
    tid = uuid.uuid4().hex[:12]
    _PENDING[tid] = {"preset_id": preset_id, "text": text, "width": width, "height": height,
                     "product_ref": product_ref, "template": template, "matte": matte,
                     "engine": engine, "role_scripts": role_scripts,
                     "role_segments": role_segments, "script": script}
    _set(tid, state="pending", progress=0, created_at=time.time(),
         script_model=script_model, engine=engine)
    _POOL.submit(_run_pipeline, tid)
    return tid


def run_sync(tid: str) -> None:
    """测试用:同步跑,不经线程池。"""
    _run_pipeline(tid)
