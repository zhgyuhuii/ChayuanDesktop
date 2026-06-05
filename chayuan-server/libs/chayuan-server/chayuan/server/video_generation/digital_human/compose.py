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
                        presenter_on_top: bool = False,
                        product_opacity: "float | None" = None) -> Timeline:
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
                         scale=float(product_pos["scale"]), z=1,
                         opacity=float(product_opacity if product_opacity is not None else 1.0)),
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


def render_with_products(*, presenter_path: str, products: "list", audio_path: str,
                         out_path: str, width: int, height: int, dur_ms: int) -> str:
    """presenter 全屏底 + 多个商品按各自 x/y/scale 作 PIP 叠放(按 z 排序)。
    products: [{path,x,y,scale,z}]。render_from_edl 的 PIP 轨「轨序小=上层」,故按 z
    降序建轨(z 大的先建=在上)。失败抛异常(caller 兜底)。"""
    from chayuan.server.video_generation.steps.compose import render_from_edl
    from chayuan.server.video_generation.schemas import VideoParams

    base = TimelineTrack(id="dh-base", kind="video", removable=False, clips=[
        TimelineClip(id="dh-presenter", source={"path": presenter_path},
                     track_start_ms=0, in_ms=0, out_ms=dur_ms),
    ])
    ordered = sorted(products, key=lambda p: -(p.get("z") if p.get("z") is not None else 0))
    tracks = [base]
    for i, p in enumerate(ordered):
        tracks.append(TimelineTrack(id=f"dh-prod-{i}", kind="video", removable=True, clips=[
            TimelineClip(id=f"dh-product-{i}", source={"path": p["path"]},
                         track_start_ms=0, in_ms=0, out_ms=dur_ms,
                         x=float(p["x"]), y=float(p["y"]), scale=float(p["scale"]), z=1,
                         opacity=float(p.get("opacity") if p.get("opacity") is not None else 1.0)),
        ]))
    tl = Timeline(version=1, duration_ms=dur_ms, tracks=tracks)
    params = VideoParams(video_width=width, video_height=height)
    render_from_edl(tl, audio_path, "", out_path, params, source_resolver=_resolver)
    return out_path


def _resolver(src: Dict[str, Any]) -> str:
    return (src or {}).get("path") or (src or {}).get("url") or ""


def render_with_product(*, presenter_path: str, product_path: str, template: str,
                        audio_path: str, out_path: str, width: int, height: int,
                        dur_ms: int, product_pos: "dict | None" = None,
                        presenter_pos: "dict | None" = None,
                        presenter_on_top: bool = False,
                        product_opacity: "float | None" = None) -> str:
    """合成商品讲解视频。product_pos 非空时按坐标摆商品图;presenter_on_top 时形象叠在商品之上;
    product_opacity 设商品层不透明度。失败抛异常(caller 兜底回退 presenter)。"""
    from chayuan.server.video_generation.steps.compose import render_from_edl
    from chayuan.server.video_generation.schemas import VideoParams

    tl = build_presenter_edl(presenter_path, product_path, template, dur_ms=dur_ms,
                             product_pos=product_pos, presenter_pos=presenter_pos,
                             presenter_on_top=presenter_on_top, product_opacity=product_opacity)
    params = VideoParams(video_width=width, video_height=height)
    render_from_edl(tl, audio_path, "", out_path, params, source_resolver=_resolver)
    return out_path


MATTE_GREEN = (0, 255, 0)  # 探测失败时的兜底键色


def _detect_key_color(clip):
    """从画面四角探测背景纯色(绿/白/蓝/任意纯底)→ 作为抠像键色。取四角内缩区域中位数,
    抗噪。失败回退绿色。这样「抠像」对绿幕/白幕/蓝幕等任意纯色背景都适用,无需分割模型。"""
    try:
        import numpy as np
        f = clip.get_frame(0)
        if f is None:
            return MATTE_GREEN
        f = np.asarray(f)
        h, w = f.shape[:2]
        m = max(2, int(min(h, w) * 0.04))
        corners = np.concatenate([
            f[:m, :m].reshape(-1, 3), f[:m, w - m:].reshape(-1, 3),
            f[h - m:, :m].reshape(-1, 3), f[h - m:, w - m:].reshape(-1, 3),
        ], axis=0)
        med = np.median(corners, axis=0)
        return (int(med[0]), int(med[1]), int(med[2]))
    except Exception:  # noqa: BLE001
        return MATTE_GREEN


