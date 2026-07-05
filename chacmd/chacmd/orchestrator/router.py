"""#5 统一调度对话框 NL 路由（快慢双路）。

- 快路（确定性，NFR-P2 热路径禁 LLM）：@昵称正则直取；关键词规则命中。
- 慢路（冷启兜底）：前两路都未命中，才落 LLM（chayuan.chat_completions）分类；
  结果须在已知昵称集内（防幻觉）。
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Protocol

_AT = re.compile(r"@(\w+)", re.UNICODE)


@dataclass(frozen=True)
class RouteRule:
    keywords: tuple[str, ...]
    nickname: str


@dataclass(frozen=True)
class RouteResult:
    nickname: str | None
    confidence: float
    path: str  # "fast" | "rule" | "llm" | "none"


class _LLM(Protocol):
    async def chat_completions(self, model: str, messages: list[dict], **kw: Any) -> dict: ...


def _llm_content(resp: dict) -> str:
    try:
        return str(resp["choices"][0]["message"]["content"]).strip()
    except (KeyError, IndexError, TypeError):
        return ""


async def route(
    text: str,
    known_nicknames: Iterable[str],
    rules: Iterable[RouteRule],
    chayuan: _LLM | None = None,
    *,
    model: str = "route-classifier",
) -> RouteResult:
    known = set(known_nicknames)

    # 1) 快路：@昵称直取（须在已知集）
    for m in _AT.finditer(text):
        if m.group(1) in known:
            return RouteResult(m.group(1), 1.0, "fast")

    # 2) 规则路：关键词命中，按命中数取最高
    best: RouteRule | None = None
    best_hits = 0
    for r in rules:
        hits = sum(1 for k in r.keywords if k in text)
        if hits > best_hits:
            best, best_hits = r, hits
    if best is not None and best_hits > 0:
        confidence = min(1.0, 0.5 + 0.1 * best_hits)
        return RouteResult(best.nickname, confidence, "rule")

    # 3) 慢路：LLM 冷启分类（结果须在已知集内，防幻觉）
    if chayuan is not None:
        prompt = (
            "从下列已注册数字员工昵称中，选出最适合处理该请求的一个，只回昵称本身：\n"
            f"昵称集：{', '.join(sorted(known))}\n请求：{text}"
        )
        resp = await chayuan.chat_completions(model=model, messages=[{"role": "user", "content": prompt}])
        pick = _llm_content(resp)
        if pick in known:
            return RouteResult(pick, 0.6, "llm")

    return RouteResult(None, 0.0, "none")


__all__ = ["RouteRule", "RouteResult", "route"]
