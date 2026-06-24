"""按文档长度自动选总结策略(stuff / map_reduce / refine)。纯逻辑,可单测。

- stuff      :全文塞一个 prompt 一次总结 —— 短文最快最连贯。
- map_reduce :分块各自总结再合并(递归 collapse)—— 长文/超长文标准做法。
- refine     :顺序逐块迭代精炼 —— 强顺序依赖、要连贯叙述时用(慢,串行)。

``requested`` 为显式策略时原样返回;``"auto"``(默认)按长度选:短文 stuff,长文 map_reduce
(refine 不进 auto —— 它是为"连贯/顺序"而非"长度",需显式指定)。
"""
from __future__ import annotations

VALID = ("stuff", "map_reduce", "refine")
DEFAULT_STUFF_MAX_CHARS = 8000


def choose_summary_strategy(
    *,
    total_chars: int,
    chunk_count: int,
    requested: str = "auto",
    stuff_max_chars: int = DEFAULT_STUFF_MAX_CHARS,
) -> str:
    req = (requested or "auto").lower()
    if req in VALID:
        return req
    # auto:短文(总字数小 或 仅 1-2 块)→ stuff;否则 → map_reduce
    if total_chars <= stuff_max_chars or chunk_count <= 2:
        return "stuff"
    return "map_reduce"
