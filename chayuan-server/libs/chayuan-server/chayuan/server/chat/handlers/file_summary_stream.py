"""命中「整篇总结某文件」意图时,由 BaseModeHandler.generate_override_stream
返回本产出器:复用预算化 summarize_budgeted,流式吐出摘要文本。

失败抛异常 → runner 的 override 段 except 捕获,answer 为空(detect 已在
retrieve 短路,故失败时得到空答,可接受;更强 fail-soft 见计划备注)。
"""
from __future__ import annotations

import logging
from typing import Any, AsyncIterator, Dict

from starlette.concurrency import run_in_threadpool

logger = logging.getLogger("chayuan.chat.handlers.file_summary_stream")


async def stream_file_summary(state: Dict[str, Any]) -> AsyncIterator[str]:
    sf = state.get("summarize_file") or {}
    kb_name = sf.get("kb_name") or ""
    file_name = sf.get("file_name") or ""
    req = state["request"]
    model_name = (getattr(req, "model", "") or "").strip() or None

    def _compute() -> str:
        from chayuan.server.knowledge_base.kb_service.base import KBServiceFactory
        from chayuan.server.knowledge_base.kb_summary.token_budget import (
            resolve_model_ctx, MAP_MAX_TOKENS, REDUCE_MAX_TOKENS, map_concurrency_for,
        )
        from chayuan.server.knowledge_base.kb_summary.budgeted_reduce import (
            summarize_budgeted,
        )
        from chayuan.server.utils import get_ChatOpenAI

        kb = KBServiceFactory.get_service_by_name(kb_name)
        if kb is None:
            raise RuntimeError(f"未找到知识库 {kb_name!r}")
        doc_infos = kb.list_docs(file_name=file_name)
        texts = [getattr(d, "page_content", "") or "" for d in (doc_infos or [])]
        if not texts:
            raise RuntimeError(f"未找到文件 {file_name!r} 的内容")
        ctx = resolve_model_ctx(model_name)
        logger.info(
            "[file_summary] kb=%s file=%s model=%s ctx=%s docs=%d",
            kb_name, file_name, model_name, ctx, len(texts),
        )
        map_llm = get_ChatOpenAI(model_name=model_name, temperature=0.01,
                                 max_tokens=MAP_MAX_TOKENS, streaming=True, local_wrap=False)
        reduce_llm = get_ChatOpenAI(model_name=model_name, temperature=0.01,
                                    max_tokens=REDUCE_MAX_TOKENS, streaming=True, local_wrap=False)

        def _map(p: str) -> str:
            r = map_llm.invoke(p)
            return getattr(r, "content", None) or str(r)

        def _reduce(p: str) -> str:
            r = reduce_llm.invoke(p)
            return getattr(r, "content", None) or str(r)

        return summarize_budgeted(
            texts, ctx=ctx, map_call=_map, reduce_call=_reduce,
            concurrency=map_concurrency_for(model_name),
        )

    summary = await run_in_threadpool(_compute)
    yield summary
