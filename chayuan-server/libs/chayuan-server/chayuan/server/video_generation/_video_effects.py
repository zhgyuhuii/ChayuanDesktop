"""moviepy 转场效果集 — fade in/out + slide in/out。

从上游 chayuan-video-generation/app/services/utils/video_effects.py
原样拷贝,无业务/接口变更。

MoviePy 自带的 SlideIn/SlideOut 在全屏素材上不稳定(转场被应用但画面看
不出变化),本文件改为显式黑底 + 位移动画,保证转场可见且行为可控。
"""

from __future__ import annotations

from moviepy import Clip, ColorClip, CompositeVideoClip, vfx


def fadein_transition(clip: Clip, t: float) -> Clip:
    return clip.with_effects([vfx.FadeIn(t)])


def fadeout_transition(clip: Clip, t: float) -> Clip:
    return clip.with_effects([vfx.FadeOut(t)])


def slidein_transition(clip: Clip, t: float, side: str) -> Clip:
    width, height = clip.size

    def position(current_time: float):
        progress = min(max(current_time / max(t, 0.001), 0), 1)
        if side == "left":
            return (-width + width * progress, 0)
        if side == "right":
            return (width - width * progress, 0)
        if side == "top":
            return (0, -height + height * progress)
        if side == "bottom":
            return (0, height - height * progress)
        return (0, 0)

    background = ColorClip(size=(width, height), color=(0, 0, 0)).with_duration(
        clip.duration
    )
    moving_clip = clip.with_position(position)
    return CompositeVideoClip(
        [background, moving_clip], size=(width, height)
    ).with_duration(clip.duration)


def slideout_transition(clip: Clip, t: float, side: str) -> Clip:
    width, height = clip.size
    transition_start = max(clip.duration - t, 0)

    def position(current_time: float):
        if current_time <= transition_start:
            return (0, 0)
        progress = min(
            max((current_time - transition_start) / max(t, 0.001), 0), 1
        )
        if side == "left":
            return (-width * progress, 0)
        if side == "right":
            return (width * progress, 0)
        if side == "top":
            return (0, -height * progress)
        if side == "bottom":
            return (0, height * progress)
        return (0, 0)

    background = ColorClip(size=(width, height), color=(0, 0, 0)).with_duration(
        clip.duration
    )
    moving_clip = clip.with_position(position)
    return CompositeVideoClip(
        [background, moving_clip], size=(width, height)
    ).with_duration(clip.duration)
