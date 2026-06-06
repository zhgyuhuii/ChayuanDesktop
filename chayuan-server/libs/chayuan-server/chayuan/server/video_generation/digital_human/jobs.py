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
# 活跃生成任务数(供在线对话自适应:生成中时在线让出 CPU 走纯音频,生成完恢复口型)。
_ACTIVE = 0
_ACTIVE_LOCK = threading.Lock()


def active_generations() -> int:
    """当前正在执行的合成任务数(>0 说明 CPU 正被生成占用)。"""
    return _ACTIVE
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


def _gen_dims(width: int, height: int):
    """生成分辨率上限(CPU 压榨):引擎按 ≤cap 宽生成,ffcompose/compose 再放大到显示尺寸,
    每帧贴回+写盘像素量骤降(CPU 主要开销在此,推理本体 96x96 很小)。
    env CHAYUAN_DH_GEN_MAX_WIDTH(默认 720;0=不限,全分辨率)。保持宽高比、取偶数。"""
    try:
        cap = int(os.environ.get("CHAYUAN_DH_GEN_MAX_WIDTH", "720"))
    except Exception:  # noqa: BLE001
        cap = 720
    if cap <= 0 or width <= cap:
        return int(width), int(height)
    gw = cap
    gh = max(2, int(round(height * cap / float(width))))
    return gw - (gw % 2), gh - (gh % 2)


def _wav_ms(path: str) -> int:
    """读 wav 时长 ms(stdlib);失败返 0。"""
    try:
        import wave
        with wave.open(path, "rb") as w:
            fr = w.getframerate() or 16000
            return max(1, int(w.getnframes() * 1000 / fr))
    except Exception:  # noqa: BLE001
        return 0


def _write_silence_wav(path: str, ms: int = 250, sr: int = 16000) -> str:
    """写一段静音 wav(stdlib,无依赖)。用于空/失败的 TTS 段兜底,避免下游 load_wav 崩。"""
    import wave
    n = max(1, int(sr * ms / 1000))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"\x00\x00" * n)
    return path


def _synth_to_wav(text: str, provider: str, name: str, audio_path: str, rate: float = 1.0, volume: float = 1.0) -> str:
    """指定音色合成旁白 wav。空/失败 → 静音兜底。"""
    from chayuan.server.modality.audio import AudioPipeline
    voice = _voice_string(provider, name)
    logger.info("[dh] narration provider=%s voice=%r", provider, voice)
    try:
        data = AudioPipeline().synthesize(text, voice=voice, fmt="wav")
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] TTS 合成异常,用静音兜底: %r", e)
        data = b""
    # 空/非法(文本被符号清洗清空、纯标点段、或合成失败)→ 写短静音,避免 wav2lip load_wav
    # 报 EOFError / Format not recognised,保证流程不中断。
    if not data or len(data) < 256:
        logger.warning("[dh] 段音频为空(text=%r),用静音兜底", (text or "")[:20])
        _write_silence_wav(audio_path)
        return audio_path
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


def _gen_slot_clips(tid, preset, slots, global_text, engine, td, width, height, role_scripts=None, role_segments=None, fps=None):
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
        gw, gh = _gen_dims(gw, gh)   # CPU 压榨:再封顶到 max gen 宽
        get_engine(engine).generate(avatar_path=av, audio_path=ap, out_path=cp,
                                    width=gw, height=gh, on_progress=None, fps=fps)
        clips.append(cp)
        unit_roles.append(u.role_index)
        seg_meta.append({"role_index": int(u.role_index), "path": cp,
                         "text": getattr(u, "text", "") or "",
                         "duration_ms": _probe_duration_ms(cp)})
        _set(tid, progress=10 + int((i + 1) * 78 / n))
    if not clips:
        raise RuntimeError("没有可用片段(形象缺失)")
    return clips, unit_roles, seg_meta


