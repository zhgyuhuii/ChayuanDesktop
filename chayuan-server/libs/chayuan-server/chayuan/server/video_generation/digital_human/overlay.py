"""成片文字叠加:昵称标签 + 字幕。moviepy TextClip;字体取 bundled。
所有函数 fail-safe:渲染失败返回原视频路径,绝不让出片失败。"""
from __future__ import annotations
import logging
from typing import List, Optional, Tuple

logger = logging.getLogger("chayuan.dh.overlay")


def _bundled_fonts_dir():
    try:
        from chayuan.server.video_generation import binaries
        return binaries.get_fonts_dir()
    except Exception:  # noqa: BLE001
        return None


def _data_fonts_dir():
    try:
        from chayuan.server.video_generation import _helpers
        return _helpers.font_dir()
    except Exception:  # noqa: BLE001
        return None


def _resolve_font_path(font_name: Optional[str] = None) -> Optional[str]:
    """与主合成 steps/compose 对齐:优先数据目录 <root>/video_generation/fonts,
    再回退 vendor/bundled_fonts。font_name 可为绝对路径 / 文件名 / 空(默认 STHeiti)。
    之前 overlay 只查 bundled,dev/未打包时 bundled 为空 → 返 None →
    TextClip(font=None) 触发 pillow "Invalid font None" → 字幕叠加失败。"""
    import os
    if font_name and os.path.isabs(font_name) and os.path.isfile(font_name):
        return font_name
    name = font_name or "STHeitiMedium.ttc"
    dirs = [d for d in (_data_fonts_dir(), _bundled_fonts_dir()) if d]
    # 1) 指定名(或默认 STHeiti)优先
    for base in dirs:
        p = os.path.join(base, name)
        if os.path.isfile(p):
            return p
    # 2) 目录里任意可用字体兜底
    for base in dirs:
        try:
            for f in sorted(os.listdir(base)):
                if f.lower().endswith((".ttf", ".otf", ".ttc")):
                    return os.path.join(base, f)
        except Exception:  # noqa: BLE001
            continue
    # 3) 系统自带 CJK 字体兜底(未打包字体 / 数据目录为空时,避免 font=None 致字幕失败)
    for p in (
        "C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc", "C:/Windows/Fonts/Deng.ttf", "C:/Windows/Fonts/arial.ttf",
        "/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc", "/Library/Fonts/Arial Unicode.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if os.path.isfile(p):
            return p
    # 4) 扫系统字体目录,取第一个可用字体
    for sysdir in ("C:/Windows/Fonts", "/System/Library/Fonts", "/Library/Fonts",
                   "/usr/share/fonts", os.path.expanduser("~/.fonts")):
        try:
            for root, _dirs, fs in os.walk(sysdir):
                for f in sorted(fs):
                    if f.lower().endswith((".ttc", ".ttf", ".otf")):
                        return os.path.join(root, f)
        except Exception:  # noqa: BLE001
            continue
    return None


def _font() -> Optional[str]:
    return _resolve_font_path()


def _font_for(style):
    return _resolve_font_path((style or {}).get("font_name"))


def _ffmpeg_overlays(video_path, out_path, labels, cues, width, height, style) -> bool:
    """ffmpeg 单趟烧字幕(ass)+ 昵称(同一 ass 的 \\pos 全程事件)。-c:v 重编码一次、-c:a copy。
    复用 ffcompose 同款 subtitles=ass 路径(已验证可烧 CJK)。成功返 True;抛异常由调用方回退。"""
    import os
    import subprocess
    import imageio_ffmpeg
    from chayuan.server.video_generation.digital_human import subtitle_ass as _sa
    font = _font_for(style) if style else _font()
    cue_dicts = [{"start_ms": getattr(c, "start_ms", 0), "end_ms": getattr(c, "end_ms", 0),
                  "text": getattr(c, "text", "") or ""} for c in (cues or []) if getattr(c, "text", "")]
    ass_path = os.path.join(os.path.dirname(out_path) or ".", "overlay.ass")
    _sa.build_ass(cue_dicts, style or {}, ass_path, width=width, height=height, font_path=font)
    # 昵称:作为全程定位事件追加进同一 ass(libass 处理 CJK + 定位,免 drawtext 的 Windows 字体/转义坑)。
    lab_lines = []
    for text, xn, yn in (labels or []):
        if not text:
            continue
        X = int(max(0.0, min(1.0, float(xn))) * width)
        Y = int(max(0.0, min(0.95, float(yn))) * height)
        t = str(text).replace("{", "(").replace("}", ")").replace("\n", " ")
        lab_lines.append(f"Dialogue: 0,0:00:00.00,9:59:59.99,Default,,0,0,0,,{{\\an7\\pos({X},{Y})}}{t}")
    if lab_lines:
        with open(ass_path, "a", encoding="utf-8") as f:
            f.write("\n" + "\n".join(lab_lines) + "\n")
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    ass_esc = ass_path.replace("\\", "/").replace(":", "\\:")
    cmd = [ff, "-y", "-loglevel", "error", "-i", video_path,
           "-vf", f"subtitles='{ass_esc}'",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
           "-c:a", "copy", out_path]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    return os.path.isfile(out_path)


def add_overlays(video_path: str, out_path: str, *, labels: Optional[List[Tuple[str, float, float]]] = None,
                 cues=None, width: int = 720, height: int = 1280,
                 style: Optional[dict] = None) -> str:
    """labels: [(text, x_norm, y_norm)] 昵称标签;cues: List[SrtCue] 字幕(底部居中)。
    任一失败 → 返回原 video_path(不阻断出片)。成功 → 写 out_path 并返回它。
    优先 ffmpeg subtitles=ass 烧字幕+昵称(单趟,远快于 moviepy 逐帧合成);失败回退 moviepy。"""
    if not labels and not cues:
        return video_path
    # ── 快路径:ffmpeg(字幕走 ass,昵称塞进同一 ass 的 \pos 事件,-c:a copy 不重编码音频)
    try:
        if _ffmpeg_overlays(video_path, out_path, labels, cues, width, height, style):
            return out_path
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] ffmpeg overlay 失败,回退 moviepy: %r", e)
    try:
        from moviepy import VideoFileClip, TextClip, CompositeVideoClip
        font = _font()
        base = VideoFileClip(video_path)
        layers = [base]
        for text, xn, yn in (labels or []):
            if not text:
                continue
            tc = TextClip(text=text, font=font, font_size=max(18, int(height * 0.03)),
                          color="white", stroke_color="black", stroke_width=2)
            tc = tc.with_position((float(xn), float(yn)), relative=True).with_duration(base.duration)
            layers.append(tc)
        cue_font = _font_for(style) if style else font
        cue_size = int((style or {}).get("font_size") or max(20, int(height * 0.035)))
        cue_color = (style or {}).get("text_fore_color") or "white"
        cue_stroke = (style or {}).get("stroke_color") or "black"
        # PIL/moviepy TextClip 的 stroke_width 必须是 int(传 float 触发
        # "'float' object cannot be interpreted as an integer" → 字幕叠加失败)。
        cue_sw = int(round(float(style.get("stroke_width") if style and style.get("stroke_width") is not None else 2)))
        _pos = (style or {}).get("subtitle_position") or "bottom"
        cue_y = {"top": 0.05, "center": 0.45, "bottom": 0.86}.get(_pos, 0.86)
        for c in (cues or []):
            txt = getattr(c, "text", "") or ""
            if not txt:
                continue
            tc = TextClip(text=txt, font=cue_font, font_size=cue_size,
                          color=cue_color, stroke_color=cue_stroke, stroke_width=cue_sw)
            start = getattr(c, "start_ms", 0) / 1000.0
            end = getattr(c, "end_ms", 0) / 1000.0
            tc = tc.with_position(("center", cue_y), relative=True).with_start(start).with_end(max(start + 0.1, end))
            layers.append(tc)
        comp = CompositeVideoClip(layers, size=(width, height)).with_duration(base.duration)
        comp.write_videofile(out_path, codec="libx264", audio_codec="aac", fps=25, threads=2, logger=None)
        for c in (comp, base):
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass
        return out_path
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] 文字叠加失败(忽略,用无字幕成片): %r", e)
        return video_path
