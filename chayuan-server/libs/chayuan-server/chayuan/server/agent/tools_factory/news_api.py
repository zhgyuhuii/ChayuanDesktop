"""NewsAPI 新闻聚合。

newsapi.org —— 聚合全球 70+ 国家、150K+ 新闻源，支持按关键词 / 国家 / 分类过滤。
免费开发者 tier 每天 100 次。
"""
from typing import Optional

import httpx

from chayuan.server.pydantic_v1 import Field
from chayuan.server.utils import get_tool_config

from .tools_registry import regist_tool

from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)


@regist_tool(title="NewsAPI 新闻")
def news_api(
    query: str = Field(description="查询关键词，空表示头条"),
    category: Optional[str] = Field(
        None, description="business / entertainment / general / health / science / sports / technology",
    ),
    country: Optional[str] = Field(None, description="ISO 2 字母国家码，如 us / cn / jp"),
):
    """Fetch recent news via newsapi.org (requires API Key)."""
    cfg = get_tool_config("news_api") or {}
    api_key = (cfg.get("api_key") or "").strip()
    if not api_key:
        return BaseToolOutput({
            "error": "未配置 NewsAPI Key，请到 https://newsapi.org 申请",
        }, format="json")

    page_size = int(cfg.get("page_size", 5) or 5)
    # 有关键词走 /everything，否则走 /top-headlines
    if (query or "").strip():
        url = "https://newsapi.org/v2/everything"
        params = {
            "q": query, "apiKey": api_key, "pageSize": page_size,
            "language": cfg.get("language", "en"),
            "sortBy": cfg.get("sort_by", "publishedAt"),
        }
    else:
        url = "https://newsapi.org/v2/top-headlines"
        params = {"apiKey": api_key, "pageSize": page_size}
        if country:
            params["country"] = country
        if category:
            params["category"] = category
    try:
        with httpx.Client(timeout=float(cfg.get("timeout", 15) or 15)) as cli:
            resp = cli.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:  # noqa: BLE001
        return BaseToolOutput({"error": f"{type(e).__name__}: {e}"}, format="json")

    articles = [
        {
            "title": a.get("title"),
            "source": (a.get("source") or {}).get("name"),
            "url": a.get("url"),
            "publishedAt": a.get("publishedAt"),
            "summary": a.get("description") or a.get("content"),
        }
        for a in (data.get("articles") or [])
    ]
    return BaseToolOutput({"query": query, "articles": articles}, format="json")
