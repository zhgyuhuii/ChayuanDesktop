"""多照合一:从多张同一人照片里挑「最佳单帧」作为驱动形象参考。

引擎(wav2lip/sadtalker/musetalk)都是单图驱动,不支持多参考身份建模(那要换引擎,
本期不做)。这里用清晰度(Laplacian 方差)挑最清晰一张;有 cv2 就用,否则回退第一张。
"""
from __future__ import annotations
import logging
from typing import List

logger = logging.getLogger("chayuan.dh.reference")


def _sharpness(path: str) -> float:
    """Laplacian 方差作清晰度分;cv2 不可用 / 读失败返 -1。"""
    try:
        import cv2  # type: ignore
        img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if img is None:
            return -1.0
        return float(cv2.Laplacian(img, cv2.CV_64F).var())
    except Exception:  # noqa: BLE001
        return -1.0


def build_reference_image(paths: List[str]) -> str:
    """从多张照片挑最清晰一张,返回其路径。空列表抛异常;
    cv2 不可用或全部读失败时(分数都相等)回退第一张。"""
    if not paths:
        raise RuntimeError("没有可用于合成参考图的照片")
    best, best_score = paths[0], -2.0
    for p in paths:
        sc = _sharpness(p)
        if sc > best_score:
            best, best_score = p, sc
    return best

