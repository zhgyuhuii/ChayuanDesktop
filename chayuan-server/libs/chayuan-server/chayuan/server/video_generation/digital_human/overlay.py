"""成片文字叠加:昵称标签 + 字幕。moviepy TextClip;字体取 bundled。
所有函数 fail-safe:渲染失败返回原视频路径,绝不让出片失败。"""
from __future__ import annotations
import logging
from typing import List, Optional, Tuple

logger = logging.getLogger("chayuan.dh.overlay")


def _font() -> Optional[str]:
    try:
        from chayuan.server.video_generation import binaries
        import os
        d = binaries.get_fonts_dir()
        for f in sorted(os.listdir(d)):
            if f.lower().endswith((".ttf", ".otf", ".ttc")):
                return os.path.join(d, f)
    except Exception:  # noqa: BLE001
        pass
    return None


def add_overlays(video_path: str, out_path: str, *, labels: Optional[List[Tuple[str, float, float]]] = None,
                 cues=None, width: int = 720, height: int = 1280) -> str:
    """labels: [(text, x_norm, y_norm)] 昵称标签;cues: List[SrtCue] 字幕(底部居中)。
    任一失败 → 返回原 video_path(不阻断出片)。成功 → 写 out_path 并返回它。"""
    if not labels and not cues:
        return video_path
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
        for c in (cues or []):
            txt = getattr(c, "text", "") or ""
            if not txt:
                continue
            tc = TextClip(text=txt, font=font, font_size=max(20, int(height * 0.035)),
                          color="white", stroke_color="black", stroke_width=2)
            start = getattr(c, "start_ms", 0) / 1000.0
            end = getattr(c, "end_ms", 0) / 1000.0
            tc = tc.with_position(("center", 0.86), relative=True).with_start(start).with_end(max(start + 0.1, end))
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
