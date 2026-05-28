"""URL 内容抽取 — 给 chat 模式"粘 URL 当主题素材"用。

支持三档(按 Content-Type 路由):
  text/html / application/xhtml  → stdlib html.parser 去 tag + 留正文
  application/pdf                → PyMuPDF(已 deps)逐页 get_text
  其它 / text/plain              → resp.text 原文

不引入 BeautifulSoup(chayuan-server 已重,unstructured 也会拉但太大);
stdlib HTMLParser 满足"抽正文 + 去脚本/样式"这一最简需求。LLM 后续用
这段文本当 video_subject 的扩展上下文,精度要求不高。

故意不抓 youtube transcript / Wikipedia infobox / Twitter 等结构化数据 —
那些走 N6+ 专用 connector,这里只管"通用 URL → 纯文本"基础场景。
"""

from __future__ import annotations

import logging
import re
from html.parser import HTMLParser
from io import BytesIO
from typing import Optional

import requests

logger = logging.getLogger("chayuan.video_generation.url_extractor")

# 单次抓取上限 — 防被恶意 URL 喂超大文件
_FETCH_TIMEOUT_S = 15
_MAX_FETCH_BYTES = 8 * 1024 * 1024  # 8 MB

# 抽取后再截到这个上限给 LLM 当上下文 — 避免 token 爆
_MAX_OUT_CHARS = 20_000


class _TextOnlyHTMLParser(HTMLParser):
    """stdlib HTMLParser 派生:去 script/style/noscript,留正文文本节点。

    保留段落分界 — block-level tag(p/div/h*/li/br/tr 等)关闭时插入换行,
    后续给 LLM 看时段落感不丢。
    """

    _BLOCK_TAGS = frozenset({
        "p", "div", "section", "article", "header", "footer", "nav",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "li", "tr", "td", "th", "br", "hr", "blockquote", "pre",
    })
    _SKIP_TAGS = frozenset({"script", "style", "noscript", "iframe", "svg"})

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._buf: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs):  # noqa: ANN001
        if tag.lower() in self._SKIP_TAGS:
            self._skip_depth += 1
        elif tag.lower() == "br":
            self._buf.append("\n")

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t in self._SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif t in self._BLOCK_TAGS:
            self._buf.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth > 0:
            return
        if data:
            self._buf.append(data)

    def text(self) -> str:
        raw = "".join(self._buf)
        # 多余空行合并 + 行首尾 strip
        lines = [ln.strip() for ln in raw.split("\n")]
        lines = [ln for ln in lines if ln]
        return "\n".join(lines)


def _extract_html(body: bytes, encoding: Optional[str]) -> str:
    enc = (encoding or "utf-8").strip() or "utf-8"
    try:
        html = body.decode(enc, errors="replace")
    except LookupError:
        html = body.decode("utf-8", errors="replace")
    parser = _TextOnlyHTMLParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception as e:  # noqa: BLE001
        logger.warning("[url_extractor] HTML parse 失败,退化纯文本: %r", e)
        # 兜底:直接 strip 所有 <...> 标签
        return re.sub(r"<[^>]+>", "", html).strip()
    return parser.text()


def _extract_pdf(body: bytes) -> str:
    try:
        import fitz  # type: ignore[import-not-found]  # PyMuPDF
    except Exception as e:  # noqa: BLE001
        logger.warning("[url_extractor] PyMuPDF 未装,跳过 PDF: %r", e)
        return ""
    parts: list[str] = []
    try:
        doc = fitz.open(stream=BytesIO(body), filetype="pdf")
        try:
            for page in doc:
                parts.append(page.get_text())
        finally:
            doc.close()
    except Exception as e:  # noqa: BLE001
        logger.warning("[url_extractor] PyMuPDF 解析失败: %r", e)
        return ""
    return "\n".join(p.strip() for p in parts if p.strip())


def extract_url(url: str) -> dict:
    """主入口:URL → {text, content_type, source_url, truncated}.

    失败抛 ValueError 给路由层转 400/502。
    """

    if not url or not url.strip():
        raise ValueError("URL 不能为空")
    url = url.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        raise ValueError("仅支持 http(s) URL")

    try:
        # stream=True 让我们能在头部 Content-Length 大于上限时及时关闭
        resp = requests.get(
            url, timeout=_FETCH_TIMEOUT_S, stream=True,
            headers={"User-Agent": "chayuan-video-generation/1.0"},
        )
    except requests.RequestException as e:
        raise ValueError(f"抓取失败: {e}") from e

    try:
        if resp.status_code >= 400:
            raise ValueError(f"HTTP {resp.status_code}")

        cl = resp.headers.get("Content-Length")
        if cl and cl.isdigit() and int(cl) > _MAX_FETCH_BYTES:
            raise ValueError(f"内容过大 ({int(cl)>>20} MB > 8 MB 上限)")

        ct = (resp.headers.get("Content-Type") or "").lower()
        body = b""
        for chunk in resp.iter_content(chunk_size=1 << 16):
            if chunk:
                body += chunk
                if len(body) > _MAX_FETCH_BYTES:
                    raise ValueError("内容超 8 MB 上限,中止")
    finally:
        try:
            resp.close()
        except Exception:  # noqa: BLE001
            pass

    if "application/pdf" in ct or url.lower().endswith(".pdf"):
        text = _extract_pdf(body)
        kind = "pdf"
    elif "html" in ct or "xml" in ct:
        text = _extract_html(body, resp.encoding)
        kind = "html"
    elif "text" in ct or not ct:
        text = body.decode(resp.encoding or "utf-8", errors="replace")
        kind = "text"
    else:
        raise ValueError(f"不支持的 Content-Type: {ct}")

    truncated = False
    if len(text) > _MAX_OUT_CHARS:
        text = text[:_MAX_OUT_CHARS]
        truncated = True

    logger.info(
        "[url_extractor] %s kind=%s out_chars=%d truncated=%s",
        url, kind, len(text), truncated,
    )
    return {
        "text": text,
        "content_type": kind,
        "source_url": url,
        "truncated": truncated,
        "raw_bytes": len(body),
    }