def _apply_overlays(result_path, td, preset, slots, text, width, height, skip_subtitle=False):
    """成片叠昵称标签+字幕(fail-safe);返回新成片路径(失败返原 result_path)。
    昵称标签仅多角色(coframe/sequential)烧入——single 是干净口播,不烧名字。
    skip_subtitle=True:字幕已由 ffcompose 按真实时间烧入,这里只叠昵称(不再用均匀估算的
    moviepy 字幕,避免重复 + 不同步)。"""
    try:
        from chayuan.server.video_generation.digital_human import overlay as _ov
        from chayuan.server.video_generation.digital_human.timeline_bridge import build_cues_from_script
        from chayuan.server.video_generation.steps.subtitle import _probe_audio_duration_ms
        # 成片不再烧昵称标签:多角色昵称会全程挂在画面上(不随形象出场/消失),用户要求移除。
        # 角色身份靠画面+字幕区分即可。如需恢复可改回按 slots 的 name 生成 labels。
        labels = []
        cues = []
        if not skip_subtitle and getattr(preset, "subtitle_enabled", True):
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
        # build_ass 以 dict 读 cue(c.get(...));build_cues_from_script 返回 SrtCue 对象,
        # 直接传会 AttributeError → 单形象字幕烧不上。这里转成 dict。
        _cd = [{"start_ms": getattr(c, "start_ms", 0), "end_ms": getattr(c, "end_ms", 0),
                "text": getattr(c, "text", "") or ""} for c in cues]
        ass = _sa.build_ass(_cd, style, os.path.join(td, "sub.ass"),
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


def _concat_clip_audio(clips, out_path, ffmpeg_exe):
    """提取各 clip 自带音轨,按顺序拼成一条连续音频。

    coframe 同步关键:clip(seg.mp4)由 wav2lip 用 -shortest mux,音轨时长==视频时长。
    若音频来自独立 wav 而视频窗口按 clip 时长排布,两者会有帧 padding 缝隙逐段累积 →
    "说着说着口型对不上声"。改为音频也取 clip 自身 → 每段音频时长==视频窗口时长,严格对齐。
    失败抛异常(caller 兜底回 moviepy)。"""
    import subprocess
    clips = [c for c in (clips or []) if c and os.path.isfile(c)]
    if not clips:
        raise RuntimeError("无可拼接片段音频")
    cmd = [ffmpeg_exe, "-y", "-loglevel", "error"]
    for c in clips:
        cmd += ["-i", c]
    n = len(clips)
    # 先把各段统一到 44100/单声道再 concat(concat filter 要求各段同格式,否则报错)。
    pre = "".join("[%d:a]aresample=44100,aformat=channel_layouts=mono[a%d];" % (i, i) for i in range(n))
    fc = pre + "".join("[a%d]" % i for i in range(n)) + "concat=n=%d:v=0:a=1[a]" % n
    cmd += ["-filter_complex", fc, "-map", "[a]", out_path]
    subprocess.run(cmd, check=True)
    return out_path


def _probe_wh(path):
    """探视频宽高 (w,h);失败返 (0,0)。"""
    try:
        import cv2
        cap = cv2.VideoCapture(path)
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        cap.release()
        return w, h
    except Exception:  # noqa: BLE001
        return 0, 0


def _matte_sim_for(key):
    """按背景纯色饱和度给 colorkey 相似度:绿/蓝幕(高饱和、离肤色远)可大些抠得干净;
    白/灰/接近肤色(低饱和)收很紧,否则会把脸的高光/肤色一起抠透(用户报「脸变透明」)。
    可用 CHAYUAN_DH_MATTE_SIM 强制覆盖。"""
    _forced = os.environ.get("CHAYUAN_DH_MATTE_SIM", "")
    if _forced:
        try:
            return float(_forced)
        except ValueError:
            pass
    try:
        r, g, b = int(key[0]), int(key[1]), int(key[2])
        mx, mn = max(r, g, b), min(r, g, b)
        sat = (mx - mn) / mx if mx > 0 else 0.0
        return 0.22 if sat > 0.35 else 0.10
    except Exception:  # noqa: BLE001
        return 0.10


def _maybe_bgm(video_path, args):
    """按生成请求把背景音乐混进成片(复用 VG steps.compose.get_bgm_file 选曲:内置 29 首 + 用户上传)。
    视频流 -c:v copy 不重编码(快),只重混音轨:bgm 循环铺满、按 bgm_volume 压低、随旁白时长截断。
    bgm_type=none/空 或 无曲/失败 → 不动原片。"""
    bgm_type = (args.get("bgm_type") or "none")
    logger.info("[dh] BGM 请求: type=%s file=%s vol=%s", bgm_type, args.get("bgm_file"), args.get("bgm_volume"))
    if not bgm_type or bgm_type == "none":
        return
    try:
        from chayuan.server.video_generation.steps.compose import get_bgm_file
        bgm = get_bgm_file(bgm_type=bgm_type, bgm_file=args.get("bgm_file") or "")
        if not bgm or not os.path.isfile(bgm) or not os.path.isfile(video_path):
            logger.info("[dh] BGM 跳过(无曲/无成片) type=%s file=%s 选中=%s",
                        bgm_type, args.get("bgm_file"), bgm)
            return
        import subprocess
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        _v = args.get("bgm_volume")
        vol = max(0.0, min(1.0, float(_v if _v is not None else 0.2)))
        out = video_path + ".bgm.mp4"
        # 旁白(0:a,edge TTS 多为 24kHz)与 BGM(1:a,常 44.1kHz)采样率不同 → amix 前都 aresample
        # 到 44.1kHz,否则 amix 可能失败被吞(用户报「BGM 没合成」)。-c:v copy 不重编码视频(快)。
        cmd = [ff, "-y", "-loglevel", "error",
               "-i", video_path, "-stream_loop", "-1", "-i", bgm,
               "-filter_complex",
               f"[1:a]volume={vol},aresample=44100[b];[0:a]aresample=44100[n];"
               f"[n][b]amix=inputs=2:duration=first:dropout_transition=0[a]",
               "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", out]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        os.replace(out, video_path)
        logger.info("[dh] BGM 混音完成: %s vol=%.2f", os.path.basename(bgm), vol)
    except subprocess.CalledProcessError as e:  # noqa: BLE001
        _err = (e.stderr or b"").decode("utf-8", "ignore")[-500:] if getattr(e, "stderr", None) else ""
        logger.warning("[dh] BGM 混音失败(ffmpeg),保留无 BGM 成片: %s", _err or repr(e))
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] BGM 混音失败,保留无 BGM 成片: %r", e)


