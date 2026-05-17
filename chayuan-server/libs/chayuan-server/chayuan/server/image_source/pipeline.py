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
    """处理一个 upload item。永不抛异常,失败信息写到 item.state/error。

    两条路径(OCR 文字 / CLIP 图像向量)**互相独立**,任一可用即视为可用:
      - 都成功 → state=ready,可以以图搜图 + 文字检索
      - 只 CLIP 成功 → state=ready,只能以图搜图(无 OCR 文本)
      - 只 OCR 成功 → state=ready,只能文字检索(以图搜图缺位,UI 提示)
      - 都失败    → state=failed
    避免之前"CLIP 没装 → 整个 item failed,OCR 文字也丢"的体验。
    """
    store = get_store(store_name)

    store.update(item_id, state="ocr_and_embedding", progress=10)

    ocr_port = _resolve_ocr_port()
    ocr_coro = (
        _run_ocr(image_bytes, port=ocr_port)
        if ocr_port else _ocr_unavailable()
    )
    clip_coro = _run_clip_embed_safe(image_bytes, model_name=model_name)
    ocr_res, clip_res = await asyncio.gather(ocr_coro, clip_coro)

    has_image_vector = False
    if clip_res.vector is not None and not clip_res.error:
        store.add_image_vector(item_id, clip_res.vector)
        has_image_vector = True
        store.update(item_id, progress=50)
    else:
        logger.info("CLIP embed unavailable for %s: %s",
                    item_id, clip_res.error or "no vector")

    has_text_vector = False
    if ocr_res.text:
        store.update(
            item_id,
            ocr_text=ocr_res.text,
            ocr_lang=ocr_res.lang,
            ocr_confidence=ocr_res.confidence,
            progress=70,
        )
        base_url, model, api_key = _resolve_text_embed_endpoint()
        if base_url and model:
            txt_res = await _run_text_embed(
                ocr_res.text, base_url=base_url, model=model, api_key=api_key,
            )
            if txt_res.vector is not None:
                store.add_text_vector(item_id, txt_res.vector)
                has_text_vector = True
                store.update(item_id, progress=90)
            else:
                logger.info("text embed failed for %s (%s): %s",
                            item_id, model, txt_res.error)
        else:
            logger.info(
                "default text embedding model unresolved;"
                " soft-degrade %s (user must configure 默认模型选择 → 文本嵌入)",
                item_id,
            )
    elif ocr_res.error:
        logger.info("OCR failed for %s: %s", item_id, ocr_res.error)

    store.update(item_id, has_text_vector=has_text_vector)

    # 任一路径可用 → ready;都失败 → failed(把两边错误拼出来便于排查)
    if has_image_vector or has_text_vector or ocr_res.text:
        # 注:有 OCR 文本但没 text_vector 也算可用 — 用户至少可以 grep 全文
        # diagnostics:告诉用户哪些功能受限
        notes: list[str] = []
        if not has_image_vector:
            notes.append("以图搜图不可用(CLIP 未装/失败)")
        if ocr_res.text and not has_text_vector:
            notes.append("OCR 文字向量缺失(默认文本嵌入未配)")
        if not ocr_res.text:
            notes.append("无 OCR 文本(空图/OCR 未跑)")
        diag = " · ".join(notes) or None
        store.update(item_id, state="ready", progress=100, error=diag)
    else:
        # 两条路径都没货 — 真的 failed
        err = f"CLIP={clip_res.error or 'no vector'} · OCR={ocr_res.error or 'no text'}"
        store.update(item_id, state="failed", error=err, progress=0)

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
