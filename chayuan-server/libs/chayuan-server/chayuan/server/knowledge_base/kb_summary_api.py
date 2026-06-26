import asyncio
import json
from typing import List, Optional

from fastapi import Body
from sse_starlette import EventSourceResponse

from chayuan.settings import Settings
from chayuan.server.knowledge_base.kb_service.base import KBServiceFactory
from chayuan.server.knowledge_base.kb_summary.base import KBSummaryService
from chayuan.server.knowledge_base.kb_summary.summary_chunk import SummaryAdapter
from chayuan.server.knowledge_base.kb_summary.cache_key import file_summary_cache_key, summary_discriminator
from chayuan.server.knowledge_base.kb_summary.oversize import summarize_precheck
from chayuan.server.knowledge_base.kb_summary import file_summary_cache as _fsc
from chayuan.server.knowledge_base.model.kb_document_model import DocumentWithVSId
from chayuan.server.knowledge_base.utils import list_files_from_folder
from chayuan.server.utils import BaseResponse, get_ChatOpenAI, wrap_done, get_default_embedding, get_default_llm
from chayuan.server.db.repository.knowledge_file_repository import get_file_detail
from chayuan.utils import build_logger


logger = build_logger()

def recreate_summary_vector_store(
    knowledge_base_name: str = Body(..., examples=["samples"]),
    allow_empty_kb: bool = Body(True),
    vs_type: str = Body(Settings.kb_settings.DEFAULT_VS_TYPE),
    embed_model: str = Body(get_default_embedding()),
    file_description: str = Body(""),
    model_name: str = Body(None, description="LLM 模型名称。"),
    temperature: float = Body(0.01, description="LLM 采样温度", ge=0.0, le=1.0),
    max_tokens: Optional[int] = Body(
        None, description="限制LLM生成Token数量，默认None代表模型最大值"
    ),
):
    """
    重建单个知识库文件摘要
    :param max_tokens:
    :param model_name:
    :param temperature:
    :param file_description:
    :param knowledge_base_name:
    :param allow_empty_kb:
    :param vs_type:
    :param embed_model:
    :return:
    """
    if max_tokens in [None, 0]:
        max_tokens = Settings.model_settings.MAX_TOKENS

    def output():
        try:
            kb = KBServiceFactory.get_service(knowledge_base_name, vs_type, embed_model)
            if not kb.exists() and not allow_empty_kb:
                yield {"code": 404, "msg": f"未找到知识库 ‘{knowledge_base_name}’"}
            else:
                ok, msg = kb.check_embed_model()
                if not ok:
                    yield {"code": 404, "msg": msg}
                else:
                    # 重新创建知识库
                    kb_summary = KBSummaryService(knowledge_base_name, embed_model)
                    kb_summary.drop_kb_summary()
                    kb_summary.create_kb_summary()

                    llm = get_ChatOpenAI(
                        model_name=model_name,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        local_wrap=False,
                    )
                    reduce_llm = get_ChatOpenAI(
                        model_name=model_name,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        local_wrap=False,
                    )
                    # 文本摘要适配器
                    summary = SummaryAdapter.form_summary(
                        llm=llm, reduce_llm=reduce_llm, overlap_size=Settings.kb_settings.OVERLAP_SIZE
                    )
                    files = list_files_from_folder(knowledge_base_name)

                    i = 0
                    for i, file_name in enumerate(files):
                        doc_infos = kb.list_docs(file_name=file_name)
                        docs = summary.summarize(
                            file_description=file_description, docs=doc_infos
                        )

                        status_kb_summary = kb_summary.add_kb_summary(
                            summary_combine_docs=docs
                        )
                        if status_kb_summary:
                            logger.info(f"({i + 1} / {len(files)}): {file_name} 总结完成")
                            yield json.dumps(
                                {
                                    "code": 200,
                                    "msg": f"({i + 1} / {len(files)}): {file_name}",
                                    "total": len(files),
                                    "finished": i + 1,
                                    "doc": file_name,
                                },
                                ensure_ascii=False,
                            )
                        else:
                            msg = f"知识库'{knowledge_base_name}'总结文件‘{file_name}’时出错。已跳过。"
                            logger.error(msg)
                            yield json.dumps(
                                {
                                    "code": 500,
                                    "msg": msg,
                                }
                            )
                        i += 1
        except asyncio.exceptions.CancelledError:
            logger.warning("streaming progress has been interrupted by user.")
            return

    return EventSourceResponse(output())