def _detect_bg_key(video_path):
    """探视频首帧四角的背景纯色 (r,g,b),作抠像键色;失败返 None(ffcompose 不加 colorkey)。"""
    try:
        import cv2
        import numpy as np
        cap = cv2.VideoCapture(video_path)
        ok, f = cap.read()
        cap.release()
        if not ok or f is None:
            return None
        f = f[:, :, ::-1].astype(int)   # BGR→RGB
        h, w = f.shape[:2]
        m = max(2, int(min(h, w) * 0.04))
        corners = np.concatenate([
            f[:m, :m].reshape(-1, 3), f[:m, w - m:].reshape(-1, 3),
            f[h - m:, :m].reshape(-1, 3), f[h - m:, w - m:].reshape(-1, 3)])
        med = np.median(corners, axis=0)
        return (int(med[0]), int(med[1]), int(med[2]))
    except Exception:  # noqa: BLE001
        return None


def _resolve_products(preset, product_ref=None):
    """商品图层解析(preset.products 优先;旧 product_ref + preset.product_* 兼容)→ [item]。
    single/coframe/resubtitle 共用,保证全链路商品摆放一致。"""
    items = []
    for q in (getattr(preset, "products", None) or []):
        pp = resolve_product_path(getattr(q, "ref", ""))
        if pp:
            items.append({"path": pp,
                          "x": float(getattr(q, "x", 0.66) if getattr(q, "x", None) is not None else 0.66),
                          "y": float(getattr(q, "y", 0.60) if getattr(q, "y", None) is not None else 0.60),
                          "scale": float(getattr(q, "scale", 0.32) if getattr(q, "scale", None) is not None else 0.32),
                          "z": getattr(q, "z", None), "opacity": getattr(q, "opacity", None)})
    if not items and product_ref:
        pp = resolve_product_path(product_ref)
        if pp:
            items.append({"path": pp,
                          "x": float(getattr(preset, "product_x", 0.66) or 0.66),
                          "y": float(getattr(preset, "product_y", 0.60) or 0.60),
                          "scale": float(getattr(preset, "product_scale", 0.32) or 0.32),
                          "z": getattr(preset, "product_z", None),
                          "opacity": getattr(preset, "product_opacity", None)})
    if items:
        logger.info("[dh] 商品图层(合成用): %s",
                    [{"ref": os.path.basename(it["path"]), "x": round(it["x"], 3),
                      "y": round(it["y"], 3), "scale": round(it["scale"], 3), "z": it["z"]} for it in items])
    return items


def _subtitle_style(preset, style_extra=None):
    """字幕样式 dict(取预设值;style_extra 非 None 项覆盖)。"""
    style = {
        "subtitle_position": getattr(preset, "subtitle_position", "bottom"),
        "font_name": getattr(preset, "font_name", ""),
        "font_size": getattr(preset, "font_size", 0),
        "text_fore_color": getattr(preset, "text_fore_color", ""),
        "stroke_color": getattr(preset, "stroke_color", ""),
        "stroke_width": getattr(preset, "stroke_width", None),
    }
    if style_extra:
        for k in ("subtitle_position", "font_name", "font_size", "text_fore_color", "stroke_color", "stroke_width"):
            if style_extra.get(k) is not None:
                style[k] = style_extra[k]
    return style


