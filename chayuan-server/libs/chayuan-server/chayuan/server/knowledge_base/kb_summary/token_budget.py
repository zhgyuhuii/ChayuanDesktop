"""全文总结的上下文预算工具(纯逻辑,不依赖 langchain)。

本地 chat 模型仅 4096 上下文(process_args.py 默认 --ctx-size 4096),旧
SummaryAdapter 不做预算 → map 阶段并行发超长 prompt → llama-server 抛
「Context size has been exceeded」。本模块提供保守的中文 token 估算与按
n_ctx 推导的输入/输出预算,供 summary_chunk.py 切块与分组使用。
"""
from __future__ import annotations

import math
from typing import Tuple

DEFAULT_CTX: int = 4096
MAP_MAX_TOKENS: int = 384
REDUCE_MAX_TOKENS: int = 768
_TEMPLATE_OVERHEAD: int = 96
_SAFETY_MARGIN: int = 256


def estimate_tokens(text: str) -> int:
    """保守(偏高)估算 token 数。中文/CJK 按 1 token/字,其余按 4 字符/token,
    再取与「总字符数/3」的较大者作上界。"""
    if not text:
        return 0
    cjk = sum(1 for ch in text if "一" <= ch <= "鿿")
    other = len(text) - cjk
    est = cjk + math.ceil(other / 4)
    return max(est, math.ceil(len(text) / 3))


def resolve_model_ctx(model_name: str | None) -> int:
    """解析模型有效上下文窗口;拿不到则保守取 DEFAULT_CTX。"""
    name = (model_name or "").strip()
    if not name:
        return DEFAULT_CTX
    try:
        from chayuan.server.db.repository.model_metadata_repository import (
            get_model_metadata,
        )
        md = get_model_metadata(name)
        ctx = getattr(md, "context_length", None) if md else None
        if ctx and int(ctx) > 0:
            return int(ctx)
    except Exception:  # noqa: BLE001
        pass
    return DEFAULT_CTX


def map_input_char_budget(ctx: int) -> Tuple[int, int]:
    """返回 (输入 token 预算, 输入字符预算上界) 供 map 阶段切块。
    字符预算用最保守口径(1 token/字)反推。"""
    budget_tokens = max(256, ctx - MAP_MAX_TOKENS - _TEMPLATE_OVERHEAD - _SAFETY_MARGIN)
    return budget_tokens, budget_tokens


def reduce_group_token_budget(ctx: int) -> int:
    """reduce 合并阶段:一组待合并摘要的 token 预算上界。"""
    return max(256, ctx - REDUCE_MAX_TOKENS - _TEMPLATE_OVERHEAD - _SAFETY_MARGIN)
