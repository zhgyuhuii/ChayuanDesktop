"""上下文预算化的 map-reduce 全文总结编排(纯逻辑,不依赖 langchain)。

与 summary_chunk.SummaryAdapter(LangChain map-reduce)分离:本模块只做
「按 n_ctx 切块 + 贪心分组 + 注入式 LLM 调用」的编排;map_call/reduce_call 由
调用方注入(真机=本地 LLM invoke,测试=fake),因此无 langchain 也可单测。
"""
from __future__ import annotations

from typing import Callable, List, Optional

from chayuan.server.knowledge_base.kb_summary.token_budget import (
    estimate_tokens, map_input_char_budget, reduce_group_token_budget, MAP_CONCURRENCY,
)

_MAP_PROMPT = "请用简洁中文概括下面这段文字的要点,只输出概括内容:\n\n{context}"
_REDUCE_PROMPT = (
    "下面是同一篇文档若干段落的概括,请把它们合并成一段连贯、完整的中文摘要,"
    "保留关键信息,不要重复:\n\n{context}"
)
_FULL_PROMPT = (
    "请阅读下面这篇完整文档,用简洁、连贯的中文写一段全面的摘要,"
    "覆盖主要内容与关键信息,只输出摘要内容:\n\n{context}"
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


def _repack_to_budget(docs: List[str], char_budget: int) -> List[str]:
    """把多个 chunk 贪心合并成尽量少的、不超预算的单元:小块拼接、超长块先切分。

    RAG 常切出大量小 chunk,逐块各调一次 LLM 在慢的本地模型上极慢(每块十几秒)。
    这里把相邻小块合并填满输入预算,把 map 调用次数压到最少;每个单元字符数
    <= char_budget,保证拼进 map prompt 后仍不超 ctx。
    """
    units: List[str] = []
    buf = ""
    for d in (docs or []):
        for piece in _split_to_budget(d, char_budget):
            if not buf:
                buf = piece
            elif len(buf) + 2 + len(piece) <= char_budget:
                buf = buf + "\n\n" + piece
            else:
                units.append(buf)
                buf = piece
    if buf:
        units.append(buf)
    return units


def summarize_budgeted(
    docs: List[str],
    *,
    ctx: int,
    map_call: Callable[[str], str],
    reduce_call: Callable[[str], str],
    progress_cb: Optional[Callable[[int, int], None]] = None,
    concurrency: Optional[int] = None,
) -> str:
    """按上下文窗口预算的 map-reduce 全文总结(不依赖 LangChain token 计数)。

    先走「单次整篇」快路径:整篇能塞进模型上下文(云端大 ctx 模型几乎总是如此)就
    一次 reduce_call 直接出全文摘要——map-reduce 多次往返正是慢的根因,只有整篇超过
    ctx(超长文档 / 本地小 ctx)才退回下面的分块 map-reduce。

    map:每块(超预算先切)→ map_call;reduce:贪心分组,每组 token 预算内 →
    reduce_call,递归直到剩一段。map_call/reduce_call 由调用方注入。
    concurrency:map 阶段并行度(本地 1 / 云端 N,由调用方按模型传入)。
    """
    # —— 单次整篇快路径 ——
    full = "\n\n".join(s for s in ((d or "").strip() for d in (docs or [])) if s)
    if not full:
        return ""
    if estimate_tokens(full) <= reduce_group_token_budget(ctx):
        if progress_cb:
            progress_cb(0, 1)
        r = reduce_call(_FULL_PROMPT.format(context=full))
        if progress_cb:
            progress_cb(1, 1)
        return (r or "").strip()

    _, map_char_budget = map_input_char_budget(ctx)
    eff_budget = max(128, map_char_budget - len(_MAP_PROMPT))

    # 合并小 chunk 填满预算,显著减少 map 调用次数(原来逐 chunk 调用在慢模型上很慢)
    units = _repack_to_budget(docs, eff_budget)
    if not units:
        return ""
    total = len(units) + max(0, (len(units) - 1))
    done = 0

    # map:并行执行(顺序由 results[i] 保留,供 reduce 保持文档连贯)。真正并行度
    # 取决于本地 llama-server 是否开 --parallel 槽位 + 网关 api_concurrencies;单槽
    # CPU 下各调用在网关排队(等价串行、不报错),多槽/GPU 下显著提速。
    import concurrent.futures as _cf
    workers = max(1, min(concurrency if concurrency else MAP_CONCURRENCY, len(units)))
    results: List[str] = [""] * len(units)
    if workers == 1:
        for i, u in enumerate(units):
            r = map_call(_MAP_PROMPT.format(context=u))
            results[i] = (r or "").strip()
            done += 1
            if progress_cb:
                progress_cb(done, total)
    else:
        with _cf.ThreadPoolExecutor(max_workers=workers) as _ex:
            _futs = {_ex.submit(map_call, _MAP_PROMPT.format(context=u)): i
                     for i, u in enumerate(units)}
            for _fut in _cf.as_completed(_futs):
                i = _futs[_fut]
                try:
                    r = _fut.result()
                except Exception:  # noqa: BLE001 — 单块失败不拖垮整篇
                    r = ""
                results[i] = (r or "").strip()
                done += 1
                if progress_cb:
                    progress_cb(done, total)
    summaries: List[str] = [r for r in results if r]
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