def _ass_from_cues(td, preset, cues, width, height, name="sub.ass", style_extra=None):
    """从显式 dict cues([{start_ms,end_ms,text}])建字幕 ass(复用预设样式+可选覆盖);
    无有效 cue/失败返 None。"""
    try:
        cues = [c for c in (cues or []) if (str(c.get("text") or "")).strip()]
        if not cues:
            return None
        from chayuan.server.video_generation.digital_human import subtitle_ass as _sa
        from chayuan.server.video_generation.digital_human import overlay as _ov
        style = _subtitle_style(preset, style_extra)
        font = _ov._resolve_font_path(style.get("font_name") or None)
        return _sa.build_ass(cues, style, os.path.join(td, name),
                             width=width, height=height, font_path=font)
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] 字幕 ass 构建失败(忽略): %r", e)
        return None


def _build_coframe_scene(td, preset, segments, width, height, ffmpeg_exe,
                         cues=None, style_extra=None, idle=True, matte=False):
    """从已生成片段(segments:[{role_index,path,text,duration_ms}])重建 ffcompose 场景
    (每角色 idle 底 + 说话段时间窗 + 商品,按 z 叠;音频取各 clip 自身拼接,严格同步)。

    idle=True(同框 coframe):所有角色 idle 常显,说话段动。
    idle=False(分段轮流 sequential):**不铺 idle 底**,只在各自时间窗显示当前说话的角色
    (按角色 x/y/scale 定位),实现「轮流出场、各按设置大小位置」而非全屏拉伸。

    cues=None → 用各段真实时间+文本建字幕;否则用传入 cues(就地编辑字幕场景)。
    生成与「就地编辑字幕重渲染」共用此函数,保证两条路径完全一致。返回 scene dict。"""
    slots = list(getattr(preset, "avatars", None) or [])
    positions = [(float(getattr(s, "x", 0.0) or 0.0), float(getattr(s, "y", 0.0) or 0.0),
                  float(getattr(s, "scale", 1.0) or 1.0)) for s in slots]
    avatars = [resolve_avatar_path(s.ref) for s in slots]
    zs = [getattr(s, "z", None) for s in slots]
    ops = [getattr(s, "opacity", None) for s in slots]
    co_items = _resolve_products(preset)
    clips = [seg.get("path") for seg in segments]
    unit_roles = [int(seg.get("role_index", 0) or 0) for seg in segments]
    durs = [max(1, int(seg.get("duration_ms") or 0) or 1) for seg in segments]
    coaud = os.path.join(td, "coframe_audio.wav")
    _concat_clip_audio(clips, coaud, ffmpeg_exe)
    # 抠像:开了 matte 就按各角色片段背景纯色 colorkey 形象层(同框/轮流都支持)。每角色探一次。
    role_keys = {}
    if matte:
        for i, c in enumerate(clips):
            ri = unit_roles[i]
            if ri not in role_keys and c:
                role_keys[ri] = _detect_bg_key(c)

    def _mk(ri):
        key = role_keys.get(ri) if matte else None
        return {"matte_key": key, "matte_sim": _matte_sim_for(key)} if key else {}
    layers = []
    if idle:
        # 同框:每角色 idle 底常显。分段轮流(idle=False)不铺底,只显当前说话段。
        for ri in range(len(slots)):
            av = avatars[ri]
            if not av:
                continue
            k = "video" if os.path.splitext(av)[1].lower() in _VIDEO_EXT else "image"
            layers.append({"src": av, "kind": k, "x": positions[ri][0], "y": positions[ri][1],
                           "scale": positions[ri][2], "z": zs[ri], "opacity": ops[ri],
                           "loop": (k == "video"), "windows": None, **_mk(ri)})
    acc = 0
    subcues = []
    for i, c in enumerate(clips):
        ri = unit_roles[i]
        st0 = acc
        acc += durs[i]
        layers.append({"src": c, "kind": "video", "x": positions[ri][0], "y": positions[ri][1],
                       "scale": positions[ri][2], "z": zs[ri], "opacity": ops[ri],
                       "loop": False, "windows": [{"start_ms": st0, "end_ms": acc}], **_mk(ri)})
        txt = (str(segments[i].get("text") or "")).strip()
        if txt:
            subcues.append({"start_ms": st0, "end_ms": acc, "text": txt})
    for it in co_items:
        k = "video" if os.path.splitext(it["path"])[1].lower() in _VIDEO_EXT else "image"
        layers.append({"src": it["path"], "kind": k, "x": it["x"], "y": it["y"],
                       "scale": it["scale"], "z": it["z"], "opacity": it["opacity"],
                       "loop": (k == "video"), "windows": None})
    # 字幕开关:style_extra 显式给了 subtitle_enabled 则以它为准,否则跟预设
    _en = (style_extra or {}).get("subtitle_enabled")
    _on = bool(_en) if _en is not None else bool(getattr(preset, "subtitle_enabled", True))
    sub = None
    if _on:
        ass = _ass_from_cues(td, preset, cues if cues is not None else subcues,
                             width, height, name="co_sub.ass", style_extra=style_extra)
        if ass:
            sub = {"ass_path": ass}
    return {"width": width, "height": height, "duration_ms": acc or 5000,
            "audio_path": coaud, "layers": layers, "subtitle": sub}


