"""文字搜图 service:两路并行(用户默认文本向量模型 + CLIP 跨模态) + RRF 融合。"""
from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from chayuan.server.image_source.text_embed_client import (
    EmbedResult, embed_text as _text_embed_impl,
    resolve_endpoint as _resolve_text_embed_endpoint_impl,
)
from chayuan.server.image_source.fusion import ImageHit, rrf_fuse
from chayuan.server.image_source.store import get_store

logger = logging.getLogger("chayuan.image_source.text_search")


@dataclass
class _PathResult:
    hits: List[ImageHit]
    error: Optional[str] = None


# ---- seams(可 monkeypatch) ----

async def _clip_embed_text(query: str, *, model_name: str = ""):
    """CLIP 文本编码器把 query 文本映到图像向量空间。"""
    from chayuan.server.image_source.embedder import get_embedder

    def _sync():
        emb = get_embedder(model_name) if model_name else get_embedder(None)
        return np.asarray(emb.embed_text(query), dtype="float32").reshape(-1)
    return await asyncio.to_thread(_sync)


async def _text_embed(query: str, *, base_url: str, model: str,
                      api_key: Optional[str] = None,
                      timeout: float = 30.0) -> EmbedResult:
    return await _text_embed_impl(
        query, base_url=base_url, model=model,
        api_key=api_key, timeout=timeout,
    )


def _resolve_text_embed_endpoint() -> Tuple[Optional[str], Optional[str], Optional[str]]:
    return _resolve_text_embed_endpoint_impl()


# ---- 主流程 ----

async def text_search(
    store_name: str, query: str, *, top_k: int = 20, k_rrf: int = 60,
    source_id: int = 0, model_name: str = "",
) -> Dict[str, Any]:
    """两路文字搜图。返 {"hits": [..], "diagnostics": {..}}。"""
    store = get_store(store_name)
    diagnostics = {"text_path": "ok", "image_path": "ok"}

    text_task = asyncio.create_task(
        _run_text_vec_path(store, query, top_k, source_id)
    )
    clip_task = asyncio.create_task(
        _run_clip_text_path(store, query, top_k, source_id, model_name)
    )
    text_res, image_res = await asyncio.gather(text_task, clip_task)

    rankings: List[List[ImageHit]] = []
    if text_res.error:
        diagnostics["text_path"] = f"unavailable: {text_res.error}"
    elif text_res.hits:
        rankings.append(text_res.hits)
    if image_res.error:
        diagnostics["image_path"] = f"unavailable: {image_res.error}"
    elif image_res.hits:
        rankings.append(image_res.hits)

    if not rankings:
        return {"hits": [], "diagnostics": diagnostics}
    fused = rrf_fuse(rankings, k=k_rrf)[:top_k]
    return {
        "hits": [_hit_to_wire(h) for h in fused],
        "diagnostics": diagnostics,
    }


async def _run_text_vec_path(store, query, top_k, source_id) -> _PathResult:
    base_url, model, api_key = _resolve_text_embed_endpoint()
    if not base_url or not model:
        return _PathResult(
            hits=[],
            error="default text embedding model not configured",
        )
    res = await _text_embed(query, base_url=base_url, model=model,
                              api_key=api_key)
    if res.vector is None:
        return _PathResult(hits=[], error=res.error or "no vector")
    hits = store.search_text(res.vector, top_k=top_k)
    return _PathResult(
        hits=[_rec_to_hit(rec, score, "text_vec", source_id)
              for rec, score in hits],
    )


async def _run_clip_text_path(store, query, top_k, source_id, model_name) -> _PathResult:
    try:
        vec = await _clip_embed_text(query, model_name=model_name)
    except Exception as e:  # noqa: BLE001
        # 复用 pipeline 的产品级错误翻译(transformers AutoProcessor 缺失等),
        # 让"视觉跨模态路 unavailable" 给到的不是裸 stack 而是修复指引。
        from chayuan.server.image_source.pipeline import _friendly_clip_error
        raw = str(e)
        friendly = _friendly_clip_error(raw)
        msg = friendly or f"clip text encode failed: {raw}"
        logger.info("CLIP text encode failed: %r", e)
        return _PathResult(hits=[], error=msg)
    hits = store.search_image(vec, top_k=top_k)
    return _PathResult(
        hits=[_rec_to_hit(rec, score, "clip_text", source_id)
              for rec, score in hits],
    )


def _rec_to_hit(rec: Dict[str, Any], score: float, source_path: str,
                 source_id: int) -> ImageHit:
    iid = rec.get("id") or ""
    fname = rec.get("filename") or (
        os.path.basename(rec.get("path") or "") or iid
    )
    thumb = (
        f"/knowledge_source/{int(source_id)}/image/{iid}"
        if source_id else f"/{iid}"
    )
    return ImageHit(
        id=iid, filename=fname, thumbnail_url=thumb, score=float(score),
        source_path=source_path,
        ocr_snippet=(rec.get("ocr_text") or "")[:200] or None,
        has_text_vector=bool(rec.get("has_text_vector")),
        meta={
            "path": rec.get("path"),
            "md5": rec.get("md5"),
            "size_bytes": rec.get("size_bytes"),
            "created_at": rec.get("created_at"),
        },
    )


def _hit_to_wire(h: ImageHit) -> Dict[str, Any]:
    return {
        "id": h.id, "filename": h.filename,
        "thumbnail_url": h.thumbnail_url, "score": h.score,
        "source_path": h.source_path, "fused": h.fused,
        "ocr_snippet": h.ocr_snippet,
        "has_text_vector": h.has_text_vector,
        "meta": h.meta,
    }
