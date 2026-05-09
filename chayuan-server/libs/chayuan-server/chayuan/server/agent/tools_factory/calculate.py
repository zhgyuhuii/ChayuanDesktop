from chayuan.server.pydantic_v1 import Field

from .tools_registry import regist_tool


from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)

@regist_tool(title="数学计算器")
def calculate(text: str = Field(description="数学表达式,如 ``1+2*3`` / ``sin(0.5)+sqrt(2)`` / ``2**10``,由 numexpr 求值")) -> float:
    """精确数学计算工具。

    用户问到加减乘除 / 三角函数 / 幂运算 / 进位换算等可量化数学问题时调用,
    把问题翻译成 numexpr 能识别的表达式再求值;比 LLM 心算可靠。
    """
    import numexpr

    try:
        ret = str(numexpr.evaluate(text))
    except Exception as e:
        ret = f"计算失败: {e}"

    return BaseToolOutput(ret)
