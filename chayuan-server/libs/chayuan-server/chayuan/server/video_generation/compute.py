"""GPU/CPU 能力探测层:探测一次并缓存,供 ffcompose(编码器)/engine(fp16)/jobs(并行度)复用。
探测失败一律安全降级到 CPU/libx264(项目红线:无 GPU 必须仍能跑)。"""
from __future__ import annotations

import functools
import os
import subprocess
from dataclasses import dataclass
from typing import List, Tuple


def _has_cuda() -> bool:
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        return False


def _gpu_info() -> Tuple[str, int]:
    try:
        import torch
        if torch.cuda.is_available():
            p = torch.cuda.get_device_properties(0)
            return str(p.name), int(p.total_memory // (1024 * 1024))
    except Exception:  # noqa: BLE001
        pass
    return "", 0


def _ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        return "ffmpeg"


def _nvenc_available(exe: str) -> bool:
    try:
        out = subprocess.run([exe, "-hide_banner", "-encoders"],
                             capture_output=True, text=True, timeout=10).stdout or ""
        return "h264_nvenc" in out
    except Exception:  # noqa: BLE001
        return False


@dataclass
class ComputePlan:
    has_cuda: bool
    gpu_name: str
    vram_mb: int
    cpu_count: int
    ffmpeg_exe: str
    video_encoder: str            # "h264_nvenc" | "libx264"
    encoder_opts: List[str]       # 传给 ffmpeg 的 -c:v ... 选项
    infer_fp16: bool              # 推理是否用半精度(= has_cuda)


@functools.lru_cache(maxsize=1)
def get_compute() -> ComputePlan:
    exe = _ffmpeg_exe()
    cuda = _has_cuda()
    name, vram = _gpu_info()
    nvenc = cuda and _nvenc_available(exe)
    if nvenc:
        enc = "h264_nvenc"
        opts = ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "23", "-pix_fmt", "yuv420p"]
    else:
        enc = "libx264"
        opts = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"]
    return ComputePlan(has_cuda=cuda, gpu_name=name, vram_mb=vram,
                       cpu_count=os.cpu_count() or 1, ffmpeg_exe=exe,
                       video_encoder=enc, encoder_opts=opts, infer_fp16=cuda)
