"""时间轴可视化媒体探测工具:旁白波形下采样 + 视频抽帧缩略图。

只读,不改动素材。ffmpeg 二进制走 imageio_ffmpeg(与 compose 一致)。
波形:ffmpeg 解码为单声道 8kHz s16le PCM → numpy → 分桶取峰值。
缩略图:ffmpeg 抽指定时刻一帧,缩到宽 160,落盘缓存。
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from typing import List

import numpy as np

logger = logging.getLogger(__name__)

PEAK_SAMPLE_RATE = 8000


def _ffmpeg_bin() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def downsample_peaks(samples: "np.ndarray", n: int) -> List[float]:
    """把 [-1,1] 浮点样本数组分成 n 桶,每桶取 max(abs) 归一峰值。

    纯函数:空数组返回 n 个 0;样本少于 n 也返回 n 个值。
    """
    n = max(1, int(n))
    if samples.size == 0:
        return [0.0] * n
    buckets = np.array_split(np.abs(samples), n)
    return [float(b.max()) if b.size else 0.0 for b in buckets]


def extract_peaks(audio_path: str, n: int = 600) -> dict:
    """解码 audio_path 为 PCM,返回 {peaks:[n], duration_ms}。失败返回全 0。"""
    cmd = [
        _ffmpeg_bin(), "-v", "error", "-i", audio_path,
        "-ac", "1", "-ar", str(PEAK_SAMPLE_RATE), "-f", "s16le", "-",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, check=True)
    except Exception as e:  # noqa: BLE001
        logger.warning("[media_probe] 波形解码失败 %s: %r", audio_path, e)
        return {"peaks": [0.0] * n, "duration_ms": 0}
    samples = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    duration_ms = int(samples.size / PEAK_SAMPLE_RATE * 1000)
    return {"peaks": downsample_peaks(samples, n), "duration_ms": duration_ms}


def build_thumbnail_cmd(ffmpeg: str, video_path: str, out_path: str, t: float) -> List[str]:
    """构造抽帧命令(纯函数,便于单测)。-ss 放 -i 前(快速 seek)。"""
    return [
        ffmpeg, "-v", "error", "-ss", str(t), "-i", video_path,
        "-frames:v", "1", "-vf", "scale=160:-1", "-y", out_path,
    ]


def extract_thumbnail(video_path: str, out_path: str, t: float = 0.0) -> str:
    """抽 video_path 第 t 秒一帧到 out_path(已存在则直接返回)。失败返回空串。"""
    if os.path.isfile(out_path) and os.path.getsize(out_path) > 0:
        return out_path
    cmd = build_thumbnail_cmd(_ffmpeg_bin(), video_path, out_path, t)
    try:
        subprocess.run(cmd, capture_output=True, check=True)
    except Exception as e:  # noqa: BLE001
        logger.warning("[media_probe] 抽帧失败 %s@%s: %r", video_path, t, e)
        return ""
    return out_path if os.path.isfile(out_path) else ""


def cached_peaks(audio_path: str, cache_dir: str, n: int = 600) -> dict:
    """带磁盘缓存的 extract_peaks:cache_dir/peaks_{n}.json。"""
    cache_file = os.path.join(cache_dir, f"peaks_{n}.json")
    if os.path.isfile(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:  # noqa: BLE001
            pass
    result = extract_peaks(audio_path, n)
    # 不缓存"失败/全 0"结果:音频还没就绪或 ffmpeg 出错时 extract_peaks 返回 duration_ms=0,
    # 一旦缓存进去,之后音频有了也永远返回 0(扁平波形)。只缓存有效结果。
    if (result.get("duration_ms") or 0) > 0:
        try:
            os.makedirs(cache_dir, exist_ok=True)
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(result, f)
        except Exception as e:  # noqa: BLE001
            logger.warning("[media_probe] 写 peaks 缓存失败: %r", e)
    return result
