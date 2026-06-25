"""上下文预算化的 map-reduce 全文总结编排(纯逻辑,不依赖 langchain)。

与 summary_chunk.SummaryAdapter(LangChain map-reduce)分离:本模块只做
「按 n_ctx 切块 + 贪心分组 + 注入式 LLM 调用」的编排;map_call/reduce_call 由
调用方注入(真机=本地 LLM invoke,测试=fake),因此无 langchain 也可单测。
"""
from __future__ import annotations

from typing import Callable, List, Optional

from chayuan.server.knowledge_base.kb_summary.token_budget import (
    estimate_tokens, map_input_char_budget, reduce_group_token_budget,
)

_MAP_PROMPT = "请用简洁中文概括下面这段文字的要点,只输出概括内容:\n\n{context}"
_REDUCE_PROMPT = (
    "下面是同一篇文档若干段落的概括,请把它们合并成一段连贯、完整的中文摘要,"
    "保留关键信息,不要重复:\n\n{context}"
)


def _split_to_budget(text: str, char_budget: int) -> List[str]:
    """把超长文本按字符预算切成多段(段落优先,其次硬切)。"""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= char_budget:
        return [text]
    parts: List[str] = []
    buf = ""
    for para in text.split("\n"):
        if len(para) > char_budget:
            if buf:
                parts.append(buf); buf = ""
            for i in range(0, len(para), char_budget):
                parts.append(para[i:i + char_budget])
            continue
        if len(buf) + len(para) + 1 > char_budget:
            parts.append(buf); buf = para
        else:
            buf = (buf + "\n" + para) if buf else para
    if buf:
        parts.append(buf)
    return parts


def summarize_budgeted(
    docs: List[str],
    *,
    ctx: int,
    map_call: Callable[[str], str],
    reduce_call: Callable[[str], str],
    progress_cb: Optional[Callable[[int, int], None]] = None,
) -> str:
    """按上下文窗口预算的 map-reduce 全文总结(不依赖 LangChain token 计数)。

    map:每块(超预算先切)→ map_call;reduce:贪心分组,每组 token 预算内 →
    reduce_call,递归直到剩一段。map_call/reduce_call 由调用方注入。
    """
    _, map_char_budget = map_input_char_budget(ctx)
    eff_budget = max(128, map_char_budget - len(_MAP_PROMPT))

    units: List[str] = []
    for d in (docs or []):
        units.extend(_split_to_budget(d, eff_budget))
    if not units:
        return ""
    total = len(units) + max(0, (len(units) - 1))
    done = 0
    summaries: List[str] = []
    for u in units:
        s = map_call(_MAP_PROMPT.format(context=u))
        if s and s.strip():
            summaries.append(s.strip())
        done += 1
        if progress_cb:
            progress_cb(done, total)
    if not summaries:
        return ""
    if len(summaries) == 1:
        return summaries[0]

    group_budget = reduce_group_token_budget(ctx)
    while len(summaries) > 1:
        groups: List[List[str]] = []
        cur: List[str] = []
        cur_tok = 0
        for s in summaries:
            t = estimate_tokens(s)
            if cur and cur_tok + t > group_budget:
                groups.append(cur); cur = []; cur_tok = 0
            cur.append(s); cur_tok += t
        if cur:
            groups.append(cur)
        if len(groups) == len(summaries):
            return "\n\n".join(summaries)
        merged: List[str] = []
        for g in groups:
            r = reduce_call(_REDUCE_PROMPT.format(context="\n\n".join(g)))
            merged.append((r or "").strip())
            done += 1
            if progress_cb:
                progress_cb(done, total)
        summaries = [m for m in merged if m]
    return summaries[0] if summaries else ""
