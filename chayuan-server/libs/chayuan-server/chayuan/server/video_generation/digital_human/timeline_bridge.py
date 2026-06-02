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


def build_timeline_for_mode(mode, *, result_material_id, result_path, segments,
                            slots, total_ms, script):
    """模式相关多轨 Timeline:
    - single / 无 segments(旧任务 / seg 缺) -> 退回单片(成片视频轨 + 脚本字幕轨)。
    - coframe -> 主轨(空)+ 每角色 PIP 轨(用 slot.x/y/scale 归一定位)+ 合并字幕轨。
    - sequential -> 主轨(空)+ 每角色全屏轨(x/y=0,scale=1)+ 合并字幕轨。
    各段按 segments 顺序累计偏移排布;合并字幕 cue 带角色昵称前缀,按时序拼。
    纯函数,无 IO(material_id 由 caller 注册好传入;时长由 caller 探好)。

    slot 优先用 slot.x/y/scale(归一 0-1)做 PIP 定位;slots 无位置时退默认(全部 0,0,1)。
    不调 compose_multi._resolve_positions(它返回像素,不适合时间轴 clip 的归一 x/y)。
    """
    from chayuan.server.video_generation.schemas import (
        Timeline, TimelineTrack, TimelineClip, SrtCue,
    )
    total_ms = max(0, int(total_ms or 0))

    # 无 segments(single / 旧任务 / seg 缺) -> 退回单片
    if mode == "single" or not segments:
        tracks = [
            TimelineTrack(id="dh-video", kind="video", removable=False, label="数字人", clips=[
                TimelineClip(id="dh-video-0",
                             source={"material_id": result_material_id or "", "path": result_path or ""},
                             track_start_ms=0, in_ms=0, out_ms=total_ms),
            ]),
            TimelineTrack(id="dh-subtitle", kind="subtitle", removable=True, label="字幕",
                          cues=build_cues_from_script(script, total_ms)),
        ]
        return Timeline(version=1, duration_ms=total_ms, tracks=tracks)

    slots = list(slots or [])
    n = len(slots)
    tracks = [TimelineTrack(id="dh-main", kind="video", removable=False,
                            label="主轨(背景)", clips=[])]

    cum = 0
    role_clips = {}   # role_index -> [TimelineClip]
    cues = []
    for k, seg in enumerate(segments):
        ri = int(seg.get("role_index", 0) or 0)
        dur = int(seg.get("duration_ms", 0) or 0)
        clip_kwargs = dict(
            id="dh-seg-%d" % k,
            source={"material_id": seg.get("material_id", "") or "",
                    "path": seg.get("path", "") or ""},
            track_start_ms=cum, in_ms=0, out_ms=dur,
        )
        if mode == "coframe":
            sl = slots[ri] if 0 <= ri < n else None
            x = float(getattr(sl, "x", 0.0) or 0.0)
            y = float(getattr(sl, "y", 0.0) or 0.0)
            sc = float(getattr(sl, "scale", 1.0) or 1.0)
            clip_kwargs.update(x=x, y=y, scale=sc, z=ri + 1)
        else:  # sequential 全屏
            clip_kwargs.update(x=0.0, y=0.0, scale=1.0, z=ri + 1)
        role_clips.setdefault(ri, []).append(TimelineClip(**clip_kwargs))
        nm = (getattr(slots[ri], "name", "") if 0 <= ri < n else "") or ""
        cues.append(SrtCue(index=k + 1, start_ms=cum, end_ms=cum + dur,
                           text=(("%s: " % nm) if nm else "") + (seg.get("text") or "")))
        cum += dur

    for ri in range(n):
        nm = (getattr(slots[ri], "name", "") or "") or ("角色%d" % (ri + 1))
        tracks.append(TimelineTrack(id="dh-role-%d" % ri, kind="video", removable=True,
                                    label=nm, clips=role_clips.get(ri, [])))
    tracks.append(TimelineTrack(id="dh-subtitle", kind="subtitle", removable=True,
                                label="字幕", cues=cues))
    return Timeline(version=1, duration_ms=total_ms or cum, tracks=tracks)
