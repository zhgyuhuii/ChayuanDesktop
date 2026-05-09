"""
简单的单参数输入工具实现，用于查询现在天气的情况
"""
import requests

from chayuan.server.pydantic_v1 import Field
from chayuan.server.utils import get_tool_config

from .tools_registry import regist_tool

from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)

@regist_tool(title="天气查询")
def weather_check(
    city: str = Field(description="城市名(精确到市/县,如 \"厦门\" / \"北京\" / \"杭州\")"),
):
    """查询指定城市的实时天气(走心知天气 API,需配置 api_key)。"""

    tool_config = get_tool_config("weather_check")
    api_key = tool_config.get("api_key")
    url = f"https://api.seniverse.com/v3/weather/now.json?key={api_key}&location={city}&language=zh-Hans&unit=c"
    response = requests.get(url)
    if response.status_code == 200:
        data = response.json()
        weather = {
            "temperature": data["results"][0]["now"]["temperature"],
            "description": data["results"][0]["now"]["text"],
        }
        return BaseToolOutput(weather)
    else:
        raise Exception(f"获取天气失败: HTTP {response.status_code}")
