"""
通过jina-ai/reader项目，将url内容处理为llm易于理解的文本形式
"""
import requests

import re

from chayuan.server.pydantic_v1 import Field
from chayuan.server.utils import get_tool_config

from chayuan.server.agent.tools_factory.tools_registry import format_context

from .tools_registry import regist_tool

from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)

@regist_tool(title="URL内容阅读")
def url_reader(
        url: str = Field(
            description="The URL to be processed, so that its web content can be made more clear to read. Then provide a detailed description of the content in about 500 words. As structured as possible. ONLY THE LINK SHOULD BE PASSED IN."),
):
    """抓取指定 URL 的网页正文(走 jina.ai 反代),让 LLM 能"点开链接"读内容。适合论坛长帖 / 博客 / 新闻摘要。"""

    tool_config = get_tool_config("url_reader")
    timeout = tool_config.get("timeout")

    # 提取url文本中的网页链接部分。url文本可能是一句话
    url_pattern = r'http[s]?://[a-zA-Z0-9./?&=_%#-]+'
    match = re.search(url_pattern, url)
    url = match.group(0) if match else None

    if url is None:
        return BaseToolOutput({"error": "No URL"})

    reader_url = "https://r.jina.ai/{url}".format(url=url)

    response = requests.get(reader_url, timeout=timeout)

    if response.status_code == 200:
        return BaseToolOutput(
            {"result": response.text, "docs": [{"page_content": response.text, "metadata": {'source': url, 'id': ''}}]},
            format=format_context)
    else:
        return BaseToolOutput({"error": "Timeout"})