def _run_pipeline_tracked(tid: str) -> None:
    """包一层活跃计数(生成中在线对话自适应让出 CPU 用),确保 inc/dec 配对。"""
    global _ACTIVE
    with _ACTIVE_LOCK:
        _ACTIVE += 1
    try:
        _run_pipeline(tid)
    finally:
        with _ACTIVE_LOCK:
            _ACTIVE -= 1


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
                                    role_segments=args.get("role_segments"),
                                    fps=args.get("fps"))
            from chayuan.server.video_generation.digital_human import compose_multi as _cm
            _set(tid, progress=90)
            # 合成写帧进度 90→99(节流:仅整数变化时上报),避免长视频合成看着卡在 90%。
            _pg = [90]
            def _op(f):
                v = 90 + int(max(0.0, min(1.0, f)) * 9)
                if v != _pg[0]:
                    _pg[0] = v
                    _set(tid, progress=v)
            _sub_burned = False  # ffcompose 是否已烧字幕(烧了则 _apply_overlays 不再叠字幕,只叠昵称)
            try:
                if mode == "coframe":
                    positions = [(float(getattr(s, "x", 0.0) or 0.0),
                                  float(getattr(s, "y", 0.0) or 0.0),
                                  float(getattr(s, "scale", 1.0) or 1.0)) for s in slots]
                    avatars = [resolve_avatar_path(s.ref) for s in slots]
                    zs = [getattr(s, "z", None) for s in slots]  # 工作台调的图层叠放顺序
                    ops = [getattr(s, "opacity", None) for s in slots]  # 各角色不透明度
                    co_items = _resolve_products(preset)  # 商品随角色一起合成(兜底 turntaking 也用)
                    # 先试 ffcompose 统一图层合成;场景构建抽到 _build_coframe_scene,与「就地编辑字幕
                    # 重渲染」完全共用。失败回退 moviepy turntaking。字幕由 ffcompose 真实时间烧入。
                    _ff_ok = False
                    try:
                        from chayuan.server.video_generation.digital_human import ffcompose as _ff
                        from chayuan.server.video_generation.compute import get_compute as _gc
                        _scene = _build_coframe_scene(td, preset, seg_meta, args["width"], args["height"],
                                                      _gc().ffmpeg_exe, matte=bool(args.get("matte")))
                        _ff.render(_scene, out_path, on_progress=_op)
                        _ff_ok = True
                        _sub_burned = bool(_scene.get("subtitle"))
                        logger.info("[dh-timing] mode=coframe compose=ffcompose encoder=%s subtitle=%s",
                                    _gc().video_encoder, "burned" if _sub_burned else "none")
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
                    # 分段轮流:走 ffcompose 定位场景(idle=False:只显当前说话角色,按 x/y/scale 摆),
                    # 不再全屏拉伸。失败回退 render_sequential(拉伸兜底)。
                    _seq_ok = False
                    try:
                        from chayuan.server.video_generation.digital_human import ffcompose as _ff
                        from chayuan.server.video_generation.compute import get_compute as _gc
                        _scene = _build_coframe_scene(td, preset, seg_meta, args["width"], args["height"],
                                                      _gc().ffmpeg_exe, idle=False, matte=bool(args.get("matte")))
                        _ff.render(_scene, out_path, on_progress=_op)
                        _seq_ok = True
                        _sub_burned = bool(_scene.get("subtitle"))
                        logger.info("[dh-timing] mode=sequential compose=ffcompose(定位) subtitle=%s",
                                    "burned" if _sub_burned else "none")
                    except Exception as e:  # noqa: BLE001
                        logger.warning("[dh] sequential ffcompose 失败,回退 render_sequential(拉伸): %r", e)
                    if not _seq_ok:
                        _cm.render_sequential(clips, out_path=out_path, width=args["width"], height=args["height"], on_progress=_op)
            except Exception as e:  # noqa: BLE001
                logger.warning("[dh] %s 合成失败,回退首个形象片段: %r", mode, e)
                import shutil
                shutil.copyfile(clips[0], out_path)
            out_path = _apply_overlays(out_path, td, preset, slots, args.get("text"), args["width"], args["height"],
                                       skip_subtitle=_sub_burned)
            _maybe_bgm(out_path, args)
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
        # 按形象「原生宽高比」生成(不再强制画布 9:16,否则非 9:16 形象被拉伸 → 合成后仍是拉伸的)。
        # capped 到画布尺寸 + CPU 压榨封顶。与同框 _gen_slot_clips 一致;ffcompose 再按 scale/位置摆放。
        _gw, _gh = args["width"], args["height"]
        try:
            _aw = _ah = 0
            if os.path.splitext(avatar)[1].lower() in _VIDEO_EXT:
                import cv2 as _cv2
                _cap = _cv2.VideoCapture(avatar)
                _aw = int(_cap.get(_cv2.CAP_PROP_FRAME_WIDTH) or 0)
                _ah = int(_cap.get(_cv2.CAP_PROP_FRAME_HEIGHT) or 0)
                _cap.release()
            else:
                from PIL import Image as _Img
                with _Img.open(avatar) as _im:
                    _aw, _ah = _im.size
            if _aw > 0 and _ah > 0:
                _r = min(args["width"] / _aw, args["height"] / _ah, 1.0)  # 不放大、不超画布
                _gw = max(2, int(round(_aw * _r))); _gh = max(2, int(round(_ah * _r)))
                _gw -= _gw % 2; _gh -= _gh % 2
        except Exception:  # noqa: BLE001
            _gw, _gh = args["width"], args["height"]
        _gw, _gh = _gen_dims(_gw, _gh)   # CPU 压榨:再按 ≤cap 宽封顶
        get_engine(args.get("engine") or "wav2lip").generate(
            avatar_path=avatar, audio_path=audio_path, out_path=out_path,
            width=_gw, height=_gh, fps=args.get("fps"),
            on_progress=lambda pct: _set(tid, progress=30 + int(pct * 0.7)),
        )
        _t_infer = time.perf_counter() - _tt
        logger.info("[dh-timing] mode=single tts=%.1fs infer(wav2lip)=%.1fs", _t_tts, _t_infer)
        result_path = out_path
        W, H = args["width"], args["height"]
        _slot0 = (getattr(preset, "avatars", None) or [None])[0]
        matte = bool(args.get("matte"))
        # 商品图层解析(preset.products 优先;旧 product_ref 兼容)— 与 coframe/resubtitle 同源。
        items = _resolve_products(preset, args.get("product_ref"))

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
            # 抠像:走 ffcompose colorkey(ffmpeg 单趟,快)。**字幕并进 ffcompose**(免再起一趟 moviepy
            # _apply_overlays 逐帧重编码,那是之前抠像「还慢」的真因)。**按 z 排层**:全宽背景商品视频
            # 在底、形象在上,否则全宽视频会盖住形象。失败才回退 moviepy MaskColor + _apply_overlays。
            _key = _detect_bg_key(presenter_raw)
            _sub = _build_subtitle(td, preset, args.get("text"), W, H, dur_ms)
            _az = getattr(_slot0, "z", None)
            _az = float(_az) if _az is not None else 1.0
            _ok = False
            try:
                from chayuan.server.video_generation.digital_human import ffcompose as _ff
                from chayuan.server.video_generation.compute import get_compute as _gc
                _layers = [dict(avatar_layer, src=presenter_raw, kind="video", loop=False,
                                windows=None, matte_key=_key, matte_sim=_matte_sim_for(_key), z=_az)]
                for _it in items:
                    _k = "video" if os.path.splitext(_it["path"])[1].lower() in _VIDEO_EXT else "image"
                    _layers.append({"src": _it["path"], "kind": _k, "x": _it["x"], "y": _it["y"],
                                    "scale": _it["scale"], "z": _it["z"], "opacity": _it["opacity"],
                                    "loop": (_k == "video"), "windows": None})
                _layers.sort(key=lambda L: (L.get("z") if L.get("z") is not None else 0))  # 低 z 在底
                _scene = {"width": W, "height": H, "duration_ms": dur_ms, "audio_path": audio_path,
                          "layers": _layers, "subtitle": _sub}
                _ff.render(_scene, final_path)
                _ok = True
                logger.info("[dh-timing] mode=single 抠像 compose=ffcompose(colorkey+字幕) encoder=%s", _gc().video_encoder)
            except Exception as e:  # noqa: BLE001
                logger.warning("[dh] 抠像 ffcompose 失败,回退 moviepy: %r", e)
            if _ok:
                result_path = final_path
            else:
                try:
                    render_scene_layered(presenter_path=presenter_raw, avatar=avatar_layer, products=items,
                                         audio_path=audio_path, out_path=final_path, width=W, height=H,
                                         dur_ms=dur_ms, matte=True)
                except Exception as _me:  # noqa: BLE001
                    logger.warning("[dh] 抠像 moviepy 也失败,回退原片: %r", _me)
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
                _maybe_bgm(result_path, args)
                _set(tid, state="complete", progress=100, result_path=result_path, script=args.get("text", ""))
                return
            _az = getattr(_slot0, "z", None)
            _az = float(_az) if _az is not None else 1.0
            layers = [dict(avatar_layer, src=presenter_raw, kind="video", loop=False, windows=None, z=_az)]
            for it in items:
                _kind = "video" if os.path.splitext(it["path"])[1].lower() in _VIDEO_EXT else "image"
                layers.append({"src": it["path"], "kind": _kind, "x": it["x"], "y": it["y"],
                               "scale": it["scale"], "z": it["z"], "opacity": it["opacity"],
                               "loop": (_kind == "video"), "windows": None})
            layers.sort(key=lambda L: (L.get("z") if L.get("z") is not None else 0))  # 低 z 在底,全宽商品不盖形象
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
        _maybe_bgm(result_path, args)
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
           script_model: str = "", fps: Optional[float] = None,
           bgm_type: str = "none", bgm_file: str = "", bgm_volume: float = 0.2,
           name: str = "") -> str:
    tid = uuid.uuid4().hex[:12]
    _PENDING[tid] = {"preset_id": preset_id, "text": text, "width": width, "height": height,
                     "product_ref": product_ref, "template": template, "matte": matte,
                     "engine": engine, "role_scripts": role_scripts,
                     "role_segments": role_segments, "script": script, "fps": fps,
                     "bgm_type": bgm_type, "bgm_file": bgm_file, "bgm_volume": bgm_volume}
    _set(tid, state="pending", progress=0, created_at=time.time(),
         script_model=script_model, engine=engine, preset_id=preset_id, name=(name or "").strip())
    _POOL.submit(_run_pipeline_tracked, tid)
    return tid


