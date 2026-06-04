"""数字人商品讲解合成:presenter 视频 + 商品图 → 内部 EDL → render_from_edl。

版式(presenter 作 PIP 叠在商品图全屏底层上;x/y=相对左上归一,scale=占底宽比例):
  corner — presenter 右下小窗,商品图为主体
  bg     — presenter 居中较大,商品图作背景
  side   — presenter 左侧,商品图铺底
真正的左右等分需画布预处理,本期用「商品全屏底 + presenter 定位」近似(零新渲染代码)。
"""
from __future__ import annotations
import logging
import os
from typing import Any, Dict

_VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv", ".avi"}

from chayuan.server.video_generation.schemas import Timeline, TimelineTrack, TimelineClip

logger = logging.getLogger("chayuan.dh.compose")

TEMPLATES: Dict[str, Dict[str, float]] = {
    "corner": {"x": 0.66, "y": 0.60, "scale": 0.32},
    "bg":     {"x": 0.225, "y": 0.18, "scale": 0.55},
    "side":   {"x": 0.03, "y": 0.26, "scale": 0.46},
}


def build_presenter_edl(presenter_path: str, product_path: str, template: str, *, dur_ms: int,
                        product_pos: "dict | None" = None,
                        presenter_pos: "dict | None" = None,
                        presenter_on_top: bool = False) -> Timeline:
    """合成 EDL。
    product_pos 非空(工作台画布拖拽的商品图坐标)→ 默认 presenter 全屏底 + 商品图按坐标 PIP。
      presenter_on_top=True(工作台把形象图层调到商品之上)→ 改为商品图全屏底 + presenter 按
      presenter_pos 坐标 PIP(render_from_edl 主轨=全屏底,故谁在底=谁当主轨)。
    product_pos 为空 → 旧行为:商品图全屏底 + presenter 按 template PIP。"""
    if product_pos is not None:
        if presenter_on_top and presenter_pos is not None:
            base = TimelineTrack(id="dh-base", kind="video", removable=False, clips=[
                TimelineClip(id="dh-product", source={"path": product_path},
                             track_start_ms=0, in_ms=0, out_ms=dur_ms),
            ])
            pip = TimelineTrack(id="dh-pip", kind="video", removable=True, clips=[
                TimelineClip(id="dh-presenter", source={"path": presenter_path},
                             track_start_ms=0, in_ms=0, out_ms=dur_ms,
                             x=float(presenter_pos["x"]), y=float(presenter_pos["y"]),
                             scale=float(presenter_pos["scale"]), z=1),
            ])
            return Timeline(version=1, duration_ms=dur_ms, tracks=[base, pip])
        base = TimelineTrack(id="dh-base", kind="video", removable=False, clips=[
            TimelineClip(id="dh-presenter", source={"path": presenter_path},
                         track_start_ms=0, in_ms=0, out_ms=dur_ms),
        ])
        pip = TimelineTrack(id="dh-prod", kind="video", removable=True, clips=[
            TimelineClip(id="dh-product", source={"path": product_path},
                         track_start_ms=0, in_ms=0, out_ms=dur_ms,
                         x=float(product_pos["x"]), y=float(product_pos["y"]),
                         scale=float(product_pos["scale"]), z=1),
        ])
        return Timeline(version=1, duration_ms=dur_ms, tracks=[base, pip])
    tpl = TEMPLATES.get(template) or TEMPLATES["corner"]
    base = TimelineTrack(id="dh-base", kind="video", removable=False, clips=[
        TimelineClip(id="dh-prod", source={"path": product_path},
                     track_start_ms=0, in_ms=0, out_ms=dur_ms),
    ])
    pip = TimelineTrack(id="dh-pip", kind="video", removable=True, clips=[
        TimelineClip(id="dh-presenter", source={"path": presenter_path},
                     track_start_ms=0, in_ms=0, out_ms=dur_ms,
                     x=float(tpl["x"]), y=float(tpl["y"]), scale=float(tpl["scale"]), z=1),
    ])
    return Timeline(version=1, duration_ms=dur_ms, tracks=[base, pip])


def _resolver(src: Dict[str, Any]) -> str:
    return (src or {}).get("path") or (src or {}).get("url") or ""


def render_with_product(*, presenter_path: str, product_path: str, template: str,
                        audio_path: str, out_path: str, width: int, height: int,
                        dur_ms: int, product_pos: "dict | None" = None,
                        presenter_pos: "dict | None" = None,
                        presenter_on_top: bool = False) -> str:
    """合成商品讲解视频。product_pos 非空时按坐标摆商品图;presenter_on_top 时形象叠在商品之上。
    失败抛异常(caller 兜底回退 presenter)。"""
    from chayuan.server.video_generation.steps.compose import render_from_edl
    from chayuan.server.video_generation.schemas import VideoParams

    tl = build_presenter_edl(presenter_path, product_path, template, dur_ms=dur_ms,
                             product_pos=product_pos, presenter_pos=presenter_pos,
                             presenter_on_top=presenter_on_top)
    params = VideoParams(video_width=width, video_height=height)
    render_from_edl(tl, audio_path, "", out_path, params, source_resolver=_resolver)
    return out_path


MATTE_GREEN = (0, 255, 0)  # 标准绿幕色;非绿底素材抠像效果有限(UI 注明)


def render_with_product_matte(*, presenter_path: str, product_path: str, template: str,
                              audio_path: str, out_path: str, width: int, height: int,
                              dur_ms: int, green=MATTE_GREEN, threshold: int = 100,
                              stiffness: int = 5) -> str:
    """绿幕抠像合成:presenter 抠掉绿背景 → 按版式叠在商品图全屏底上。
    直接走 moviepy(不经 render_from_edl),自包含。失败抛异常由 caller 兜底。
    """
    from moviepy import (
        AudioFileClip, CompositeVideoClip, ImageClip, VideoFileClip, vfx,
    )

    tpl = TEMPLATES.get(template) or TEMPLATES["corner"]
    dur_s = max(0.1, dur_ms / 1000.0)

    # 商品可能是图也可能是视频:视频走 VideoFileClip,否则 ImageClip(否则
    # ImageClip 读视频会报 "Format FFMPEG cannot read in single_image mode")。
    if os.path.splitext(product_path)[1].lower() in _VIDEO_EXT:
        base = VideoFileClip(product_path, audio=False).resized(new_size=(width, height))
    else:
        base = ImageClip(product_path).resized(new_size=(width, height)).with_duration(dur_s)
    presenter = VideoFileClip(presenter_path, audio=False)
    presenter = presenter.with_effects([
        vfx.MaskColor(color=list(green), threshold=threshold, stiffness=stiffness),
    ])
    pip_w = max(1, int(width * float(tpl["scale"])))
    presenter = presenter.resized(width=pip_w).with_position(
        (float(tpl["x"]), float(tpl["y"])), relative=True,
    )
    audio = AudioFileClip(audio_path)
    comp = CompositeVideoClip([base, presenter], size=(width, height)).with_duration(dur_s)
    comp = comp.with_audio(audio)
    try:
        comp.write_videofile(out_path, codec="libx264", audio_codec="aac",
                             fps=25, threads=2, logger=None)
    finally:
        for c in (audio, presenter, base, comp):
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass
    return out_path
