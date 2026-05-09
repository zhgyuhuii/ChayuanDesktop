from chayuan.server.pydantic_v1 import Field

from .tools_registry import regist_tool

from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)

@regist_tool(title="油管视频")
def search_youtube(query: str = Field(description="YouTube 视频搜索关键词(中英文均可)")):
    """搜索 YouTube 视频,返回若干条相关视频链接。需要外网访问。"""
    from langchain_community.tools import YouTubeSearchTool

    tool = YouTubeSearchTool()
    return BaseToolOutput(tool.run(tool_input=query))
