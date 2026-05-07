"""图像向量存储（复用 FAISS 自带 metadata）。

设计原则：
- 每个图像 KS 独立一个 FAISS IndexFlatIP 或 Milvus collection
- 存盘到 ``CHAYUAN_ROOT/data/image_indexes/{source_name}``
- 每张图一条 record：{vec, path, md5, size, ocr_text, created_at}
- 查询返回归一 RetrievalChunk（对齐 KnowledgeSource 生态）

简化：内存索引 + numpy 持久化；满足 <= 10 万张图的场景。超过建议走 Milvus。
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("chayuan.image_source.store")


def _image_indexes_root() -> Path:
    base = os.environ.get("CHAYUAN_ROOT")
    p = Path(base) if base else Path.home() / "chayuan_data"
    root = p / "data" / "image_indexes"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _md5_of(path: str) -> str:
    try:
        h = hashlib.md5()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:  # noqa: BLE001
        return ""


class ImageStore:
    """一个 source 的图像索引。FAISS 不可用时回退 numpy brute-force。"""

    def __init__(self, source_name: str):
        self.source_name = source_name
        self.root = _image_indexes_root() / source_name
        self.root.mkdir(parents=True, exist_ok=True)
        self._meta_path = self.root / "meta.json"
        self._vec_path = self.root / "vectors.npy"
        self._meta: List[Dict[str, Any]] = []
        self._matrix = None   # np.ndarray (N, dim)
        self._dim = 0
        self._lock = threading.Lock()
        self._load()

    # ---- 持久化 ----

    def _load(self) -> None:
        try:
            if self._meta_path.exists():
                self._meta = json.loads(self._meta_path.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            logger.warning("读取 meta 失败：%r", e)
            self._meta = []
        try:
            if self._vec_path.exists():
                import numpy as np
                self._matrix = np.load(str(self._vec_path))
                if self._matrix is not None and self._matrix.shape:
                    self._dim = int(self._matrix.shape[1])
        except Exception as e:  # noqa: BLE001
            logger.warning("读取 vectors 失败：%r", e)
            self._matrix = None

    def _save(self) -> None:
        import numpy as np
        self._meta_path.write_text(
            json.dumps(self._meta, ensure_ascii=False, default=str),
            encoding="utf-8",
        )
        if self._matrix is not None:
            np.save(str(self._vec_path), self._matrix)

    # ---- 写 ----

    def add(self, vector, *, path: str, extra: Optional[Dict[str, Any]] = None) -> str:
        import numpy as np
        with self._lock:
            md5 = _md5_of(path) if os.path.isfile(path) else ""
            rec = {
                "id": f"img_{int(time.time() * 1000)}_{len(self._meta)}",
                "path": str(path), "md5": md5,
                "size_bytes": os.path.getsize(path) if os.path.isfile(path) else 0,
                "created_at": time.time(),
                **(extra or {}),
            }
            # 去重：同 md5 的图像不再入库
            if md5:
                for existing in self._meta:
                    if existing.get("md5") == md5:
                        return existing["id"]
            vec = np.asarray(vector, dtype="float32").reshape(-1)
            if self._matrix is None:
                self._matrix = vec.reshape(1, -1)
                self._dim = vec.shape[0]
            else:
                if vec.shape[0] != self._dim:
                    raise ValueError(
                        f"向量维度不一致：当前索引 {self._dim}，新向量 {vec.shape[0]}。"
                        "请删除旧索引或用同一 embedder 重建。"
                    )
                self._matrix = np.vstack([self._matrix, vec.reshape(1, -1)])
            self._meta.append(rec)
            self._save()
            return rec["id"]

    def remove(self, image_id: str) -> bool:
        import numpy as np
        with self._lock:
            idx = None
            for i, m in enumerate(self._meta):
                if m.get("id") == image_id:
                    idx = i
                    break
            if idx is None:
                return False
            self._meta.pop(idx)
            if self._matrix is not None:
                self._matrix = np.delete(self._matrix, idx, axis=0)
            self._save()
            return True

    # ---- 读 ----

    def search(self, query_vec, top_k: int = 5) -> List[Tuple[Dict[str, Any], float]]:
        import numpy as np
        if self._matrix is None or len(self._meta) == 0:
            return []
        q = np.asarray(query_vec, dtype="float32").reshape(-1)
        # 已归一化：cosine == dot
        qn = float(np.linalg.norm(q)) or 1.0
        q = q / qn
        sims = self._matrix @ q
        order = np.argsort(-sims)[: int(top_k)]
        out = []
        for i in order:
            ii = int(i)
            out.append((self._meta[ii], float(sims[ii])))
        return out

    def count(self) -> int:
        return len(self._meta)

    def dim(self) -> int:
        return int(self._dim)

    def all_paths(self) -> List[str]:
        return [m.get("path") or "" for m in self._meta]


# ---- 单例 per source ----

_STORES: Dict[str, ImageStore] = {}
_STORE_LOCK = threading.Lock()


def get_store(source_name: str) -> ImageStore:
    with _STORE_LOCK:
        if source_name not in _STORES:
            _STORES[source_name] = ImageStore(source_name)
        return _STORES[source_name]


def invalidate(source_name: str = "") -> None:
    with _STORE_LOCK:
        if source_name:
            _STORES.pop(source_name, None)
        else:
            _STORES.clear()
