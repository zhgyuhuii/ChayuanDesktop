"""调 rapidocr sidecar 的异步瘦客户端。

sidecar 协议见 chayuan/server/modality/rapidocr_server.py:
    POST /v1/ocr {"image": "<base64>"}
    → {"boxes": [{"box":[...], "text":"...", "score":0.x}, ...], "elapsed_ms": N}

端口通过 SidecarRuntimeManager.get_runtime("ocr").info.port 拿;
本模块只接受 port,**不直接耦合 manager**(方便单测)。
"""
from __future__ import annotations

import base64
import logging
import re
from dataclasses import dataclass, field
from typing import Optional

import httpx

logger = logging.getLogger("chayuan.image_source.ocr_client")

_CN_RE = re.compile(r"[一-鿿]")


@dataclass
class OCRResult:
    text: str = ""
    lang: str = "unknown"
    confidence: float = 0.0
    box_count: int = 0
    elapsed_ms: int = 0
    error: Optional[str] = None
    raw_boxes: list = field(default_factory=list)


async def run_ocr(image_bytes: bytes, *, port: int, timeout: float = 30.0) -> OCRResult:
    """对一张图调 rapidocr,返 OCRResult。永不抛异常,失败信息写 .error。"""
    b64 = base64.b64encode(image_bytes).decode("ascii")
    url = f"http://127.0.0.1:{int(port)}/v1/ocr"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json={"image": b64}, timeout=timeout)
        if resp.status_code >= 400:
            return OCRResult(error=f"{resp.status_code} {resp.text[:200]}")
        data = resp.json() or {}
    except httpx.TimeoutException as e:
        return OCRResult(error=f"timeout: {e}")
    except Exception as e:  # noqa: BLE001
        return OCRResult(error=f"http error: {e}")

    boxes = data.get("boxes") or []
    texts = []
    scores = []
    for b in boxes:
        t = (b.get("text") or "").strip()
        if t:
            texts.append(t)
            try:
                scores.append(float(b.get("score") or 0.0))
            except (TypeError, ValueError):
                pass
    full_text = "\n".join(texts)
    lang = "ch" if _CN_RE.search(full_text) else ("en" if full_text else "unknown")
    confidence = (sum(scores) / len(scores)) if scores else 0.0
    return OCRResult(
        text=full_text, lang=lang, confidence=confidence,
        box_count=len(boxes),
        elapsed_ms=int(data.get("elapsed_ms") or 0),
        raw_boxes=boxes,
    )


def resolve_port() -> Optional[int]:
    """从 SidecarRuntimeManager 查 ocr 端口;不可用返 None。"""
    try:
        from chayuan.server.model_registry.local_runtime import (
            SidecarRuntimeManager,
        )
        mgr = SidecarRuntimeManager.singleton()
        rt = mgr.get_runtime("ocr")
        if rt and rt.info and rt.info.port:
            return int(rt.info.port)
    except Exception as e:  # noqa: BLE001
        logger.debug("resolve OCR port failed: %r", e)
    return None
