# LangChain 的 WikipediaQueryRun 工具
from langchain_community.tools import WikipediaQueryRun
from langchain_community.utilities import WikipediaAPIWrapper
from chayuan.server.pydantic_v1 import Field



from .tools_registry import regist_tool

from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)

@regist_tool(title="维基百科搜索")
def wikipedia_search(query: str = Field(description="搜索关键词(中英文均可,英文条目更多)")):
    """调用维基百科 API 搜索条目摘要,适合查证背景知识、地名、人物、机构等百科类信息。"""
    api_wrapper = WikipediaAPIWrapper(lang="zh")
    tool = WikipediaQueryRun(api_wrapper=api_wrapper)
    return BaseToolOutput(tool.run(tool_input=query))
                          
                          
                          
