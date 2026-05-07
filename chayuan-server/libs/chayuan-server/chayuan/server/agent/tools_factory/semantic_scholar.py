"""Semantic Scholar 学术检索。

覆盖面比 arXiv 更广（含 ACM / IEEE / PubMed 等），适合跨领域文献综述。
免费，无需 API Key。
"""
from chayuan.server.pydantic_v1 import Field
from chayuan.server.utils import get_tool_config

from .tools_registry import regist_tool

from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)


@regist_tool(title="Semantic Scholar 学术检索")
def semantic_scholar(
    query: str = Field(description="英文研究主题 / 关键词"),
):
    """Search academic papers via Semantic Scholar (broader than arXiv)."""
    try:
        from langchain_community.tools.semanticscholar.tool import (
            SemanticScholarQueryRun,
        )
    except ImportError:
        return BaseToolOutput({
            "error": "semanticscholar 未安装，请 `pip install semanticscholar`",
        }, format="json")

    cfg = get_tool_config("semantic_scholar") or {}
    try:
        tool = SemanticScholarQueryRun()
        # wrapper 支持 top_k 等参数（通过 api_wrapper）
        if hasattr(tool, "api_wrapper"):
            k = int(cfg.get("top_k", 5) or 5)
            try:
                tool.api_wrapper.top_k_results = k
            except Exception:  # noqa: BLE001
                pass
        return BaseToolOutput(tool.run(tool_input=query))
    except Exception as e:  # noqa: BLE001
        return BaseToolOutput({"error": f"{type(e).__name__}: {e}"}, format="json")
