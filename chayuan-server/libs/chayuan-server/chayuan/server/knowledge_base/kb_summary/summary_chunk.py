import asyncio
import logging
import sys
from typing import List, Optional

try:
    from langchain_classic.chains import LLMChain, StuffDocumentsChain
    from langchain_classic.chains.combine_documents.map_reduce import (
        MapReduceDocumentsChain,
        ReduceDocumentsChain,
    )
    from langchain_core.documents import Document
    try:
        from langchain_core.output_parsers import RegexParser
    except Exception:
        try:
            from langchain_classic.output_parsers.regex import RegexParser
        except Exception:
            from langchain.output_parsers.regex import RegexParser
    from langchain_core.prompts import PromptTemplate
    from langchain_core.language_models import BaseLanguageModel
    _LANGCHAIN_AVAILABLE = True
except ImportError:
    _LANGCHAIN_AVAILABLE = False
    # Provide stubs so type annotations don't break at class-definition time
    MapReduceDocumentsChain = object  # type: ignore[assignment,misc]
    BaseLanguageModel = object  # type: ignore[assignment,misc]

try:
    from chayuan.server.knowledge_base.model.kb_document_model import DocumentWithVSId
except ImportError:
    DocumentWithVSId = object  # type: ignore[assignment,misc]

from chayuan.utils import build_logger
from chayuan.server.knowledge_base.kb_summary.token_budget import (
    estimate_tokens, map_input_char_budget, reduce_group_token_budget,
)


logger = build_logger()


class SummaryAdapter:
    _OVERLAP_SIZE: int
    token_max: int
    _separator: str = "\n\n"
    chain: MapReduceDocumentsChain

    def __init__(
        self, overlap_size: int, token_max: int, chain: MapReduceDocumentsChain
    ):
        self._OVERLAP_SIZE = overlap_size
        self.chain = chain
        self.token_max = token_max

    @classmethod
    def form_summary(
        cls,
        llm: BaseLanguageModel,
        reduce_llm: BaseLanguageModel,
        overlap_size: int,
        token_max: int = 1300,
    ):
        """
        获取实例
        :param reduce_llm: 用于合并摘要的llm
        :param llm: 用于生成摘要的llm
        :param overlap_size: 重叠部分大小
        :param token_max: 最大的chunk数量，每个chunk长度小于token_max长度，第一次生成摘要时，大于token_max长度的摘要会报错
        :return:
        """

        # This controls how each document will be formatted. Specifically,
        document_prompt = PromptTemplate(
            input_variables=["page_content"], template="{page_content}"
        )

        # The prompt here should take as an input variable the
        # `document_variable_name`
        prompt_template = (
            "根据文本执行任务。以下任务信息"
            "{task_briefing}"
            "文本内容如下: "
            "\r\n"
            "{context}"
        )
        prompt = PromptTemplate(
            template=prompt_template, input_variables=["task_briefing", "context"]
        )
        llm_chain = LLMChain(llm=llm, prompt=prompt)
        # We now define how to combine these summaries
        reduce_prompt = PromptTemplate.from_template(
            "Combine these summaries: {context}"
        )
        reduce_llm_chain = LLMChain(llm=reduce_llm, prompt=reduce_prompt)

        document_variable_name = "context"
        combine_documents_chain = StuffDocumentsChain(
            llm_chain=reduce_llm_chain,
            document_prompt=document_prompt,
            document_variable_name=document_variable_name,
        )
        reduce_documents_chain = ReduceDocumentsChain(
            token_max=token_max,
            combine_documents_chain=combine_documents_chain,
        )
        chain = MapReduceDocumentsChain(
            llm_chain=llm_chain,
            document_variable_name=document_variable_name,
            reduce_documents_chain=reduce_documents_chain,
            # 返回中间步骤
            return_intermediate_steps=True,
        )
        return cls(overlap_size=overlap_size, chain=chain, token_max=token_max)

    _MAP_PROMPT = (
        "请用简洁中文概括下面这段文字的要点,只输出概括内容:\n\n{context}"
    )
    _REDUCE_PROMPT = (
        "下面是同一篇文档若干段落的概括,请把它们合并成一段连贯、完整的中文摘要,"
        "保留关键信息,不要重复:\n\n{context}"
    )

    @staticmethod
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

    @classmethod
    def summarize_budgeted(
        cls,
        docs: List[str],
        *,
        ctx: int,
        map_call,
        reduce_call,
        progress_cb=None,
    ) -> str:
        """按上下文窗口预算的 map-reduce 全文总结(不依赖 LangChain token 计数)。

        map:每块(超预算先切)→ map_call;reduce:贪心分组,每组 token 预算内 →
        reduce_call,递归直到剩一段。map_call/reduce_call 由调用方注入。
        """
        _, map_char_budget = map_input_char_budget(ctx)
        eff_budget = max(128, map_char_budget - len(cls._MAP_PROMPT))

        units: List[str] = []
        for d in (docs or []):
            units.extend(cls._split_to_budget(d, eff_budget))
        if not units:
            return ""
        total = len(units) + max(0, (len(units) - 1))
        done = 0
        summaries: List[str] = []
        for u in units:
            s = map_call(cls._MAP_PROMPT.format(context=u))
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
                r = reduce_call(cls._REDUCE_PROMPT.format(context="\n\n".join(g)))
                merged.append((r or "").strip())
                done += 1
                if progress_cb:
                    progress_cb(done, total)
            summaries = [m for m in merged if m]
        return summaries[0] if summaries else ""

    def summarize(
        self, file_description: str, docs: List[DocumentWithVSId] = [], callbacks=None
    ) -> List:
        if sys.version_info < (3, 10):
            loop = asyncio.get_event_loop()
        else:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()

            asyncio.set_event_loop(loop)
        # 同步调用协程代码
        return loop.run_until_complete(
            self.asummarize(file_description=file_description, docs=docs, callbacks=callbacks)
        )

    async def asummarize(
        self, file_description: str, docs: List[DocumentWithVSId] = [], callbacks=None
    ) -> List:
        logger.info("start summary")
        """
        这个过程分成两个部分：
        1. 对每个文档进行处理，得到每个文档的摘要
         map_results = self.llm_chain.apply(
            # FYI - this is parallelized and so it is fast.
            [{self.document_variable_name: d.page_content, **kwargs} for d in docs],
            callbacks=callbacks,
        )
        2. 对每个文档的摘要进行合并，得到最终的摘要，return_intermediate_steps=True，返回中间步骤
        result, extra_return_dict = self.reduce_documents_chain.combine_docs(
            result_docs, token_max=token_max, callbacks=callbacks, **kwargs
        )
        """
        summary_combine, summary_intermediate_steps = self.chain.combine_docs(
            docs=docs,
            task_briefing="描述不同方法之间的接近度和相似性，"
            "以帮助读者理解它们之间的关系。",
            callbacks=callbacks,
        )
        print(summary_combine)
        print(summary_intermediate_steps)

        # if len(summary_combine) == 0:
        #     # 为空重新生成，数量减半
        #     result_docs = [
        #         Document(page_content=question_result_key, metadata=docs[i].metadata)
        #         # This uses metadata from the docs, and the textual results from `results`
        #         for i, question_result_key in enumerate(
        #             summary_intermediate_steps["intermediate_steps"][
        #             :len(summary_intermediate_steps["intermediate_steps"]) // 2
        #             ])
        #     ]
        #     summary_combine, summary_intermediate_steps = self.chain.reduce_documents_chain.combine_docs(
        #         result_docs, token_max=self.token_max
        #     )
        logger.info("end summary")
        doc_ids = ",".join([doc.id for doc in docs])
        _metadata = {
            "file_description": file_description,
            "summary_intermediate_steps": summary_intermediate_steps,
            "doc_ids": doc_ids,
        }
        if _LANGCHAIN_AVAILABLE:
            from langchain_core.documents import Document
            summary_combine_doc = Document(page_content=summary_combine, metadata=_metadata)
        else:
            summary_combine_doc = {"page_content": summary_combine, "metadata": _metadata}

        return [summary_combine_doc]

    def _drop_overlap(self, docs: List[DocumentWithVSId]) -> List[str]:
        """
         # 将文档中page_content句子叠加的部分去掉
        :param docs:
        :param separator:
        :return:
        """
        merge_docs = []

        pre_doc = None
        for doc in docs:
            # 第一个文档直接添加
            if len(merge_docs) == 0:
                pre_doc = doc.page_content
                merge_docs.append(doc.page_content)
                continue

            # 列表中上一个结尾与下一个开头重叠的部分，删除下一个开头重叠的部分
            # 迭代递减pre_doc的长度，每次迭代删除前面的字符，
            # 查询重叠部分，直到pre_doc的长度小于 self._OVERLAP_SIZE // 2 - 2len(separator)
            for i in range(
                len(pre_doc), self._OVERLAP_SIZE // 2 - 2 * len(self._separator), -1
            ):
                # 每次迭代删除前面的字符
                pre_doc = pre_doc[1:]
                if doc.page_content[: len(pre_doc)] == pre_doc:
                    # 删除下一个开头重叠的部分
                    merge_docs.append(doc.page_content[len(pre_doc) :])
                    break

            pre_doc = doc.page_content

        return merge_docs

    def _join_docs(self, docs: List[str]) -> Optional[str]:
        text = self._separator.join(docs)
        text = text.strip()
        if text == "":
            return None
        else:
            return text


