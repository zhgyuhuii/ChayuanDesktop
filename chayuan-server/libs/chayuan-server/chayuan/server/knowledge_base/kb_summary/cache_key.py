"""文件全文摘要的缓存键:文件名 + 全文内容哈希。文件重新入库(内容变)→ 哈希变 → 缓存自动失效。"""
from __future__ import annotations
import hashlib
from typing import List

def content_hash(chunk_texts: List[str]) -> str:
    """对全部 chunk 文本(按给定顺序)算稳定短哈希(16 hex)。"""
    h = hashlib.sha256()
    for t in chunk_texts:
        h.update(t.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:16]

def file_summary_cache_key(file_name: str, chash: str) -> str:
    return f"summary::{file_name}::{chash}"