def summary_file_to_vector_store(
    knowledge_base_name: str = Body(..., examples=["samples"]),
    file_name: str = Body(..., examples=["test.pdf"]),
    allow_empty_kb: bool = Body(True),
    vs_type: str = Body(Settings.kb_settings.DEFAULT_VS_TYPE),
    embed_model: str = Body(get_default_embedding()),
    file_description: str = Body(""),
    model_name: str = Body(None, description="LLM 模型名称。"),
    temperature: float = Body(0.01, description="LLM 采样温度", ge=0.0, le=1.0),
    max_tokens: Optional[int] = Body(
        None, description="限制LLM生成Token数量，默认None代表模型最大值"
    ),
):
    """
    单个知识库根据文件名称摘要
    :param model_name:
    :param max_tokens:
    :param temperature:
    :param file_description:
    :param file_name:
    :param knowledge_base_name:
    :param allow_empty_kb:
    :param vs_type:
    :param embed_model:
    :return:
    """

    def output():
        try:
            kb = KBServiceFactory.get_service(knowledge_base_name, vs_type, embed_model)
            if not kb.exists() and not allow_empty_kb:
                yield {"code": 404, "msg": f"未找到知识库 ‘{knowledge_base_name}’"}
            else:
                # 重新创建知识库
                kb_summary = KBSummaryService(knowledge_base_name, embed_model)
                kb_summary.create_kb_summary()

                llm = get_ChatOpenAI(
                    model_name=model_name,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    local_wrap=False,
                )
                reduce_llm = get_ChatOpenAI(
                    model_name=model_name,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    local_wrap=False,
                )
                # 文本摘要适配器
                summary = SummaryAdapter.form_summary(
                    llm=llm, reduce_llm=reduce_llm, overlap_size=Settings.kb_settings.OVERLAP_SIZE
                )

                doc_infos = kb.list_docs(file_name=file_name)
                docs = summary.summarize(file_description=file_description, docs=doc_infos)

                status_kb_summary = kb_summary.add_kb_summary(summary_combine_docs=docs)
                if status_kb_summary:
                    logger.info(f" {file_name} 总结完成")
                    yield json.dumps(
                        {
                            "code": 200,
                            "msg": f"{file_name} 总结完成",
                            "doc": file_name,
                        },
                        ensure_ascii=False,
                    )
                else:
                    msg = f"知识库'{knowledge_base_name}'总结文件‘{file_name}’时出错。已跳过。"
                    logger.error(msg)
                    yield json.dumps(
                        {
                            "code": 500,
                            "msg": msg,
                        }
                    )
        except asyncio.exceptions.CancelledError:
            logger.warning("streaming progress has been interrupted by user.")
            return

    return EventSourceResponse(output())


def summary_doc_ids_to_vector_store(
    knowledge_base_name: str = Body(..., examples=["samples"]),
    doc_ids: List = Body([], examples=[["uuid"]]),
    vs_type: str = Body(Settings.kb_settings.DEFAULT_VS_TYPE),
    embed_model: str = Body(get_default_embedding()),
    file_description: str = Body(""),
    model_name: str = Body(None, description="LLM 模型名称。"),
    temperature: float = Body(0.01, description="LLM 采样温度", ge=0.0, le=1.0),
    max_tokens: Optional[int] = Body(
        None, description="限制LLM生成Token数量，默认None代表模型最大值"
    ),
) -> BaseResponse:
    """
    单个知识库根据doc_ids摘要
    :param knowledge_base_name:
    :param doc_ids:
    :param model_name:
    :param max_tokens:
    :param temperature:
    :param file_description:
    :param vs_type:
    :param embed_model:
    :return:
    """
    kb = KBServiceFactory.get_service(knowledge_base_name, vs_type, embed_model)
    if not kb.exists():
        return BaseResponse(
            code=404, msg=f"未找到知识库 {knowledge_base_name}", data={}
        )
    else:
        llm = get_ChatOpenAI(
            model_name=model_name,
            temperature=temperature,
            max_tokens=max_tokens,
            local_wrap=False,
        )
        reduce_llm = get_ChatOpenAI(
            model_name=model_name,
            temperature=temperature,
            max_tokens=max_tokens,
            local_wrap=False,
        )
        # 文本摘要适配器
        summary = SummaryAdapter.form_summary(
            llm=llm, reduce_llm=reduce_llm, overlap_size=Settings.kb_settings.OVERLAP_SIZE
        )

        doc_infos = kb.get_doc_by_ids(ids=doc_ids)
        # doc_infos转换成DocumentWithVSId包装的对象
        doc_info_with_ids = [
            DocumentWithVSId(**{**doc.dict(), "id":with_id})
            for with_id, doc in zip(doc_ids, doc_infos)
        ]

        docs = summary.summarize(
            file_description=file_description, docs=doc_info_with_ids
        )

        # 将docs转换成dict
        resp_summarize = [{**doc.dict()} for doc in docs]

        return BaseResponse(
            code=200, msg="总结完成", data={"summarize": resp_summarize}
        )