def _matte_threshold_for(key) -> int:
    """按键色自适应抠像阈值:亮色背景(白幕)离肤色高光近,阈值要小以免抠穿脸;
    绿/蓝等远离肤色可大些。"""
    try:
        s = sum(int(c) for c in key)
        if s > 620:        # 接近白
            return 55
        if s > 430:        # 偏亮
            return 80
        return 110         # 绿/蓝等
    except Exception:  # noqa: BLE001
        return 100


def _matte_opacity(clip, op):
    if op is None:
        return clip
    try:
        o = max(0.0, min(1.0, float(op)))
        return clip.with_opacity(o) if (o < 0.999 and hasattr(clip, "with_opacity")) else clip
    except Exception:  # noqa: BLE001
        return clip


def render_scene_layered(*, presenter_path: str, avatar: dict, products: "list",
                         audio_path: str, out_path: str, width: int, height: int,
                         dur_ms: int, matte: bool = False, green=None,
                         threshold: int = 0, stiffness: int = 5) -> str:
    """统一图层合成:presenter(matte=True 时绿键抠像)+ 各商品按 canvas 的 x/y/scale/z/opacity
    在黑底上**按 z 叠放**。形象不再被强制当全屏底——形象与商品按各自 z 决定上下层
    (修复:全屏置底视频 + 小形象在上 等场景)。直接走 moviepy,自包含,失败抛异常由 caller 兜底。
    avatar: {x,y,scale,z,opacity};products: [{path,x,y,scale,z,opacity}]。"""
    from moviepy import (
        AudioFileClip, ColorClip, CompositeVideoClip, ImageClip, VideoFileClip, vfx,
    )

    dur_s = max(0.1, dur_ms / 1000.0)
    opened = []
    entries = []  # (z, fi, clip)

    # presenter:matte 时绿键抠像;按形象坐标/大小/透明度摆放(作为一个图层,非强制底)。
    pv = VideoFileClip(presenter_path, audio=False)
    if matte:
        # 抠像:自动探测背景纯色(绿/白/蓝/任意纯底)→ 键掉,仅留形象。绿幕不再是必须。
        key = green if green is not None else _detect_key_color(pv)
        thr = threshold if threshold and threshold > 0 else _matte_threshold_for(key)
        pv = pv.with_effects([
            vfx.MaskColor(color=list(key), threshold=thr, stiffness=stiffness),
        ])
    aw = max(1, int(width * float(avatar.get("scale") or 1.0)))
    pv = pv.resized(width=aw).with_position(
        (int(float(avatar.get("x") or 0.0) * width), int(float(avatar.get("y") or 0.0) * height)))
    pv = _matte_opacity(pv, avatar.get("opacity"))
    opened.append(pv)
    entries.append((avatar.get("z") if avatar.get("z") is not None else 0, -1, pv))

    for i, p in enumerate(products or []):
        path = p["path"]
        if os.path.splitext(path)[1].lower() in _VIDEO_EXT:
            c = VideoFileClip(path, audio=False)
        else:
            c = ImageClip(path).with_duration(dur_s)
        pw = max(1, int(width * float(p.get("scale") or 0.32)))
        c = c.resized(width=pw).with_position(
            (int(float(p.get("x") or 0.66) * width), int(float(p.get("y") or 0.60) * height)))
        c = _matte_opacity(c, p.get("opacity"))
        opened.append(c)
        entries.append((p.get("z") if p.get("z") is not None else (i + 1), i, c))

    entries.sort(key=lambda e: (e[0], e[1]))  # z 升序 → 列表越靠后越上层
    bg = ColorClip(size=(width, height), color=(0, 0, 0)).with_duration(dur_s)
    audio = AudioFileClip(audio_path)
    comp = CompositeVideoClip([bg, *[c for _, _, c in entries]], size=(width, height)).with_duration(dur_s)
    comp = comp.with_audio(audio)
    try:
        comp.write_videofile(out_path, codec="libx264", audio_codec="aac",
                             fps=25, threads=2, logger=None)
    finally:
        for c in (audio, bg, comp, *opened):
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass
    return out_path


def render_with_product_matte(**kw) -> str:
    """绿幕抠像 = 图层合成 + presenter 绿键。薄包装,保留旧名供 jobs/测试引用。"""
    return render_scene_layered(matte=True, **kw)