if __name__ == "__main__":
    docs = [
        "梦者有特别的作用，也就是说梦是在预卜未来。因此，梦内容的",
        "梦内容的多彩多姿以及对梦者本身所遗留的特殊印象，使他们很难想象",
        "使他们很难想象出一套系统划一的观念，而需要以其个别的价值与可靠性作各",
        "值与可靠性作各种不同的分化与聚合。因此，古代哲学家们对梦的评价也就完全",
    ]
    _OVERLAP_SIZE = 1
    separator: str = "\n\n"
    merge_docs = []
    # 将文档中page_content句子叠加的部分去掉，
    # 列表中上一个结尾与下一个开头重叠的部分，删除下一个开头重叠的部分
    pre_doc = None
    for doc in docs:
        # 第一个文档直接添加
        if len(merge_docs) == 0:
            pre_doc = doc
            merge_docs.append(doc)
            continue

        # 列表中上一个结尾与下一个开头重叠的部分，删除下一个开头重叠的部分
        # 迭代递减pre_doc的长度，每次迭代删除前面的字符，
        # 查询重叠部分，直到pre_doc的长度小于 _OVERLAP_SIZE-2len(separator)
        for i in range(len(pre_doc), _OVERLAP_SIZE - 2 * len(separator), -1):
            # 每次迭代删除前面的字符
            pre_doc = pre_doc[1:]
            if doc[: len(pre_doc)] == pre_doc:
                # 删除下一个开头重叠的部分
                page_content = doc[len(pre_doc) :]
                merge_docs.append(page_content)

                pre_doc = doc
                break

    # 将merge_docs中的句子合并成一个文档
    text = separator.join(merge_docs)
    text = text.strip()

    print(text)