def run_sync(tid: str) -> None:
    """测试用:同步跑,不经线程池。"""
    _run_pipeline(tid)


def _task_cues(st, preset):
    """任务字幕 cue:coframe/sequential 用各段真实时间+昵称前缀;single 用脚本按句均匀切。"""
    mode = getattr(preset, "compose_mode", "single") or "single"
    segments = list(getattr(st, "segments", None) or [])
    if mode in ("coframe", "sequential") and segments:
        slots = list(getattr(preset, "avatars", None) or [])
        n = len(slots)
        cues, acc = [], 0
        for seg in segments:
            ri = int(seg.get("role_index", 0) or 0)
            dur = max(1, int(seg.get("duration_ms") or 0) or 1)
            nm = (getattr(slots[ri], "name", "") if 0 <= ri < n else "") or ""
            cues.append({"start_ms": acc, "end_ms": acc + dur,
                         "text": (("%s: " % nm) if nm else "") + str(seg.get("text") or "")})
            acc += dur
        return cues
    try:
        from chayuan.server.video_generation.digital_human.timeline_bridge import build_cues_from_script
        dur = _probe_duration_ms(getattr(st, "result_path", "") or "") or 0
        return [{"start_ms": c.start_ms, "end_ms": c.end_ms, "text": c.text}
                for c in build_cues_from_script(getattr(st, "script", "") or "", dur)]
    except Exception:  # noqa: BLE001
        return []


