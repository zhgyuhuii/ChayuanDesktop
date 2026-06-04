"""场景描述 → 一条 ffmpeg filter_complex → 单次 ffmpeg(自适应 NVENC/libx264)。

Scene = {width,height,duration_ms,audio_path, layers:[Layer], subtitle:{ass_path}|None}
Layer = {src, kind:"image"|"video", x,y,scale, z, opacity, loop, windows:[{start_ms,end_ms}]|None}

坐标语义与工作台预览/CanvasStage 严格一致:overlay 左上角=(x*W,y*H),宽=scale*W,高按源比例。
build_filter 是纯函数(可单测);render 组装命令并执行,失败抛异常由 caller 兜底回 moviepy。
"""
from __future__ import annotations

import subprocess
from typing import Any, Dict, List, Tuple


def build_filter(scene: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]], str, str]:
    """返回 (filter_complex, inputs, video_out_label, audio_label)。
    inputs:按出现顺序的视频/图片层输入([{path,loop}]);音频由 caller 作最后一个 -i。"""
    W, H = int(scene["width"]), int(scene["height"])
    dur = max(0.1, int(scene["duration_ms"]) / 1000.0)
    layers = sorted(scene.get("layers") or [],
                    key=lambda l: (l.get("z") if l.get("z") is not None else 0))
    inputs: List[Dict[str, Any]] = []
    parts: List[str] = [f"color=c=black:s={W}x{H}:d={dur}[bg]"]
    cur = "bg"
    for idx, ly in enumerate(layers):
        in_idx = len(inputs)
        # 时间窗视频段:把输入延迟到其出场时刻(itsoffset),使 enable 窗口内从该段 t=0 播。
        wins0 = ly.get("windows")
        offset_ms = int(wins0[0].get("start_ms", 0)) if (wins0 and ly.get("kind") == "video") else 0
        inputs.append({"path": ly["src"],
                       "loop": bool(ly.get("loop")) and (ly.get("kind") == "video"),
                       "is_image": ly.get("kind") != "video",
                       "offset_ms": offset_ms})
        w = max(1, int(round(float(ly.get("scale") or 1.0) * W)))
        x = int(round(float(ly.get("x") or 0.0) * W))
        y = int(round(float(ly.get("y") or 0.0) * H))
        chain = f"[{in_idx}:v]scale={w}:-2"
        op = ly.get("opacity")
        if op is not None and float(op) < 0.999:
            chain += f",format=yuva420p,colorchannelmixer=aa={float(op)}"
        out_lbl = f"l{idx}"
        parts.append(chain + f"[{out_lbl}]")
        enable = ""
        wins = ly.get("windows")
        if wins:
            conds = "+".join(
                "between(t,%s,%s)" % (wnd["start_ms"] / 1000.0, wnd["end_ms"] / 1000.0)
                for wnd in wins)
            enable = f":enable='{conds}'"
        nxt = f"o{idx}"
        parts.append(f"[{cur}][{out_lbl}]overlay={x}:{y}{enable}[{nxt}]")
        cur = nxt
    sub = scene.get("subtitle")
    if sub and sub.get("ass_path"):
        ass = str(sub["ass_path"]).replace("\\", "/").replace(":", "\\:")
        parts.append(f"[{cur}]subtitles='{ass}'[vout]")
        vlabel = "vout"
    else:
        vlabel = cur
    return ";".join(parts), inputs, vlabel, "aud"


def render(scene: Dict[str, Any], out_path: str, on_progress=None) -> str:
    """组装并执行单次 ffmpeg。失败抛异常(caller 兜底回 moviepy)。"""
    from chayuan.server.video_generation.compute import get_compute
    plan = get_compute()
    fc, inputs, vlabel, _ = build_filter(scene)
    dur = max(0.1, int(scene["duration_ms"]) / 1000.0)
    cmd: List[str] = [plan.ffmpeg_exe, "-y", "-loglevel", "error"]
    for ipt in inputs:
        if ipt.get("is_image"):
            cmd += ["-loop", "1"]            # 静态图片层撑满整段(配合 -t 截断)
        elif ipt.get("loop"):
            cmd += ["-stream_loop", "-1"]    # 短视频商品层循环到总时长
        if ipt.get("offset_ms"):
            cmd += ["-itsoffset", str(ipt["offset_ms"] / 1000.0)]
        cmd += ["-i", ipt["path"]]
    cmd += ["-i", scene["audio_path"]]            # 最后一个输入 = 音频
    aidx = len(inputs)
    cmd += ["-filter_complex", fc,
            "-map", f"[{vlabel}]", "-map", f"{aidx}:a",
            "-t", str(dur), "-r", "25",
            "-c:a", "aac", *plan.encoder_opts, out_path]
    subprocess.run(cmd, check=True)
    return out_path
