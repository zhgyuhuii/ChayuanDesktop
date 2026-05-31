"""数字人 → VG 时间轴桥:把数字人成片构建成带「视频轨 + 字幕轨」的 Timeline EDL,
供 VG 时间轴编辑器加载(改字幕 → VG 稳健渲染重出)。

字幕 cue 由脚本按标点切句、按字数比例分配时长得到(比 ASR 单 cue 可靠,且我们有脚本)。
纯函数,无 IO 副作用(时长由 caller 探好传入),便于单测。
"""
from __future__ import annotations
from typing import List


def build_cues_from_script(script: str, total_ms: int):
    """脚本 → 字幕 cue 列表(按标点切句 + 字数比例分时长)。空脚本/时长→[]。"""
    from chayuan.server.video_generation.steps.subtitle import _split_string_by_punctuations
    from chayuan.server.video_generation.schemas import SrtCue
    parts = [s.strip() for s in _split_string_by_punctuations(script or "") if s.strip()]
    total_ms = max(0, int(total_ms or 0))
    if not parts or total_ms <= 0:
        return []
    weights = [max(1, len(p)) for p in parts]
    wsum = sum(weights)
    cues = []
    acc = 0
    for i, (p, w) in enumerate(zip(parts, weights)):
        start = acc
        end = total_ms if i == len(parts) - 1 else min(total_ms, start + int(total_ms * w / wsum))
        if end <= start:
            end = min(total_ms, start + 1)
        acc = end
        cues.append(SrtCue(index=i + 1, start_ms=start, end_ms=end, text=p))
    return cues


def build_timeline(video_path: str, cues, total_ms: int):
    """视频轨(数字人成片铺满)+ 字幕轨(cues)→ Timeline EDL。"""
    from chayuan.server.video_generation.schemas import Timeline, TimelineTrack, TimelineClip
    dur = max(0, int(total_ms or 0))
    video = TimelineTrack(id="dh-video", kind="video", removable=False, label="数字人", clips=[
        TimelineClip(id="dh-clip", source={"path": video_path},
                     track_start_ms=0, in_ms=0, out_ms=dur),
    ])
    subs = TimelineTrack(id="dh-subtitle", kind="subtitle", removable=True,
                         label="字幕", cues=list(cues or []))
    return Timeline(version=1, duration_ms=dur, tracks=[video, subs])
