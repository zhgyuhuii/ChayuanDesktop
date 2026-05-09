# LangChain 的 Shell 工具
from langchain_community.tools import ShellTool

from chayuan.server.pydantic_v1 import Field

from .tools_registry import regist_tool

from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)

@regist_tool(title="系统命令")
def shell(query: str = Field(description="要执行的 shell 命令(谨慎,默认禁用,启用前请确认 yaml 白名单)")):
    """通过 Shell 执行系统命令(高危;默认 use=false,生产环境慎开)。"""
    tool = ShellTool()
    return BaseToolOutput(tool.run(tool_input=query))
