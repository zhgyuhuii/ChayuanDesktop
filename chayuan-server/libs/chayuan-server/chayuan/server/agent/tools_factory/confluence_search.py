"""Atlassian Confluence 搜索（Cloud / 私有部署均支持）。

使用 ``atlassian-python-api``：CQL（Confluence Query Language）搜索 + 拉取页面摘要。
支持 Confluence Cloud（email+api_token）与 私有部署（username+password/token）。
"""
from typing import Optional

from chayuan.server.pydantic_v1 import Field
from chayuan.server.utils import get_tool_config

from .tools_registry import regist_tool

from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)


@regist_tool(title="Confluence 搜索")
def confluence_search(
    query: str = Field(description="搜索关键词（CQL 的 text 字段）"),
    space_key: Optional[str] = Field(
        None, description="可选：限定 space key，只在该空间内搜索",
    ),
):
    """Search Atlassian Confluence pages via CQL."""
    cfg = get_tool_config("confluence_search") or {}
    url = (cfg.get("url") or "").strip()
    if not url:
        return BaseToolOutput({
            "error": "未配置 confluence url，例如 https://your-domain.atlassian.net/wiki",
        }, format="json")

    try:
        from atlassian import Confluence
    except ImportError:
        return BaseToolOutput({
            "error": "atlassian-python-api 未安装，请 `pip install atlassian-python-api`",
        }, format="json")

    auth_kwargs = {}
    if cfg.get("api_token"):
        auth_kwargs = {
            "username": cfg.get("email") or cfg.get("username"),
            "password": cfg["api_token"],
            "cloud": bool(cfg.get("cloud", True)),
        }
    elif cfg.get("password"):
        auth_kwargs = {
            "username": cfg.get("username"),
            "password": cfg["password"],
            "cloud": False,
        }
    else:
        return BaseToolOutput({
            "error": "未配置 api_token 或 password",
        }, format="json")

    cql = f'text ~ "{query}"'
    if space_key:
        cql += f' AND space.key = "{space_key}"'

    limit = int(cfg.get("limit", 5) or 5)

    try:
        conf = Confluence(url=url, **auth_kwargs)
        hits = conf.cql(cql=cql, limit=limit)
    except Exception as e:  # noqa: BLE001
        return BaseToolOutput({"error": f"{type(e).__name__}: {e}"}, format="json")

    results = []
    for h in (hits or {}).get("results", []):
        c = h.get("content") or {}
        results.append({
            "title": c.get("title"), "type": c.get("type"),
            "space": (c.get("space") or {}).get("key"),
            "url": f"{url.rstrip('/')}/{(h.get('url') or '').lstrip('/')}",
            "id": c.get("id"),
        })
    return BaseToolOutput({"query": query, "results": results}, format="json")
