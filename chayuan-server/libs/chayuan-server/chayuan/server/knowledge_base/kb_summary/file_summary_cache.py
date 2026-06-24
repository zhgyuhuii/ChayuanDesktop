"""文件全文摘要缓存的读写薄封装(底座 = KBSummaryService 摘要 FAISS 库)。
命中判定逻辑此处可单测;FAISS 实际读写在 KBSummaryService,集成态验证。"""
from __future__ import annotations
from typing import Optional, Protocol

class SummaryStore(Protocol):
    def search_by_key(self, key: str) -> Optional[str]: ...
    def put(self, key: str, summary_text: str) -> None: ...

def get_cached_summary(store: SummaryStore, key: str) -> Optional[str]:
    try:
        return store.search_by_key(key)
    except Exception:
        return None

def put_summary(store: SummaryStore, key: str, summary_text: str) -> None:
    try:
        store.put(key, summary_text)
    except Exception:
        pass  # 缓存写失败不影响主流程返回结果
