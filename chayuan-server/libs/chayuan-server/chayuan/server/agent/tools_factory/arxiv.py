# LangChain 的 ArxivQueryRun 工具
from chayuan.server.pydantic_v1 import Field

from .tools_registry import regist_tool

from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)

@regist_tool(title="ARXIV论文")
def arxiv(query: str = Field(description="arXiv 论文搜索关键词(英文为主,可含中文)")):
    """arXiv.org 学术论文搜索,适合查 AI / 物理 / 数学 / CS 等领域的最新预印本论文摘要与作者。"""
    from langchain_community.tools.arxiv.tool import ArxivQueryRun

    tool = ArxivQueryRun()
    return BaseToolOutput(tool.run(tool_input=query))