def get_task_subtitle(tid: str) -> dict:
    """就地编辑字幕:返回 {mode, editable, style, cues}。editable=中间产物在、可重渲染。"""
    st = get_status(tid)
    if st.state != "complete":
        raise RuntimeError("任务未完成")
    preset = store.get_preset(getattr(st, "preset_id", "") or "")
    mode = (getattr(preset, "compose_mode", "single") or "single") if preset else "single"
    editable = False
    try:
        td = task_dir(f"dh-{tid}")
        if mode in ("coframe", "sequential"):
            segs = list(getattr(st, "segments", None) or [])
            editable = bool(segs) and all(s.get("path") and os.path.isfile(s.get("path")) for s in segs)
        else:
            editable = (os.path.isfile(os.path.join(td, "presenter.mp4"))
                        or bool(getattr(st, "result_path", "") and os.path.isfile(st.result_path))) \
                       and os.path.isfile(os.path.join(td, "narration.wav"))
        editable = bool(editable and preset is not None)
    except Exception:  # noqa: BLE001
        editable = False
    style = _subtitle_style(preset) if preset else {}
    style["subtitle_enabled"] = bool(getattr(preset, "subtitle_enabled", True)) if preset else True
    return {"mode": mode, "editable": editable, "style": style,
            "cues": _task_cues(st, preset) if preset else []}


