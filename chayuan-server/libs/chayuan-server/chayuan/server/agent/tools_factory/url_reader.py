"""把 URL 网页内容转成 LLM 易读的纯文本。

默认 ``auto`` 策略:优先走 jina reader 反代(``r.jina.ai``,返回去广告/导航的干净
markdown);反代不可达(无外网 / 被墙)时**自动回退直连抓取目标站点** + HTML 转纯文本。
任何失败都返回工具错误文本,**绝不抛异常打断对话流**(历史 bug:r.jina.ai 连不上时
ConnectionError 冒泡 → langchain_events_to_sse 异常 → 整轮对话中断、用户报"无法调取工具")。

工具配置(``tool_settings.yaml`` 的 ``url_reader``,均可选):
- ``timeout``:单次请求超时秒(默认 30)
- ``reader_base``:reader 反代地址(默认 ``https://r.jina.ai``;可指向自建 jina reader)
- ``mode``:``auto``(默认,反代优先、直连兜底) / ``direct``(只直连,无外网部署用) / ``jina``(只走反代)
"""
import re

import requests

from chayuan.server.pydantic_v1 import Field
from chayuan.server.utils import get_tool_config

from chayuan.server.agent.tools_factory.tools_registry import format_context

from .tools_registry import regist_tool

from langchain_chayuan.agent_toolkits.all_tools.tool import (
    BaseToolOutput,
)

_UA = "Mozilla/5.0 (compatible; ChayuanBot/1.0; +https://chayuan)"


def _html_to_text(html: str) -> str:
    """HTML → 纯文本。优先 bs4(去 script/style/导航),无 bs4 时退回正则去标签。"""
    text = ""
    try:
        from bs4 import BeautifulSoup  # 镜像通常已带;缺失则走 except

        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "noscript", "header", "footer", "nav", "form"]):
            tag.decompose()
        text = soup.get_text("\n")
    except Exception:  # noqa: BLE001 — 无 bs4 / 解析异常都退回正则
        text = re.sub(r"(?is)<(script|style)\b.*?>.*?</\1>", " ", html)
        text = re.sub(r"(?s)<[^>]+>", " ", text)
        text = re.sub(r"&nbsp;", " ", text)
    lines = [ln.strip() for ln in text.splitlines()]
    text = "\n".join(ln for ln in lines if ln)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _fetch_jina(reader_base: str, url: str, timeout: float) -> str:
    reader_url = reader_base.rstrip("/") + "/" + url
    resp = requests.get(reader_url, timeout=timeout, headers={"User-Agent": _UA})
    resp.raise_for_status()
    return resp.text or ""


def _fetch_direct(url: str, timeout: float) -> str:
    resp = requests.get(url, timeout=timeout, headers={"User-Agent": _UA})
    resp.raise_for_status()
    ctype = (resp.headers.get("content-type") or "").lower()
    body = resp.text or ""
    if "html" in ctype or "<html" in body[:2048].lower():
        return _html_to_text(body)
    return body.strip()


@regist_tool(title="URL内容阅读")
def url_reader(
        url: str = Field(
            description="The URL to be processed, so that its web content can be made more clear to read. Then provide a detailed description of the content in about 500 words. As structured as possible. ONLY THE LINK SHOULD BE PASSED IN."),
):
    """抓取并提取指定 URL 网页的纯文本正文(反代优先、直连兜底,自动去广告/导航/脚本)。
调用时机:用户在对话中给出具体链接,要你「读一下」「看看里面写什么」「总结这篇」时。
输入:完整 URL(http:// 或 https:// 开头)。
输出:网页正文纯文本。
不要用于:用户没给具体 URL 的问题、本地文件、PDF/图片(需专门工具)、需要 cookie / 登录态的页面。"""

    tool_config = get_tool_config("url_reader") or {}
    timeout = tool_config.get("timeout") or 30
    reader_base = (tool_config.get("reader_base") or "https://r.jina.ai").strip()
    mode = (tool_config.get("mode") or "auto").strip().lower()

    # 从可能是一句话的输入里抽出 URL
    match = re.search(r'http[s]?://[a-zA-Z0-9./?&=_%#:\-]+', url or "")
    url = match.group(0) if match else None
    if url is None:
        return BaseToolOutput({"error": "未识别到有效的 URL(需以 http:// 或 https:// 开头)"})

    # 尝试顺序:auto=反代优先+直连兜底;direct=只直连;jina=只反代
    attempts = []
    if mode == "direct":
        attempts = [("direct", lambda: _fetch_direct(url, timeout))]
    elif mode == "jina":
        attempts = [("jina", lambda: _fetch_jina(reader_base, url, timeout))]
    else:  # auto
        if reader_base:
            attempts.append(("jina", lambda: _fetch_jina(reader_base, url, timeout)))
        attempts.append(("direct", lambda: _fetch_direct(url, timeout)))

    errors = []
    for name, fn in attempts:
        try:
            text = (fn() or "").strip()
            if text:
                return BaseToolOutput(
                    {"result": text, "docs": [{"page_content": text, "metadata": {"source": url, "id": ""}}]},
                    format=format_context,
                )
            errors.append(f"{name}:返回空内容")
        except Exception as e:  # noqa: BLE001 — 任一手段失败转下一个;全失败优雅报错,绝不抛出打断对话
            errors.append(f"{name}:{type(e).__name__}: {e}")

    return BaseToolOutput({
        "error": (
            "网页抓取失败(" + "; ".join(errors) + ")。"
            "若服务器无外网,r.jina.ai 反代不可达;请确认目标站点在本网络可直达,"
            "或在工具配置把 url_reader 的 mode 设为 direct、或 reader_base 指向可达的 reader 服务。"
        )
    })
