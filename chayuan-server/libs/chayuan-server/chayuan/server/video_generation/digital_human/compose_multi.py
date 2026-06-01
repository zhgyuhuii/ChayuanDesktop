"""多形象合成:同框(coframe)与分段(sequential)。

各形象先由 jobs 各自生成单人说话片段(已自带音频,引擎 mux),这里只做视频合成。
直接走 moviepy(与 compose.render_with_product_matte 同模式,自包含),失败抛异常
由 caller 兜底回退单形象。

- sequential:concatenate_videoclips 顺序拼接,音频随之顺序拼接(各形象轮流出场)。
- coframe:CompositeVideoClip 把各片段按 layout 摆同一画面、同时播放,moviepy 自动
  把各片段音轨叠加(注意:各形象台词会同时出声;若要轮流需 idle 帧,本期不做)。
"""
from __future__ import annotations
import logging
from typing import List, Tuple

logger = logging.getLogger("chayuan.dh.compose_multi")


def _coframe_positions(layout: str, n: int, width: int, height: int) -> List[Tuple[int, int, int]]:
    """返回每个片段的 (x_px, y_px, target_width_px)。layout:
      side       并排等分(默认,最稳):横向均分 n 份,各占 width/n。
      pip        画中画:第 0 个全屏底,其余缩小堆右下。
      main_minor 主+角:第 0 个占左 ~0.62 宽,其余小图堆右侧。
    """
    n = max(1, n)
    if layout == "pip":
        out = [(0, 0, width)]
        small = max(1, int(width * 0.26))
        for i in range(1, n):
            out.append((width - small - 8, height - (small + 8) * i, small))
        return out
    if layout == "main_minor":
        main_w = int(width * 0.62)
        out = [(0, int((height - main_w * height // max(1, width)) / 2), main_w)]
        small = max(1, int(width * 0.34))
        gap = max(1, (height - small * (n - 1)) // max(1, n))
        for i in range(1, n):
            out.append((width - small - 8, gap + (small + gap) * (i - 1), small))
        return out
    # side(默认):横向均分
    col = max(1, width // n)
    return [(i * col, 0, col) for i in range(n)]


def _resolve_positions(positions, layout, n, width, height):
    """每角色位置 -> 像素 (x_px, y_px, target_w_px)。
    positions: 归一 (x,y,scale) 列表(0-1);非空且数量够 -> 自由位置,否则回退 _coframe_positions(layout)。"""
    if positions and len(positions) >= n:
        out = []
        for x, y, scale in positions[:n]:
            tw = max(1, int(float(scale) * width))
            out.append((int(float(x) * width), int(float(y) * height), tw))
        return out
    return _coframe_positions(layout, n, width, height)


def render_sequential(clip_paths: List[str], *, out_path: str, width: int, height: int) -> str:
    """各片段顺序拼接(各形象轮流)。片段自带音频。失败抛异常。"""
    from moviepy import VideoFileClip, concatenate_videoclips
    if not clip_paths:
        raise RuntimeError("没有可拼接的片段")
    clips = []
    try:
        for p in clip_paths:
            clips.append(VideoFileClip(p).resized(new_size=(width, height)))
        final = concatenate_videoclips(clips, method="compose")
        final.write_videofile(out_path, codec="libx264", audio_codec="aac",
                              fps=25, threads=2, logger=None)
        try:
            final.close()
        except Exception:  # noqa: BLE001
            pass
        return out_path
    finally:
        for c in clips:
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass


def render_coframe(clip_paths: List[str], *, layout: str = "side", out_path: str,
                   width: int, height: int, positions=None) -> str:
    """各片段按 layout 摆同一画面、同时播放(音轨叠加)。失败抛异常。"""
    from moviepy import VideoFileClip, CompositeVideoClip
    if not clip_paths:
        raise RuntimeError("没有可合成的片段")
    raw = []
    placed = []
    try:
        for p in clip_paths:
            raw.append(VideoFileClip(p))
        pos = _resolve_positions(positions, layout, len(raw), width, height)
        dur = max((c.duration for c in raw), default=0.1)
        for c, (x, y, tw) in zip(raw, pos):
            placed.append(c.resized(width=tw).with_position((x, y)))
        comp = CompositeVideoClip(placed, size=(width, height)).with_duration(dur)
        comp.write_videofile(out_path, codec="libx264", audio_codec="aac",
                            fps=25, threads=2, logger=None)
        try:
            comp.close()
        except Exception:  # noqa: BLE001
            pass
        return out_path
    finally:
        for c in raw:
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass
