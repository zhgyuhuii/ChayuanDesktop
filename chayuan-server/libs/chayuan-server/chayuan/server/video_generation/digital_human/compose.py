"""数字人商品讲解合成:presenter 视频 + 商品图 → 内部 EDL → render_from_edl。

版式(presenter 作 PIP 叠在商品图全屏底层上;x/y=相对左上归一,scale=占底宽比例):
  corner — presenter 右下小窗,商品图为主体
  bg     — presenter 居中较大,商品图作背景
  side   — presenter 左侧,商品图铺底
真正的左右等分需画布预处理,本期用「商品全屏底 + presenter 定位」近似(零新渲染代码)。
"""
from __future__ import annotations
import logging
from typing import Any, Dict

from chayuan.server.video_generation.schemas import Timeline, TimelineTrack, TimelineClip

logger = logging.getLogger("chayuan.dh.compose")

TEMPLATES: Dict[str, Dict[str, float]] = {
    "corner": {"x": 0.66, "y": 0.60, "scale": 0.32},
    "bg":     {"x": 0.225, "y": 0.18, "scale": 0.55},
    "side":   {"x": 0.03, "y": 0.26, "scale": 0.46},
}


def build_presenter_edl(presenter_path: str, product_path: str, template: str, *, dur_ms: int) -> Timeline:
    """商品图=主视频轨(全屏底层);presenter=第二条 video 轨(PIP,按版式定位)。"""
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
                        dur_ms: int) -> str:
    """合成商品讲解视频。失败抛异常(caller 兜底回退 presenter)。"""
    from chayuan.server.video_generation.steps.compose import render_from_edl
    from chayuan.server.video_generation.schemas import VideoParams

    tl = build_presenter_edl(presenter_path, product_path, template, dur_ms=dur_ms)
    params = VideoParams(video_width=width, video_height=height)
    render_from_edl(tl, audio_path, "", out_path, params, source_resolver=_resolver)
    return out_path
