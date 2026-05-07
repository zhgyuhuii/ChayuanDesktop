"""HuggingFace CLIP 系模型 loader（跨模态）。

覆盖家族：
- ``clip``              — openai/clip-vit-*
- ``siglip``            — google/siglip-* 与 google/siglip2-*
- ``chinese_clip``      — OFA-Sys/chinese-clip-vit-*
- ``jina_clip``         — jinaai/jina-clip-*
- ``eva_clip``          — BAAI/EVA-CLIP-*（实际上 transformers 对 EVA-CLIP 的
                          支持需 ``trust_remote_code=True``；我们全开，与 HF 社区
                          约定一致）

统一路径：``AutoProcessor + AutoModel.get_{image,text}_features``；对
没有这两个方法的子模型回退到 ``model(**inputs).image_embeds / text_embeds``。
"""
from __future__ import annotations

import io
import logging
import threading
from pathlib import Path
from typing import Any, Union

from chayuan.server.image_source.embedder_base import BaseImageEmbedder
from chayuan.server.image_source.embedder_types import CROSSMODAL, ModelSpec
from chayuan.server.image_source.loaders import register_loader

logger = logging.getLogger("chayuan.image_source.loaders.hf_clip")


def _cache_dir() -> str:
    """与 model_manager 共享缓存根；避免各处写路径各执一词。"""
    from chayuan.server.image_source.model_manager import _cache_root
    return str(_cache_root())


class HFClipEmbedder(BaseImageEmbedder):
    """统一封装 CLIP 系 HF 模型；懒加载、线程安全、bf16 GPU 友好。"""

    capabilities = CROSSMODAL

    def __init__(self, spec: ModelSpec):
        super().__init__(spec.name)
        self.spec = spec
        self.dim = int(spec.dim or 0)
        self._model = None
        self._processor = None
        self._device = "cpu"

    def is_available(self) -> bool:
        try:
            import PIL.Image  # noqa: F401
            import torch  # noqa: F401
            import transformers  # noqa: F401
            return True
        except Exception:  # noqa: BLE001
            return False

    def missing_deps_hint(self) -> str:
        return "pip install torch transformers pillow"

    # ---- lazy load ------------------------------------------------------

    def _lazy_load(self):
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            import torch
            from transformers import AutoModel, AutoProcessor  # type: ignore
            self._device = "cuda" if torch.cuda.is_available() else "cpu"
            dtype = torch.bfloat16 if self._device == "cuda" else torch.float32
            self._processor = AutoProcessor.from_pretrained(
                self.name, cache_dir=_cache_dir(), trust_remote_code=True,
            )
            self._model = AutoModel.from_pretrained(
                self.name, cache_dir=_cache_dir(), trust_remote_code=True,
                torch_dtype=dtype,
            ).to(self._device).eval()
            # 某些模型（JinaCLIP）projection_dim 才是真实输出维度
            if self.dim <= 0:
                try:
                    cfg = getattr(self._model, "config", None)
                    for attr in ("projection_dim", "hidden_size"):
                        v = getattr(cfg, attr, None) if cfg else None
                        if v:
                            self.dim = int(v)
                            break
                except Exception:  # noqa: BLE001
                    pass

    # ---- helpers --------------------------------------------------------

    def _open_image(self, src):
        import PIL.Image as Image
        if isinstance(src, Image.Image):
            return src.convert("RGB")
        if isinstance(src, (bytes, bytearray)):
            return Image.open(io.BytesIO(src)).convert("RGB")
        return Image.open(str(src)).convert("RGB")

    def _pool_and_norm(self, feats) -> Any:
        import numpy as np
        import torch
        vec = feats[0].detach().cpu().to(torch.float32).numpy()
        norm = float(np.linalg.norm(vec)) or 1.0
        return (vec / norm).astype("float32")

    # ---- embed ----------------------------------------------------------

    def embed_image(self, src: Union[str, bytes, Any]):
        import torch
        self._lazy_load()
        img = self._open_image(src)
        with torch.no_grad():
            inputs = self._processor(images=img, return_tensors="pt").to(self._device)
            if hasattr(self._model, "get_image_features"):
                feats = self._model.get_image_features(**inputs)
            else:
                out = self._model(**inputs)
                feats = getattr(out, "image_embeds", None) or getattr(out, "pooler_output")
            return self._pool_and_norm(feats)

    def embed_text(self, text: str):
        import torch
        self._lazy_load()
        with torch.no_grad():
            inputs = self._processor(
                text=[text or ""], return_tensors="pt", padding=True, truncation=True,
            ).to(self._device)
            if hasattr(self._model, "get_text_features"):
                feats = self._model.get_text_features(**inputs)
            else:
                out = self._model(**inputs)
                feats = getattr(out, "text_embeds", None) or getattr(out, "pooler_output")
            return self._pool_and_norm(feats)


@register_loader("clip", "siglip", "chinese_clip", "jina_clip", "eva_clip")
def _build(spec: ModelSpec) -> BaseImageEmbedder:
    return HFClipEmbedder(spec)
