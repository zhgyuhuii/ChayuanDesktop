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

def summary_discriminator(file_hash: str | None, ordered_chunk_texts: List[str]) -> str:
    """缓存键的判别部分:优先用文件已存的内容 SHA-256(file_hash);
    历史文件无 file_hash 时回退到"按给定(已排序)顺序的 chunk 文本哈希"。
    两者都只随文件内容变,不随查询顺序漂移(前提:调用方传入的 chunk 已稳定排序)。"""
    if file_hash:
        return file_hash
    return content_hash(ordered_chunk_texts)

def file_summary_cache_key(file_name: str, chash: str) -> str:
    return f"summary::{file_name}::{chash}"
