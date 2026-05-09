import logging
from urllib.parse import urlencode

from chayuan.settings import Settings
from chayuan.server.agent.tools_factory.tools_registry import (
    regist_tool,
    format_context,
)

from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)
from chayuan.server.knowledge_base.kb_api import list_kbs
from chayuan.server.knowledge_base.kb_doc_api import search_docs
from chayuan.server.pydantic_v1 import Field
from chayuan.server.utils import get_tool_config

logger = logging.getLogger(__name__)

template = (
    "从以下本地知识库之一检索信息(仅适用于本地已建好的知识):\n{KB_info}\n"
    "调用时 ``database`` 必须是上面列出的某一项,例如 [{key}]。"
)
KB_info_str = "\n".join([f"{key}: {value}" for key, value in Settings.kb_settings.KB_INFO.items()])
template_knowledge = template.format(KB_info=KB_info_str, key="samples")


def _safe_kb_choices() -> list[str]:
    """import 期 DB 不可达时返回空 list，让 API 进程仍能启动。

    历史 bug：本模块顶层 `choices=[kb.kb_name for kb in list_kbs().data]` 在 import
    时就触发 SQLAlchemy 连 PG，PG 不可达 → 整个 API 进程 import 失败 crash。
    DB 恢复 + chayuan 重启后，choices 自动重新拉取。
    """
    try:
        return [kb.kb_name for kb in list_kbs().data]
    except Exception as e:  # noqa: BLE001 — 任何 DB / 反射错都软降级
        logger.warning(
            "list_kbs() failed at module import (DB likely unreachable); "
            "search_local_knowledgebase tool will register without an enum "
            "of KB names. Fix DB then restart. Cause: %s: %s",
            type(e).__name__, e,
        )
        return []


def search_knowledgebase(query: str, database: str, config: dict):
    docs = search_docs(
        query=query,
        knowledge_base_name=database,
        top_k=config["top_k"],
        score_threshold=config["score_threshold"],
        file_name="",
        metadata={},
    )
    return {"knowledge_base": database, "docs": docs}


@regist_tool(description=template_knowledge, title="本地知识库")
def search_local_knowledgebase(
    database: str = Field(
        description="要检索的本地知识库名(必须是已建好的 KB 之一,见 prompt 中的清单)",
        choices=_safe_kb_choices(),
    ),
    query: str = Field(description="检索关键词,会做语义搜索召回 Top-K 文档片段拼入 prompt"),
):
    """"""
    tool_config = get_tool_config("search_local_knowledgebase")
    ret = search_knowledgebase(query=query, database=database, config=tool_config)
    return BaseToolOutput(ret, format=format_context)
