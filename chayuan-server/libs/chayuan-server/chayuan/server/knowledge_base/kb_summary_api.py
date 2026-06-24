import asyncio
import json
from typing import List, Optional

from fastapi import Body
from sse_starlette import EventSourceResponse

from chayuan.settings import Settings
from chayuan.server.knowledge_base.kb_service.base import KBServiceFactory
from chayuan.server.knowledge_base.kb_summary.base import KBSummaryService
from chayuan.server.knowledge_base.kb_summary.summary_chunk import SummaryAdapter
from chayuan.server.knowledge_base.kb_summary.cache_key import content_hash, file_summary_cache_key
from chayuan.server.knowledge_base.kb_summary.oversize import summarize_precheck
from chayuan.server.knowledge_base.kb_summary import file_summary_cache as _fsc
from chayuan.server.knowledge_base.model.kb_document_model import DocumentWithVSId
from chayuan.server.knowledge_base.utils import list_files_from_folder
from chayuan.server.utils import BaseResponse, get_ChatOpenAI, wrap_done, get_default_embedding
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
                        local_wrap=True,
                    )
                    reduce_llm = get_ChatOpenAI(
                        model_name=model_name,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        local_wrap=True,
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
                    local_wrap=True,
                )
                reduce_llm = get_ChatOpenAI(
                    model_name=model_name,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    local_wrap=True,
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
            local_wrap=True,
        )
        reduce_llm = get_ChatOpenAI(
            model_name=model_name,
            temperature=temperature,
            max_tokens=max_tokens,
            local_wrap=True,
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
            kb = KBServiceFactory.get_service(knowledge_base_name, vs_type, embed_model)
            doc_infos = kb.list_docs(file_name=file_name)
            if not doc_infos:
                yield json.dumps(
                    {"code": 404, "status": "error", "msg": f"未找到文件 ‘{file_name}’ 的内容"},
                    ensure_ascii=False,
                )
                return

            texts = [getattr(d, "page_content", "") for d in doc_infos]
            key = file_summary_cache_key(file_name, content_hash(texts))

            kb_summary = KBSummaryService(knowledge_base_name, embed_model)
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

            llm = get_ChatOpenAI(
                model_name=model_name, temperature=temperature, max_tokens=max_tokens, local_wrap=True
            )
            reduce_llm = get_ChatOpenAI(
                model_name=model_name, temperature=temperature, max_tokens=max_tokens, local_wrap=True
            )
            adapter = SummaryAdapter.form_summary(
                llm=llm, reduce_llm=reduce_llm, overlap_size=Settings.kb_settings.OVERLAP_SIZE
            )

            # 逐块流式进度:把 map-reduce 放到后台线程跑,LangChain 每次 on_llm_end(每块摘要 /
            # reduce 合并各一次)往队列推进度;本(同步)生成器边 drain 边 yield。
            # 失败兜底:回调不触发 / 异常,也保证 finally 推 sentinel,生成器不会卡死;
            # 此时退化为「running →(阻塞)→ ok」单段进度。
            import queue as _queue
            import threading as _threading
            try:
                from langchain_core.callbacks import BaseCallbackHandler as _BaseCB
            except Exception:  # noqa: BLE001 — 老版本路径兜底
                from langchain.callbacks.base import BaseCallbackHandler as _BaseCB  # type: ignore

            _q: "_queue.Queue" = _queue.Queue()
            _holder: dict = {}

            class _ProgressCB(_BaseCB):  # type: ignore[misc]
                def __init__(self) -> None:
                    self.done = 0

                def on_llm_end(self, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
                    self.done += 1
                    _q.put(self.done)

            def _run() -> None:
                try:
                    _holder["docs"] = adapter.summarize(
                        file_description="", docs=doc_infos, callbacks=[_ProgressCB()]
                    )
                except Exception as _e:  # noqa: BLE001
                    _holder["err"] = _e
                finally:
                    _q.put(None)  # sentinel:无论成败都收尾,防生成器卡死

            _t = _threading.Thread(target=_run, daemon=True)
            _t.start()
            while True:
                item = _q.get()
                if item is None:
                    break
                yield json.dumps(
                    {"code": 100, "status": "progress", "done": int(item),
                     "total": total, "doc": file_name},
                    ensure_ascii=False,
                )
            _t.join(timeout=5)

            if _holder.get("err") is not None:
                raise _holder["err"]
            summary_docs = _holder.get("docs") or []
            summary_text = summary_docs[0].page_content if summary_docs else ""

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