# ── 方案A:按需单文件全文总结(实时,带缓存 / 二次确认 / 流式) ─────────────────
# [INTEGRATION] 本函数依赖 langchain(SummaryAdapter)+ FAISS(KBSummaryService),
# 沙箱不可运行,仅 py_compile 通过;真实链路 + 流式 + 缓存命中需用户环境验证。
# 缓存读(_SummaryCacheStore.search_by_key)目前 TODO 返回 None(= 每次重算,正确但未提速);
# 写入已落 add_kb_summary。集成步:实现按 metadata.summary_key 的 FAISS 查询点亮缓存命中。

class _SummaryCacheStore:
    """把 KBSummaryService 适配成 file_summary_cache.SummaryStore 协议(search_by_key/put)。"""

    def __init__(self, svc: "KBSummaryService") -> None:
        self._svc = svc

    def search_by_key(self, key: str):  # noqa: ANN001
        # 命中缓存:summary 落库时 add_summary_to_db 已把 meta_data=metadata(含 summary_key)写入
        # SummaryChunkModel;这里按 meta_data["summary_key"] == key 精确查,返回 summary_context。
        # 走 DB(而非 FAISS 内部 docstore)更稳;查不到 / 异常 → None(由上层当未命中重算)。
        try:
            from chayuan.server.db.repository.knowledge_metadata_repository import (
                list_summary_from_db,
            )
            rows = list_summary_from_db(
                kb_name=self._svc.kb_name, metadata={"summary_key": key}
            )
            for r in rows:
                ctx = r.get("summary_context")
                if ctx:
                    return ctx
            return None
        except Exception as e:  # noqa: BLE001
            logger.debug("[summary-cache] search_by_key 失败,按未命中处理:%r", e)
            return None

    def put(self, key: str, summary_text: str) -> None:
        from langchain_core.documents import Document
        self._svc.add_kb_summary(
            summary_combine_docs=[Document(page_content=summary_text, metadata={"summary_key": key})]
        )


