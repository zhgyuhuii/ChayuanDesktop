"""OpenWeatherMap 天气查询（海外版）。

对应国内「心知天气」的海外替代：免费 tier 每天 ~1000 次调用，全球覆盖。
langchain_community.utilities.openweathermap 已经封装好一键查询。
"""
from chayuan.server.pydantic_v1 import Field
from chayuan.server.utils import get_tool_config

from .tools_registry import regist_tool

from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)


@regist_tool(title="OpenWeatherMap 天气")
def openweather(
    location: str = Field(description="城市名称（建议英文 / 拼音，如 Beijing, Shanghai, New York）"),
):
    """OpenWeatherMap 天气查询(全球城市覆盖,需 API Key),适合查询海外城市当前天气。"""
    cfg = get_tool_config("openweather") or {}
    api_key = (cfg.get("api_key") or "").strip()
    if not api_key:
        return BaseToolOutput({
            "error": "未配置 OpenWeatherMap API Key，请到面板工具页或 openweathermap.org 申请",
        }, format="json")
    try:
        from langchain_community.utilities.openweathermap import (
            OpenWeatherMapAPIWrapper,
        )
    except ImportError:
        return BaseToolOutput({
            "error": "pyowm 未安装，请 `pip install pyowm`",
        }, format="json")

    wrapper = OpenWeatherMapAPIWrapper(openweathermap_api_key=api_key)
    try:
        result = wrapper.run(location)
    except Exception as e:  # noqa: BLE001
        return BaseToolOutput({"error": f"{type(e).__name__}: {e}"}, format="json")
    return BaseToolOutput({"location": location, "report": result}, format="json")
