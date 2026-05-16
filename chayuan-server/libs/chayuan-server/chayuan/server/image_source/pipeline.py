"""图像 KB upload 流水线:OCR ‖ CLIP 并行,默认文本向量模型软降级,状态机推进。

输入:store_name + item_id + image_bytes。流程:
    1. state=queued → state=ocr_and_embedding, progress=10
    2. asyncio.gather(OCR, CLIP)
    3. CLIP 失败 → state=failed, return
    4. 写 image vector, progress=70
    5. OCR 成功且 text 非空 → 写 ocr_*, progress=85;再调用户默认文本向量模型
       - 文本向量成功 → 写 text vector, has_text_vector=True
       - 文本向量失败/未配置 → has_text_vector=False(软降级)
    6. state=ready, progress=100, flush
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional, Tuple

import numpy as np

from chayuan.server.image_source.ocr_client import OCRResult, run_ocr
from chayuan.server.image_source.ocr_client import (
    resolve_port as _resolve_ocr_port_impl,
)
from chayuan.server.image_source.store import get_store
from chayuan.server.image_source.text_embed_client import (
    EmbedResult, embed_text,
)
from chayuan.server.image_source.text_embed_client import (
    resolve_endpoint as _resolve_text_embed_endpoint_impl,
)

logger = logging.getLogger("chayuan.image_source.pipeline")

_OCR_SEMAPHORE = asyncio.Semaphore(2)


# ---- 可 monkeypatch 的 seam ----

async def _run_ocr(image_bytes: bytes, *, port: int, timeout: float = 30.0) -> OCRResult:
    async with _OCR_SEMAPHORE:
        return await run_ocr(image_bytes, port=port, timeout=timeout)


async def _run_clip_embed(image_bytes: bytes, *, model_name: str = ""):
    """同步 BaseImageEmbedder.embed_image 放线程池跑。"""
    from chayuan.server.image_source.embedder import get_embedder

    def _sync():
        emb = get_embedder(model_name) if model_name else get_embedder(None)
        return np.asarray(emb.embed_image(image_bytes), dtype="float32").reshape(-1)
    return await asyncio.to_thread(_sync)


async def _run_text_embed(
    text: str, *, base_url: str, model: str,
    api_key: Optional[str] = None, timeout: float = 30.0,
) -> EmbedResult:
    return await embed_text(text, base_url=base_url, model=model,
                              api_key=api_key, timeout=timeout)


def _resolve_ocr_port() -> Optional[int]:
    return _resolve_ocr_port_impl()


def _resolve_text_embed_endpoint() -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """(base_url, model, api_key) 由 text_embed_client 用 utils.get_default_embedding 解析。"""
    return _resolve_text_embed_endpoint_impl()


# ---- 主流程 ----

async def process_item(
    store_name: str, item_id: str, image_bytes: bytes,
    *, model_name: str = "",
) -> None:
    """处理一个 upload item。永不抛异常,失败信息写到 item.state/error。"""
    store = get_store(store_name)

    store.update(item_id, state="ocr_and_embedding", progress=10)

    ocr_port = _resolve_ocr_port()
    ocr_coro = (
        _run_ocr(image_bytes, port=ocr_port)
        if ocr_port else _ocr_unavailable()
    )
    clip_coro = _run_clip_embed_safe(image_bytes, model_name=model_name)
    ocr_res, clip_res = await asyncio.gather(ocr_coro, clip_coro)

    if clip_res.error or clip_res.vector is None:
        store.update(item_id, state="failed",
                     error=f"embedding failed: {clip_res.error or 'no vector'}",
                     progress=0)
        store.flush()
        return

    store.add_image_vector(item_id, clip_res.vector)
    store.update(item_id, progress=70)

    if ocr_res.text:
        store.update(
            item_id,
            ocr_text=ocr_res.text,
            ocr_lang=ocr_res.lang,
            ocr_confidence=ocr_res.confidence,
            progress=85,
        )
        base_url, model, api_key = _resolve_text_embed_endpoint()
        if base_url and model:
            txt_res = await _run_text_embed(
                ocr_res.text, base_url=base_url, model=model, api_key=api_key,
            )
            if txt_res.vector is not None:
                store.add_text_vector(item_id, txt_res.vector)
                store.update(item_id, progress=95)
            else:
                logger.info("text embed failed for %s (%s): %s",
                            item_id, model, txt_res.error)
                store.update(item_id, has_text_vector=False)
        else:
            logger.info(
                "default text embedding model unresolved;"
                " soft-degrade %s (user must configure 默认模型选择 → 文本嵌入)",
                item_id,
            )
            store.update(item_id, has_text_vector=False)
    else:
        store.update(item_id, has_text_vector=False)
        if ocr_res.error:
            logger.info("OCR failed for %s: %s", item_id, ocr_res.error)

    store.update(item_id, state="ready", progress=100, error=None)
    store.flush()


async def _ocr_unavailable() -> OCRResult:
    return OCRResult(error="ocr sidecar port unresolved")


class _ClipResult:
    __slots__ = ("vector", "error")
    def __init__(self, vector=None, error=None):
        self.vector = vector
        self.error = error


async def _run_clip_embed_safe(image_bytes: bytes, *, model_name: str) -> _ClipResult:
    try:
        vec = await _run_clip_embed(image_bytes, model_name=model_name)
        return _ClipResult(vector=vec)
    except Exception as e:  # noqa: BLE001
        logger.exception("CLIP embed failed")
        return _ClipResult(error=str(e))