def summarize_file_now(
    knowledge_base_name: str = Body(..., examples=["samples"]),
    file_name: str = Body(..., examples=["test.pdf"]),
    confirmed: bool = Body(False, description="超大文件二次确认后置 True 再跑"),
    threshold: int = Body(60, description="超过多少 chunk 需二次确认"),
    vs_type: str = Body(Settings.kb_settings.DEFAULT_VS_TYPE),
    embed_model: str = Body(get_default_embedding()),
    model_name: str = Body(None, description="LLM 模型名称。"),
    temperature: float = Body(0.01, ge=0.0, le=1.0),
    max_tokens: Optional[int] = Body(None),
):
    """实时对单个文件做整篇 map-reduce 总结。

    流程:取全文 chunk → 命中缓存则秒回 → 超阈值未确认则 needs_confirm →
    否则 SummaryAdapter(map 阶段 LangChain 已并行)归纳 → 回写缓存 → 返回摘要文本。
    流式返回(EventSourceResponse),事件 code:200 + status:{ok|needs_confirm}。
    """

    def output():
        try:
            # 用 get_service_by_name 从 DB 读该 KB 真实的 vs_type / embed_model。
            # 不能用 get_service(kb, vs_type, embed_model)：本函数是被当普通函数调用的，
            # vs_type/embed_model 形参的 Body(...) 默认值在非 FastAPI 调用下是 Body 对象而非字符串，
            # 会让 get_service 的 if/elif 链全落空隐式返回 None（→ 'NoneType' has no attribute 'list_docs'）。
            kb = KBServiceFactory.get_service_by_name(knowledge_base_name)
            if kb is None:
                yield json.dumps(
                    {"code": 404, "status": "error", "msg": f"未找到知识库 ‘{knowledge_base_name}’"},
                    ensure_ascii=False,
                )
                return
            resolved_embed = kb.embed_model
            doc_infos = kb.list_docs(file_name=file_name)
            if not doc_infos:
                yield json.dumps(
                    {"code": 404, "status": "error", "msg": f"未找到文件 ‘{file_name}’ 的内容"},
                    ensure_ascii=False,
                )
                return

            texts = [getattr(d, "page_content", "") for d in doc_infos]
            _detail = get_file_detail(knowledge_base_name, file_name) or {}
            key = file_summary_cache_key(
                file_name, summary_discriminator(_detail.get("file_hash"), texts)
            )

            kb_summary = KBSummaryService(knowledge_base_name, resolved_embed)
            kb_summary.create_kb_summary()
            store = _SummaryCacheStore(kb_summary)

            cached = _fsc.get_cached_summary(store, key)
            if cached is not None:
                yield json.dumps(
                    {"code": 200, "status": "ok", "cached": True, "summary": cached, "doc": file_name},
                    ensure_ascii=False,
                )
                return

            pre = summarize_precheck(
                chunk_count=len(doc_infos), confirmed=confirmed, threshold=threshold
            )
            if pre.needs_confirm:
                yield json.dumps(
                    {
                        "code": 200,
                        "status": "needs_confirm",
                        "chunk_count": pre.chunk_count,
                        "est_llm_calls": pre.est_llm_calls,
                        "doc": file_name,
                    },
                    ensure_ascii=False,
                )
                return

            total = len(doc_infos) + max(1, (len(doc_infos) + 4) // 5)  # map(每块)+ reduce 粗估
            yield json.dumps(
                {"code": 100, "status": "running", "chunk_count": len(doc_infos),
                 "total": total, "doc": file_name},
                ensure_ascii=False,
            )
            logger.info(
                "[summary] start kb={!r} file={!r} chunks={} total≈{}",
                knowledge_base_name, file_name, len(doc_infos), total,
            )

            from chayuan.server.knowledge_base.kb_summary.token_budget import (
                resolve_model_ctx, MAP_MAX_TOKENS, REDUCE_MAX_TOKENS, map_concurrency_for,
            )
            from chayuan.server.knowledge_base.kb_summary.budgeted_reduce import (
                summarize_budgeted,
            )

            # model_name 为空时,resolve_model_ctx 会退到本地 4096 → 几页文档被迫 map-reduce。
            # 回退到默认 chat 模型(通常云端,真实 ctx≥32K)→ 走单次整篇快路径。
            if not model_name:
                model_name = get_default_llm()
            ctx = resolve_model_ctx(model_name)
            from chayuan.server.knowledge_base.kb_summary.token_budget import _is_local_model
            _routing = "本地(若慢,想快请在对话框选云端模型)" if (not model_name or _is_local_model(model_name)) else "云端直连"
            logger.info(
                "[summary] model={!r} ctx={} concurrency={} routing={}",
                model_name, ctx, map_concurrency_for(model_name), _routing,
            )
            # 有界 max_tokens:给输出预留固定额度,避免 max_tokens=None 被删后输出无上限。
            _map_llm = get_ChatOpenAI(
                model_name=model_name, temperature=temperature,
                max_tokens=MAP_MAX_TOKENS, streaming=True, local_wrap=False, timeout=180,
            )
            _reduce_llm = get_ChatOpenAI(
                model_name=model_name, temperature=temperature,
                max_tokens=REDUCE_MAX_TOKENS, streaming=True, local_wrap=False, timeout=180,
            )

            def _map_call(prompt: str) -> str:
                r = _map_llm.invoke(prompt)
                return getattr(r, "content", None) or str(r)

            def _reduce_call(prompt: str) -> str:
                r = _reduce_llm.invoke(prompt)
                return getattr(r, "content", None) or str(r)

            texts_for_summary = [getattr(d, "page_content", "") or "" for d in doc_infos]

            from chayuan.server.knowledge_base.kb_summary.token_budget import (
                fits_single_pass,
            )
            from chayuan.server.knowledge_base.kb_summary.budgeted_reduce import (
                _FULL_PROMPT,
            )

            import time as _wallclock
            _t0 = _wallclock.time()

            _full = "\n\n".join(s for s in (t.strip() for t in texts_for_summary) if s)
            summary_text = ""

            if _full and fits_single_pass(_full, ctx):
                # —— 单次整篇:整篇能塞进 ctx → llm.stream() 逐 token 流式推送(像 ChatGPT),
                #    用户 1-2 秒就看到字在动,不再对着进度条干等。每个 delta 即天然进度+心跳。
                _acc: list = []
                _reasoned = False
                for _chunk in _reduce_llm.stream(_FULL_PROMPT.format(context=_full)):
                    _piece = getattr(_chunk, "content", "") or ""
                    if not _piece:
                        # 推理模型在出答案前先"想"一大段:此时 content 为空、reasoning_content 在流。
                        # 推一个 progress 心跳让前端显示「思考中…」,避免看着像卡死(只在首段推一次足够)。
                        _ak = getattr(_chunk, "additional_kwargs", None) or {}
                        if not _reasoned and (_ak.get("reasoning_content") or _ak.get("reasoning")):
                            _reasoned = True
                            yield json.dumps(
                                {"code": 100, "status": "progress", "done": 0, "total": 1,
                                 "message": "模型思考中…", "doc": file_name},
                                ensure_ascii=False,
                            )
                        continue
                    _acc.append(_piece)
                    yield json.dumps(
                        {"code": 100, "status": "delta", "text": _piece, "doc": file_name},
                        ensure_ascii=False,
                    )
                summary_text = "".join(_acc).strip()
                logger.info(
                    "[summary] done(stream) kb={!r} file={!r} model={!r} ctx={} reasoned={} "
                    "elapsed={:.1f}s len={}",
                    knowledge_base_name, file_name, model_name, ctx, _reasoned,
                    _wallclock.time() - _t0, len(summary_text),
                )
            else:
                # —— map-reduce 兜底(超长文档,装不下单次整篇):线程跑 + 进度帧 ——
                import queue as _queue
                import threading as _threading

                _q: "_queue.Queue" = _queue.Queue()
                _holder: dict = {}

                def _run() -> None:
                    try:
                        _holder["summary"] = summarize_budgeted(
                            texts_for_summary, ctx=ctx,
                            map_call=_map_call, reduce_call=_reduce_call,
                            concurrency=map_concurrency_for(model_name),
                            progress_cb=lambda done, _total: _q.put(done),
                        )
                    except Exception as _e:  # noqa: BLE001
                        _holder["err"] = _e
                    finally:
                        _q.put(None)  # sentinel:无论成败都收尾,防生成器卡死

                import time as _time
                _t = _threading.Thread(target=_run, daemon=True)
                _t.start()
                _deadline = _time.time() + 900  # 整体硬超时 15min,保证 SSE 一定收尾、不无限转圈
                while True:
                    try:
                        item = _q.get(timeout=30)
                    except _queue.Empty:
                        if not _t.is_alive():
                            break  # 线程已退出却没放 sentinel(异常路径)→ 收尾
                        if _time.time() > _deadline:
                            _holder["err"] = TimeoutError("全文总结超时(>900s),已中止")
                            break
                        continue
                    if item is None:
                        break
                    yield json.dumps(
                        {"code": 100, "status": "progress", "done": int(item),
                         "total": total, "doc": file_name},
                        ensure_ascii=False,
                    )
                    logger.info("[summary] progress {}/{} kb={!r} file={!r}", item, total, knowledge_base_name, file_name)
                _t.join(timeout=5)

                if _holder.get("err") is not None:
                    raise _holder["err"]
                summary_text = _holder.get("summary") or ""
                logger.info(
                    "[summary] done(map-reduce) kb={!r} file={!r} model={!r} ctx={} "
                    "elapsed={:.1f}s len={}",
                    knowledge_base_name, file_name, model_name, ctx,
                    _wallclock.time() - _t0, len(summary_text),
                )

            _fsc.put_summary(store, key, summary_text)

            yield json.dumps(
                {"code": 200, "status": "ok", "cached": False, "summary": summary_text, "doc": file_name},
                ensure_ascii=False,
            )
        except asyncio.exceptions.CancelledError:
            logger.warning("summarize_file_now interrupted by user.")
            return
        except Exception as e:  # noqa: BLE001
            logger.exception("summarize_file_now 失败")
            yield json.dumps(
                {"code": 500, "status": "error", "msg": f"全文总结失败:{e}"}, ensure_ascii=False
            )

    return EventSourceResponse(output())
