"""ImageConnector — 把图像知识源接入 KnowledgeSource 抽象。

对 orchestrator / Text2X pipeline / 多源并行来说，图像源只是 kind=image 的一种
BaseConnector 实现；这里把文本查询 → text embedding → cosine 搜图 → 归一
RetrievalChunk 的流程收敛。

**核心契约**：
- ``search(NLQuery)`` 只消费 ``query`` 字段（文本）；查图逻辑独立暴露
- ``search_by_image(bytes_or_path, top_k)`` 以图搜图
- test_connection / introspect 轻量：报当前模型 + index 记录数
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, List, Optional, Tuple
from urllib.parse import urlencode

from chayuan.server.image_source.embedder import default_model_name, get_embedder
from chayuan.server.image_source.store import get_store
from chayuan.server.knowledge_source.base import (
    BaseConnector, ConnectionSpec, ConnectorError,
)
from chayuan.server.knowledge_source.types import (
    Citation, NLQuery, RetrievalChunk, SchemaSnapshot, SourceKind, TableInfo,
)

logger = logging.getLogger("chayuan.image_source.connector")


class ImageConnector(BaseConnector):
    """kind=image 的 Connector。

    ConnectionSpec.options 支持的键：
    - ``embedder_model``：向量化模型名（如 ``google/siglip2-base-patch16-224``）；
      未填用全局默认
    - ``source_name``：索引存盘名（默认 spec.database）
    """

    dialects = ("image",)
    source_kind = "image"

    def __init__(self, spec: ConnectionSpec, source_id: int = 0):
        super().__init__(spec, source_id)
        self._model_name = (self.spec.options or {}).get("embedder_model") or default_model_name()
        self._source_name = (self.spec.options or {}).get("source_name") or self.spec.database or f"src_{self.source_id}"

    # ---- 检验 ----

    def test_connection(self) -> Tuple[bool, str]:
        emb = get_embedder(self._model_name)
        if not emb.is_available():
            return (False,
                    "未安装 torch / transformers / Pillow；"
                    "请 `pip install 'chayuan-server[image]'` 并准备模型。")
        try:
            # 懒加载一次，验证模型文件就绪
            _ = emb.embed_text("test")
            return True, f"图像模型就绪：{self._model_name}"
        except Exception as e:  # noqa: BLE001
            return False, f"模型加载失败：{type(e).__name__}: {e}"

    def introspect(self, sample_rows: int = 3) -> SchemaSnapshot:
        store = get_store(self._source_name)
        count = store.count()
        table = TableInfo(
            name=f"image_index:{self._source_name}",
            comment=f"图像向量索引，共 {count} 条；模型 {self._model_name}，维度 {store.dim()}",
            columns=[],
            sample_rows=[{"path": p} for p in store.all_paths()[: int(sample_rows)]],
            row_count_estimate=count,
        )
        return SchemaSnapshot(
            source_id=self.source_id, source_kind=self.source_kind,
            dialect="image", tables=[table],
        )

    # ---- 一致性守护 ----------------------------------------------------

    def _check_consistency(self, emb) -> Optional[str]:
        """检索/入库前校验：当前 embedder 的维度必须与已有索引的维度一致。

        KB 创建时绑定了 embedder_model，如果用户之后在 spec.options 里**手改**
        模型名（或同名 HF 仓库升级了维度），会让库里旧向量与新查询向量彻底不
        可比——结果就是"搜不到"。此处提前发现并返回清晰错误，比默默返错结果好。
        """
        store = get_store(self._source_name)
        store_dim = int(store.dim() or 0)
        emb_dim = int(getattr(emb, "dim", 0) or 0)
        if store_dim == 0:
            return None  # 空库，怎么写都行
        # emb 可能没加载（dim=0）；只要 store 非空、emb 已知 dim 就校验
        if emb_dim and store_dim != emb_dim:
            return (
                f"图像知识库向量维度不匹配：索引内 {store_dim} 维，"
                f"当前模型 {self._model_name} 是 {emb_dim} 维。"
                "这通常意味着 KB 的 embedder_model 被更改——已创建的图像 KB "
                "不允许更换模型，请新建 KB 或重建索引。"
            )
        return None

    # ---- 文本 → 图像 ----

    async def search(self, query: NLQuery) -> List[RetrievalChunk]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._search_sync, query)

    def _search_sync(self, query: NLQuery) -> List[RetrievalChunk]:
        emb = get_embedder(self._model_name)
        if not emb.is_available():
            hint = ""
            try:
                hint = emb.missing_deps_hint() or ""
            except Exception:  # noqa: BLE001
                pass
            return [_error_chunk(
                "图像 Embedder 未就绪"
                + (f"，请安装：`{hint}`" if hint else "（缺 torch/transformers）")
                + "；或到「模型配置」页下载其他已就绪模型。",
                self.source_id,
            )]
        # 能力检查：仅视觉模型（DINOv2/ResNet）不支持文本查图
        caps = getattr(emb, "capabilities", None)
        if caps is not None and not caps.text:
            return [_error_chunk(
                f"模型 {self._model_name} 仅支持以图搜图（纯视觉编码器），"
                "不支持用文本查图；请在调用端切到 /image/search_by_image 或"
                "更换为 CLIP/SigLIP 等跨模态模型重建 KB。",
                self.source_id,
            )]
        try:
            q_vec = emb.embed_text(query.query or "")
        except Exception as e:  # noqa: BLE001
            return [_error_chunk(f"文本向量化失败：{e}", self.source_id)]

        mismatch = self._check_consistency(emb)
        if mismatch:
            return [_error_chunk(mismatch, self.source_id)]

        hits = get_store(self._source_name).search(q_vec, top_k=max(1, int(query.top_k or 5)))
        if not hits:
            return [_error_chunk(
                f"图像索引 {self._source_name!r} 为空或无匹配；请先上传图片完成索引。",
                self.source_id,
            )]
        return [self._hit_to_chunk(rec, score) for rec, score in hits]

    # ---- 图像 → 图像 ----

    def search_by_image(self, src, top_k: int = 5) -> List[RetrievalChunk]:
        emb = get_embedder(self._model_name)
        if not emb.is_available():
            return [_error_chunk("Embedder 未就绪", self.source_id)]
        try:
            q_vec = emb.embed_image(src)
        except Exception as e:  # noqa: BLE001
            return [_error_chunk(f"图像向量化失败：{e}", self.source_id)]
        mismatch = self._check_consistency(emb)
        if mismatch:
            return [_error_chunk(mismatch, self.source_id)]
        hits = get_store(self._source_name).search(q_vec, top_k=max(1, int(top_k or 5)))
        return [self._hit_to_chunk(rec, score) for rec, score in hits]

    # ---- 添加 / 移除 ----

    def add_image(self, path: str, *, ocr_text: str = "", tags: str = "") -> str:
        """把一张本地图像 embed 后加入索引，返回 id。

        **索引元数据**会同时写 ``embedder_model`` / ``embedder_dim`` /
        ``capabilities``——这是搜索一致性的基石：检索端用同名 embedder 拿
        query 向量，store 侧可以在 dim 层面立即发现错配。
        """
        if not os.path.isfile(path):
            raise ConnectorError(f"图像文件不存在：{path}", code="not_found", dialect="image")
        emb = get_embedder(self._model_name)
        vec = emb.embed_image(path)
        caps = getattr(emb, "capabilities", None)
        return get_store(self._source_name).add(
            vec, path=path,
            extra={
                "ocr_text": (ocr_text or "")[:2000],
                "tags": tags[:200],
                "embedder_model": self._model_name,
                "embedder_dim": int(getattr(emb, "dim", 0) or 0),
                "embedder_capabilities": caps.to_dict() if caps else None,
            },
        )

    # ---- 格式化 ----

    def _hit_to_chunk(self, record: dict, score: float) -> RetrievalChunk:
        path = record.get("path") or ""
        fname = os.path.basename(path) if path else "(unknown)"
        download_url, preview_url = _download_urls(self.source_id, record.get("id", ""))
        content_lines = [
            f"**图像**：`{fname}`",
            f"**模型**：{record.get('embedder_model') or self._model_name}",
            f"**得分**：{score:.4f}",
        ]
        ocr = record.get("ocr_text") or ""
        if ocr:
            content_lines.append(f"\n**OCR 文本**：{ocr[:400]}")
        tags = record.get("tags") or ""
        if tags:
            content_lines.append(f"**标签**：{tags}")
        return RetrievalChunk(
            content="\n".join(content_lines),
            citation=Citation(
                title=fname,
                source_id=self.source_id,
                source_kind=self.source_kind,
                download_url=download_url,
                preview_url=preview_url,
                meta={
                    "path": path, "image_id": record.get("id"),
                    "md5": record.get("md5"),
                    "embedder_model": record.get("embedder_model"),
                },
            ),
            score=float(score),
            source_id=self.source_id,
            source_kind=self.source_kind,
        )


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _error_chunk(msg: str, source_id: int) -> RetrievalChunk:
    return RetrievalChunk(
        content=msg,
        citation=Citation(
            title="图像源错误", source_id=source_id, source_kind="image",
            meta={"error": True},
        ),
        score=0.0, source_id=source_id, source_kind="image",
    )


def _download_urls(source_id: int, image_id: str) -> Tuple[str, str]:
    if not image_id:
        return "", ""
    base = f"/knowledge_source/{int(source_id)}/image"
    return (
        f"{base}/{image_id}?download=true",
        f"{base}/{image_id}?download=false",
    )
