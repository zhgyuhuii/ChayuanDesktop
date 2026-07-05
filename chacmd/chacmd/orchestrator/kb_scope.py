"""#19 知识源范围授权 scope filter（纯逻辑）。

检索前把请求的 ku_ids 按主体授权集过滤，剔除越界库并给诊断理由，
避免"答非所问/越权检索"。授权粒度：
- 精确：doc:backend / src:db1 / office:alice
- 类型通配：doc:* （该类型全部）
- 全通配：*
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass


@dataclass(frozen=True)
class ScopeDecision:
    allowed: tuple[str, ...]
    #: (ku_id, 剔除理由)
    denied: tuple[tuple[str, str], ...]


def _kind_of(ku: str) -> str:
    return ku.split(":", 1)[0] if ":" in ku else ku


def _permitted(ku: str, grants: set[str]) -> bool:
    if "*" in grants:
        return True
    if ku in grants:
        return True
    return f"{_kind_of(ku)}:*" in grants


def filter_ku_ids(grants: Iterable[str], requested: Iterable[str]) -> ScopeDecision:
    gs = set(grants)
    allowed: list[str] = []
    denied: list[tuple[str, str]] = []
    for ku in requested:
        if _permitted(ku, gs):
            allowed.append(ku)
        else:
            denied.append((ku, f"越界：{ku} 不在主体授权的知识源范围内"))
    return ScopeDecision(tuple(allowed), tuple(denied))


__all__ = ["ScopeDecision", "filter_ku_ids"]
