"""命中「整篇总结某文件」意图时,由 BaseModeHandler.generate_override_stream
返回本产出器,逐 token 流式吐出摘要文本(runner 的 override 段把每个 chunk 转成
token SSE → 前端像普通对话一样边出边显示)。

策略对齐 ChatPDF/Humata 等同类产品:整篇能塞进模型上下文 → 单次整篇 `astream`
逐 token 流式;装不下(超长文档)→ 退回分块 map-reduce(阻塞算完整段再吐)。

失败抛异常 → runner 的 override 段 except 捕获,answer 为空(detect 已在
retrieve 短路,故失败时得到空答,可接受)。
"""
from __future__ import annotations

import logging
from typing import Any, AsyncIterator, Dict, List

from starlette.concurrency import run_in_threadpool

logger = logging.getLogger("chayuan.chat.handlers.file_summary_stream")


async def stream_file_summary(state: Dict[str, Any]) -> AsyncIterator[str]:
    sf = state.get("summarize_file") or {}
    kb_name = sf.get("kb_name") or ""
    file_name = sf.get("file_name") or ""
    req = state["request"]
    model_name = (getattr(req, "model", "") or "").strip() or None

    from chayuan.server.knowledge_base.kb_service.base import KBServiceFactory
    from chayuan.server.knowledge_base.kb_summary.token_budget import (
        resolve_model_ctx, MAP_MAX_TOKENS, REDUCE_MAX_TOKENS, map_concurrency_for,
        fits_single_pass,
    )
    from chayuan.server.knowledge_base.kb_summary.budgeted_reduce import (
        summarize_budgeted, _FULL_PROMPT,
    )
    from chayuan.server.utils import get_ChatOpenAI

    def _fetch_texts() -> List[str]:
        kb = KBServiceFactory.get_service_by_name(kb_name)
        if kb is None:
            raise RuntimeError(f"未找到知识库 {kb_name!r}")
        doc_infos = kb.list_docs(file_name=file_name)
        texts = [getattr(d, "page_content", "") or "" for d in (doc_infos or [])]
        if not texts:
            raise RuntimeError(f"未找到文件 {file_name!r} 的内容")
        return texts

    texts = await run_in_threadpool(_fetch_texts)
    ctx = resolve_model_ctx(model_name)
    full = "\n\n".join(s for s in (t.strip() for t in texts) if s)
    single = bool(full) and fits_single_pass(full, ctx)
    logger.info(
        "[file_summary] kb=%s file=%s model=%s ctx=%s docs=%d single_pass=%s",
        kb_name, file_name, model_name, ctx, len(texts), single,
    )

    reduce_llm = get_ChatOpenAI(model_name=model_name, temperature=0.01,
                                max_tokens=REDUCE_MAX_TOKENS, streaming=True, local_wrap=False)

    if single:
        # 单次整篇:astream 逐 token 流式 → 每个 chunk 即一个对话 token
        async for chunk in reduce_llm.astream(_FULL_PROMPT.format(context=full)):
            piece = getattr(chunk, "content", "") or ""
            if piece:
                yield piece
        return

    # map-reduce 兜底(超长文档):阻塞算完再整段吐
    map_llm = get_ChatOpenAI(model_name=model_name, temperature=0.01,
                             max_tokens=MAP_MAX_TOKENS, streaming=True, local_wrap=False)

    def _compute() -> str:
        def _map(p: str) -> str:
            return getattr(map_llm.invoke(p), "content", None) or ""

        def _reduce(p: str) -> str:
            return getattr(reduce_llm.invoke(p), "content", None) or ""

        return summarize_budgeted(
            texts, ctx=ctx, map_call=_map, reduce_call=_reduce,
            concurrency=map_concurrency_for(model_name),
        )

    summary = await run_in_threadpool(_compute)
    yield summary
