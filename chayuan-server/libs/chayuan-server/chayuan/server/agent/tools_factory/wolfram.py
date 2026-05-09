# Langchain 自带的 Wolfram Alpha API 封装

from chayuan.server.pydantic_v1 import Field
from chayuan.server.utils import get_tool_config

from .tools_registry import regist_tool

from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)

@regist_tool(title="Wolfram Alpha 计算")
def wolfram(query: str = Field(description="WolframAlpha 计算公式或自然语言查询(英文表达更稳),如 ``solve x^2-4=0`` / ``integrate sin x dx``")):
    """调用 Wolfram Alpha 解决复杂数学 / 物理 / 化学 / 单位换算等需要符号运算的问题,比纯 LLM 更可靠。"""

    from langchain_community.utilities.wolfram_alpha import WolframAlphaAPIWrapper

    wolfram = WolframAlphaAPIWrapper(
        wolfram_alpha_appid=get_tool_config("wolfram").get("appid")
    )
    ans = wolfram.run(query)
    return BaseToolOutput(ans)
