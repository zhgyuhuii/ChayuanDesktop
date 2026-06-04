"""生成 ASS 字幕(给 ffmpeg subtitles 滤镜烧入)。取代 moviepy TextClip——更快且根治 font None。

颜色:#RRGGBB → ASS 的 &HAABBGGRR&(这里 AA=00 不透明)。
位置:bottom→Alignment 2;top→8;center→5。字体名用 font_path 的文件名(配合 subtitles fontsdir)。
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional


def _hex_to_ass(color: str, default: str = "&H00FFFFFF") -> str:
    try:
        c = (color or "").lstrip("#")
        if len(c) != 6:
            return default
        r, g, b = c[0:2], c[2:4], c[4:6]
        return f"&H00{b}{g}{r}".upper()
    except Exception:  # noqa: BLE001
        return default


def _ts(ms: int) -> str:
    ms = max(0, int(ms))
    h = ms // 3600000
    m = (ms % 3600000) // 60000
    s = (ms % 60000) // 1000
    cs = (ms % 1000) // 10
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def build_ass(cues: List[Dict[str, Any]], style: Dict[str, Any], out_path: str, *,
              width: int, height: int, font_path: Optional[str] = None) -> str:
    align = {"bottom": 2, "top": 8, "center": 5}.get(
        str((style or {}).get("subtitle_position") or "bottom"), 2)
    size = int((style or {}).get("font_size") or max(20, int(height * 0.035)))
    fore = _hex_to_ass(str((style or {}).get("text_fore_color") or "#FFFFFF"))
    outline = _hex_to_ass(str((style or {}).get("stroke_color") or "#000000"), "&H00000000")
    ow = float((style or {}).get("stroke_width") or 1.5)
    fontname = "Sans"
    if font_path:
        fontname = os.path.splitext(os.path.basename(font_path))[0]
    head = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {width}\nPlayResY: {height}\n"
        "WrapStyle: 2\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, "
        "Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{fontname},{size},{fore},{outline},&H00000000,0,0,1,{ow},0,{align},20,20,40,1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    lines = []
    for c in (cues or []):
        txt = str(c.get("text") or "").replace("\n", "\\N").replace("{", "(").replace("}", ")")
        lines.append(f"Dialogue: 0,{_ts(c.get('start_ms', 0))},{_ts(c.get('end_ms', 0))},Default,,0,0,0,,{txt}")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(head + "\n".join(lines) + "\n")
    return str(out_path)
