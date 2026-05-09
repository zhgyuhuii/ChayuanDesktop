"""Yahoo Finance 财经新闻。

按股票代码（如 AAPL / TSLA / 00700.HK）拉取近期新闻摘要，免费无需 Key。
"""
from chayuan.server.pydantic_v1 import Field

from .tools_registry import regist_tool

from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)


@regist_tool(title="Yahoo 财经新闻")
def yahoo_finance_news(
    query: str = Field(description="股票代码或公司简称，如 AAPL / TSLA / 00700.HK"),
):
    """查询 Yahoo Finance 上指定股票代码 / 公司的最近财经新闻(如 AAPL / TSLA / 00700.HK)。"""
    try:
        from langchain_community.tools.yahoo_finance_news import (
            YahooFinanceNewsTool,
        )
    except ImportError:
        return BaseToolOutput({
            "error": "yfinance 未安装，请 `pip install yfinance`",
        }, format="json")

    try:
        tool = YahooFinanceNewsTool()
        return BaseToolOutput(tool.run(tool_input=query))
    except Exception as e:  # noqa: BLE001
        return BaseToolOutput({"error": f"{type(e).__name__}: {e}"}, format="json")
