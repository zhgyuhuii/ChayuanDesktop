"""超大文件二次确认:chunk 数超阈值且未确认 → needs_confirm(带预估)。"""
from __future__ import annotations
from dataclasses import dataclass

@dataclass
class SummarizePrecheck:
    needs_confirm: bool
    chunk_count: int
    est_llm_calls: int

def summarize_precheck(*, chunk_count: int, confirmed: bool, threshold: int = 60) -> SummarizePrecheck:
    over = chunk_count > threshold
    est = chunk_count + max(1, (chunk_count + 4) // 5)
    return SummarizePrecheck(needs_confirm=over and not confirmed, chunk_count=chunk_count, est_llm_calls=est)