def resubtitle_task(tid: str, cues, style=None) -> str:
    """就地编辑字幕重渲染:复用已生成片段(seg clips / presenter),只重跑 ffcompose
    (跳过最贵的 wav2lip/TTS),用编辑后的 cues+样式重烧字幕。返回新成片路径。"""
    st = get_status(tid)
    if st.state != "complete":
        raise RuntimeError("任务未完成")
    preset = store.get_preset(getattr(st, "preset_id", "") or "")
    if preset is None:
        raise RuntimeError("预设缺失,无法重渲染(请重新生成后再编辑)")
    td = task_dir(f"dh-{tid}")
    mode = getattr(preset, "compose_mode", "single") or "single"
    from chayuan.server.video_generation.digital_human import ffcompose as _ff
    from chayuan.server.video_generation.compute import get_compute as _gc
    style = dict(style or {})
    cues = [{"start_ms": int(c.get("start_ms", 0) or 0), "end_ms": int(c.get("end_ms", 0) or 0),
             "text": str(c.get("text") or "")} for c in (cues or [])]
    W = int(getattr(preset, "video_width", 0) or 0)
    H = int(getattr(preset, "video_height", 0) or 0)
    if W <= 0 or H <= 0:
        W, H = _probe_wh(getattr(st, "result_path", "") or "")
    if W <= 0 or H <= 0:
        W, H = 720, 1280
    out_tmp = os.path.join(td, "resub_tmp.mp4")
    if mode in ("coframe", "sequential"):
        segs = list(getattr(st, "segments", None) or [])
        if not segs or not all(s.get("path") and os.path.isfile(s.get("path")) for s in segs):
            raise RuntimeError("片段已清理,无法重渲染(请重新生成后再编辑)")
        scene = _build_coframe_scene(td, preset, segs, W, H, _gc().ffmpeg_exe,
                                     cues=cues, style_extra=style)
        _ff.render(scene, out_tmp)
    else:
        presenter = os.path.join(td, "presenter.mp4")
        if not os.path.isfile(presenter):
            presenter = getattr(st, "result_path", "") or ""
        audio = os.path.join(td, "narration.wav")
        if not os.path.isfile(presenter) or not os.path.isfile(audio):
            raise RuntimeError("中间产物已清理,无法重渲染(请重新生成后再编辑)")
        slot0 = (getattr(preset, "avatars", None) or [None])[0]
        avatar_layer = {
            "x": float(getattr(slot0, "x", 0.0) or 0.0) if slot0 is not None else 0.0,
            "y": float(getattr(slot0, "y", 0.0) or 0.0) if slot0 is not None else 0.0,
            "scale": float(getattr(slot0, "scale", 1.0) or 1.0) if slot0 is not None else 1.0,
            "z": getattr(slot0, "z", None) if slot0 is not None else None,
            "opacity": getattr(slot0, "opacity", None) if slot0 is not None else None,
        }
        items = _resolve_products(preset)
        dur_ms = _probe_duration_ms(presenter) or _probe_duration_ms(audio) or 5000
        layers = [dict(avatar_layer, src=presenter, kind="video", loop=False, windows=None)]
        for it in items:
            k = "video" if os.path.splitext(it["path"])[1].lower() in _VIDEO_EXT else "image"
            layers.append({"src": it["path"], "kind": k, "x": it["x"], "y": it["y"],
                           "scale": it["scale"], "z": it["z"], "opacity": it["opacity"],
                           "loop": (k == "video"), "windows": None})
        _en = style.get("subtitle_enabled")
        _on = bool(_en) if _en is not None else bool(getattr(preset, "subtitle_enabled", True))
        sub = None
        if _on:
            ass = _ass_from_cues(td, preset, cues, W, H, name="resub.ass", style_extra=style)
            if ass:
                sub = {"ass_path": ass}
        scene = {"width": W, "height": H, "duration_ms": dur_ms, "audio_path": audio,
                 "layers": layers, "subtitle": sub}
        _ff.render(scene, out_tmp)
    # 字幕已烧,_apply_overlays 只补昵称(多角色);single 无昵称直接返回 out_tmp
    out2 = _apply_overlays(out_tmp, td, preset, getattr(preset, "avatars", None) or [],
                           getattr(st, "script", "") or "", W, H, skip_subtitle=True)
    src = out2 if (out2 and os.path.isfile(out2)) else out_tmp
    final = getattr(st, "result_path", "") or os.path.join(td, "digital_human.mp4")
    if os.path.abspath(src) != os.path.abspath(final):
        os.replace(src, final)
    _set(tid, result_path=final)
    return final
