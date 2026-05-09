"""StackExchange（StackOverflow 为主）编程问答检索。

让代码助手能直接引用 StackOverflow / ServerFault / AskUbuntu 的高票答案，
免费，无需 API Key（有每日配额；批量调用建议注册 key 配额更大）。
"""
from chayuan.server.pydantic_v1 import Field
from chayuan.server.utils import get_tool_config

from .tools_registry import regist_tool

from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)


@regist_tool(title="StackExchange 编程问答")
def stackexchange(
    query: str = Field(description="英文技术问题或关键词"),
):
    """StackExchange(StackOverflow 为主)编程问答检索,适合查报错信息 / 技术疑难解答。"""
    try:
        from langchain_community.tools.stackexchange.tool import (
            StackExchangeTool,
        )
        from langchain_community.utilities.stackexchange import (
            StackExchangeAPIWrapper,
        )
    except ImportError:
        return BaseToolOutput({
            "error": "stackapi 未安装，请 `pip install stackapi`",
        }, format="json")

    cfg = get_tool_config("stackexchange") or {}
    api = StackExchangeAPIWrapper(
        max_results=int(cfg.get("max_results", 3) or 3),
        query_type=str(cfg.get("query_type", "all") or "all"),
    )
    try:
        tool = StackExchangeTool(api_wrapper=api)
        return BaseToolOutput(tool.run(tool_input=query))
    except Exception as e:  # noqa: BLE001
        return BaseToolOutput({"error": f"{type(e).__name__}: {e}"}, format="json")
