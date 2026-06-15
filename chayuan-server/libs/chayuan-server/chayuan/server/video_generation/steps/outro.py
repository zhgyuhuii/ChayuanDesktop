"""片尾:非会员的合成视频自动拼接 video_end.mp4 到末尾。

设计要点:
- 会员判断走 license.engine.is_paid_member(时间制 或 购买/赠送次数,不含每日免费)。
- 片尾资产 video_end.mp4 多路径兜底定位(env / CHAYUAN_ROOT / vendor / 源码树 / frozen)。
- ffmpeg filter_complex 单趟:把片尾按主视频分辨率缩放+补黑边、统一 fps/sar/pixfmt,
  音频统一 aac/44100/立体声后顺序拼接;主/片尾任一缺音轨用静音兜底。
- 任何失败只 warning、返回原视频,绝不让"加片尾"破坏正片产出。
- 幂等:写 .outro.done 标记,重复调用直接跳过。
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

OUTRO_FILENAME = "video_end.mp4"
_MEMBER_APPS = ["video", "video_edit"]


def _ffmpeg() -> str:
    from .compose import get_ffmpeg_binary
    return get_ffmpeg_binary()


def get_ffprobe_binary() -> str | None:
    """ffprobe 定位:env -> 从 ffmpeg 路径派生同目录 ffprobe -> PATH。找不到返回 None。"""
    import shutil
    env = os.environ.get("IMAGEIO_FFPROBE_EXE")
    if env and os.path.isfile(env):
        return env
    try:
        ff = _ffmpeg()
        if ff and os.path.sep in ff:
            base = os.path.basename(ff)
            cand = os.path.join(os.path.dirname(ff), base.replace("ffmpeg", "ffprobe"))
            if os.path.isfile(cand):
                return cand
    except Exception:  # noqa: BLE001
        pass
    return shutil.which("ffprobe")


def _probe(path: str) -> dict | None:
    """返回 {w,h,has_audio,dur}。ffprobe 不可用或失败返回 None。"""
    fp = get_ffprobe_binary()
    if not fp:
        return None
    try:
        out = subprocess.run(
            [fp, "-v", "error", "-show_entries",
             "stream=codec_type,width,height,r_frame_rate:format=duration",
             "-of", "json", path],
            capture_output=True, text=True, check=False,
        )
        data = json.loads(out.stdout or "{}")
    except Exception:  # noqa: BLE001
        return None
    w = h = 0
    has_audio = False
    fps = ""
    for s in data.get("streams", []):
        if s.get("codec_type") == "video" and not w:
            w, h = int(s.get("width") or 0), int(s.get("height") or 0)
            rfr = str(s.get("r_frame_rate") or "")
            if rfr and rfr not in ("0/0", "0/1"):
                fps = rfr  # ffmpeg fps 滤镜接受 "30000/1001" 这种分数
        elif s.get("codec_type") == "audio":
            has_audio = True
    try:
        dur = float((data.get("format") or {}).get("duration") or 0.0)
    except (TypeError, ValueError):
        dur = 0.0
    if not (w and h):
        return None
    return {"w": w, "h": h, "has_audio": has_audio, "dur": dur, "fps": fps}


def _outro_source() -> str | None:
    """多路径定位 video_end.mp4,返回第一个存在的绝对路径。"""
    cand: list[str] = []
    env = os.environ.get("CHAYUAN_OUTRO_VIDEO")
    if env:
        cand.append(env)
    try:
        from .._helpers import _chayuan_root
        cand.append(str(_chayuan_root() / "video" / OUTRO_FILENAME))
    except Exception:  # noqa: BLE001
        pass
    try:
        from ..binaries import get_clips_dir, _vendor_root
        cd = get_clips_dir()
        if cd:
            cand.append(os.path.join(cd, OUTRO_FILENAME))
        vr = _vendor_root()
        if vr:
            cand.append(os.path.join(str(vr), "bundled_video_clips", OUTRO_FILENAME))
            cand.append(os.path.join(os.path.dirname(str(vr)), "video", OUTRO_FILENAME))
    except Exception:  # noqa: BLE001
        pass
    # 源码树:从本文件上溯,任一层的 video/video_end.mp4(命中 chayuan-server/video/)
    for p in Path(__file__).resolve().parents:
        cand.append(str(p / "video" / OUTRO_FILENAME))
    # frozen(PyInstaller):datas 落到 _MEIPASS/video/
    mp = getattr(sys, "_MEIPASS", None)
    if mp:
        cand.append(os.path.join(mp, "video", OUTRO_FILENAME))
    # frozen(PyInstaller)exe 同级 video/
    if getattr(sys, "frozen", False):
        cand.append(os.path.join(os.path.dirname(sys.executable), "video", OUTRO_FILENAME))
    for c in cand:
        try:
            if c and os.path.isfile(c):
                return os.path.abspath(c)
        except Exception:  # noqa: BLE001
            continue
    return None


def _build_cmd(ff: str, main: str, outro: str, out: str, *, w: int, h: int,
               outro_audio: bool, outro_dur: float, fps: str, threads: int) -> list[str]:
    """已知主视频 w/h:把片尾缩放到 w*h 补黑边,统一 fps/sar/pixfmt + aac/44100/stereo 后拼接。"""
    inputs = ["-i", main, "-i", outro]
    a_outro = "[1:a]"
    if not outro_audio:
        dur = outro_dur if outro_dur > 0 else 5.0
        inputs += ["-f", "lavfi", "-t", f"{dur:.3f}",
                   "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]
        a_outro = "[2:a]"
    vf_outro = (f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,fps={fps},setsar=1,format=yuv420p")
    fc = (
        f"[0:v]scale={w}:{h},fps={fps},setsar=1,format=yuv420p[v0];"
        f"[1:v]{vf_outro}[v1];"
        f"[0:a]aformat=sample_rates=44100:channel_layouts=stereo[a0];"
        f"{a_outro}aformat=sample_rates=44100:channel_layouts=stereo[a1];"
        f"[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]"
    )
    return [ff, "-y", *inputs, "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            "-threads", str(threads or 2), out]


def _build_cmd_scale2ref(ff: str, main: str, outro: str, out: str, *, fps: str, threads: int) -> list[str]:
    """无 ffprobe 兜底:scale2ref 把片尾缩到主视频尺寸(精确贴合,可能变形),假定两者都有音轨。"""
    fc = (
        "[1:v][0:v]scale2ref[ov][base];"
        f"[base]fps={fps},setsar=1,format=yuv420p[v0];"
        f"[ov]fps={fps},setsar=1,format=yuv420p[v1];"
        "[0:a]aformat=sample_rates=44100:channel_layouts=stereo[a0];"
        "[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a1];"
        "[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]"
    )
    return [ff, "-y", "-i", main, "-i", outro, "-filter_complex", fc,
            "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-threads", str(threads or 2), out]


def append_outro(main_path: str, work_dir: str, *, outro_path: str, threads: int = 2,
                 fps: int = 30) -> str:
    """把 outro_path 拼到 main_path 末尾,原地替换。失败返回原 main_path,绝不抛。"""
    marker = main_path + ".outro.done"
    if os.path.isfile(marker):
        return main_path
    try:
        ff = _ffmpeg()
        tmp = os.path.join(work_dir, os.path.splitext(os.path.basename(main_path))[0] + ".with_outro.mp4")
        m = _probe(main_path)
        o = _probe(outro_path)
        fps_eff = (m.get("fps") if m else "") or str(fps or 30)
        if m and o:
            cmd = _build_cmd(ff, main_path, outro_path, tmp, w=m["w"], h=m["h"],
                             outro_audio=o["has_audio"], outro_dur=o["dur"],
                             fps=fps_eff, threads=threads)
        else:
            cmd = _build_cmd_scale2ref(ff, main_path, outro_path, tmp, fps=fps_eff, threads=threads)
        r = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if r.returncode != 0 or not os.path.isfile(tmp):
            logger.warning("[outro] ffmpeg 拼片尾失败,保留原视频: %s",
                           (r.stderr or r.stdout or "").strip()[-500:])
            try:
                if os.path.isfile(tmp):
                    os.remove(tmp)
            except OSError:
                pass
            return main_path
        os.replace(tmp, main_path)
        try:
            open(marker, "w").close()
        except OSError:
            pass
        logger.info("[outro] 已为非会员视频拼接片尾: %s", main_path)
        return main_path
    except Exception as exc:  # noqa: BLE001
        logger.warning("[outro] 拼片尾异常,保留原视频: %s", exc)
        return main_path


def maybe_append_outro(main_path: str, work_dir: str | None = None, *,
                       threads: int = 2, fps: int = 30) -> str:
    """会员不动;非会员且能定位到 video_end.mp4 时拼片尾。返回最终视频路径(失败=原路径)。"""
    try:
        if not main_path or not os.path.isfile(main_path):
            return main_path
        from chayuan.server.license import engine as _eng
        from chayuan.server.license.config import load_license_config
        from .._helpers import _chayuan_root
        cfg = load_license_config()
        if _eng.is_paid_member(_chayuan_root(), cfg, _MEMBER_APPS):
            return main_path  # 已购买会员 -> 不加片尾
        outro = _outro_source()
        if not outro:
            logger.warning("[outro] 未定位到片尾资产 %s,跳过加片尾", OUTRO_FILENAME)
            return main_path
        wd = work_dir or os.path.dirname(main_path) or "."
        return append_outro(main_path, wd, outro_path=outro, threads=threads, fps=fps)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[outro] maybe_append_outro 异常,保留原视频: %s", exc)
        return main_path


# ── 用户片头/片尾(付费)+ 背景色补边:复用上面的缩放/补边/统一/拼接思路 ──────────
_IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif")


def resolve_intro_outro(*, params_intro, params_outro, global_intro, global_outro, paid):
    """生效片头/片尾:项目优先、缺则全局;非付费一律 (None, None)。"""
    if not paid:
        return (None, None)
    return (params_intro or global_intro or None, params_outro or global_outro or None)


def _pad_color(bg) -> str:
    if isinstance(bg, (tuple, list)) and len(bg) == 3:
        return "0x%02x%02x%02x" % (int(bg[0]), int(bg[1]), int(bg[2]))
    return "black"


def _build_concat_cmd(ff, main, extra, out, *, position, w, h, extra_is_image,
                      extra_audio, extra_dur, fps, threads, pad):
    inputs = ["-i", main]
    if extra_is_image:
        dur = extra_dur if extra_dur > 0 else 3.0
        inputs += ["-loop", "1", "-t", f"{dur:.3f}", "-i", extra]
    else:
        inputs += ["-i", extra]
    a_extra = "[1:a]"
    if extra_is_image or not extra_audio:
        dur = extra_dur if extra_dur > 0 else 3.0
        inputs += ["-f", "lavfi", "-t", f"{dur:.3f}",
                   "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]
        a_extra = "[2:a]"
    vf_extra = (f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color={pad},fps={fps},setsar=1,format=yuv420p")
    base = (
        f"[0:v]scale={w}:{h},fps={fps},setsar=1,format=yuv420p[vm];"
        f"[1:v]{vf_extra}[ve];"
        f"[0:a]aformat=sample_rates=44100:channel_layouts=stereo[am];"
        f"{a_extra}aformat=sample_rates=44100:channel_layouts=stereo[ae];"
    )
    order = "[ve][ae][vm][am]" if position == "head" else "[vm][am][ve][ae]"
    fc = base + order + "concat=n=2:v=1:a=1[v][a]"
    return [ff, "-y", *inputs, "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            "-threads", str(threads or 2), out]


def _concat_clip(main_path, extra_path, work_dir, *, position, bg=(0, 0, 0),
                 threads=2, fps=30, marker_suffix=".extra.done"):
    marker = main_path + marker_suffix
    if os.path.isfile(marker):
        return main_path
    if not (main_path and os.path.isfile(main_path)) or not (extra_path and os.path.isfile(extra_path)):
        return main_path
    try:
        ff = _ffmpeg()
        tmp = os.path.join(work_dir, os.path.splitext(os.path.basename(main_path))[0] + ".concat.mp4")
        m = _probe(main_path)
        if not m:
            logger.warning("[intro/outro] 主视频 probe 失败,跳过 %s", position)
            return main_path
        ext = os.path.splitext(extra_path)[1].lower()
        is_img = ext in _IMG_EXT
        e = None if is_img else _probe(extra_path)
        cmd = _build_concat_cmd(
            ff, main_path, extra_path, tmp, position=position, w=m["w"], h=m["h"],
            extra_is_image=is_img, extra_audio=(e["has_audio"] if e else False),
            extra_dur=(e["dur"] if e else 3.0), fps=(m.get("fps") or str(fps or 30)),
            threads=threads, pad=_pad_color(bg),
        )
        r = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if r.returncode != 0 or not os.path.isfile(tmp):
            logger.warning("[intro/outro] ffmpeg %s 失败,保留原视频: %s",
                           position, (r.stderr or r.stdout or "").strip()[-400:])
            if os.path.isfile(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass
            return main_path
        os.replace(tmp, main_path)
        try:
            open(marker, "w").close()
        except OSError:
            pass
        logger.info("[intro/outro] 已拼接 %s: %s", position, main_path)
        return main_path
    except Exception as exc:  # noqa: BLE001
        logger.warning("[intro/outro] %s 异常,保留原视频: %s", position, exc)
        return main_path


def maybe_prepend_intro(main_path, intro_path, work_dir=None, *, bg=(0, 0, 0), threads=2, fps=30):
    wd = work_dir or os.path.dirname(main_path) or "."
    return _concat_clip(main_path, intro_path, wd, position="head", bg=bg,
                        threads=threads, fps=fps, marker_suffix=".intro.done")


def append_user_outro(main_path, outro_path, work_dir=None, *, bg=(0, 0, 0), threads=2, fps=30):
    wd = work_dir or os.path.dirname(main_path) or "."
    return _concat_clip(main_path, outro_path, wd, position="tail", bg=bg,
                        threads=threads, fps=fps, marker_suffix=".useroutro.done")
