import numpy as np
import pytest

from chayuan.server.video_generation.steps.media_probe import (
    downsample_peaks,
    build_thumbnail_cmd,
)


def test_downsample_peaks_fixed_length():
    # 1 秒 8kHz 正弦,峰值应接近 1.0,长度恒为 n
    sr = 8000
    samples = np.sin(np.linspace(0, 2 * np.pi * 5, sr)).astype(np.float32)
    peaks = downsample_peaks(samples, 100)
    assert len(peaks) == 100
    assert max(peaks) <= 1.0 and max(peaks) > 0.8
    assert all(0.0 <= p <= 1.0 for p in peaks)


def test_downsample_peaks_empty_returns_zeros():
    peaks = downsample_peaks(np.array([], dtype=np.float32), 50)
    assert peaks == [0.0] * 50


def test_downsample_peaks_shorter_than_n():
    # 样本数 < n 时仍返回 n 个值(不报错)
    peaks = downsample_peaks(np.array([0.5, -0.9, 0.3], dtype=np.float32), 10)
    assert len(peaks) == 10
    assert max(peaks) == pytest.approx(0.9, abs=1e-6)


def test_build_thumbnail_cmd_shape():
    cmd = build_thumbnail_cmd("/x/ffmpeg", "/v/in.mp4", "/v/out.jpg", 1.5)
    assert cmd[0] == "/x/ffmpeg"
    assert "-ss" in cmd and "1.5" in cmd
    assert cmd[-1] == "/v/out.jpg"
    assert "-frames:v" in cmd and "1" in cmd
    assert any("scale=160" in c for c in cmd)
