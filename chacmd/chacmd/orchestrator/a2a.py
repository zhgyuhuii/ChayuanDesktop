"""#12 A2A 直连（纯逻辑：转发决策 + hop/TTL/环防护 + 旁路审计）。

A 的结果不经指挥系统直传 B：数据走共享卷（volume_ref 引用，大产物不塞消息），
消息走总线 pub/sub；指挥台旁路审计（每跳产审计记录）。hop/TTL + path 防环。
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace


@dataclass(frozen=True)
class A2AMessage:
    src: str
    dst: str
    payload: dict
    hop: int = 0
    ttl: int = 8
    #: 已经过的节点路径（防环）。
    path: tuple[str, ...] = ()
    #: 大产物走共享卷引用，不塞进 payload（防上下文截断）。
    volume_ref: str | None = None


@dataclass(frozen=True)
class RelayResult:
    forwarded: A2AMessage | None
    audit: dict = field(default_factory=dict)
    dropped_reason: str | None = None


def relay(msg: A2AMessage) -> RelayResult:
    """转发一跳：TTL 耗尽或成环即丢弃；否则 hop+1/ttl-1 并记审计。"""
    audit = {"src": msg.src, "dst": msg.dst, "hop": msg.hop, "ttl": msg.ttl}
    if msg.ttl <= 0:
        return RelayResult(None, audit, "ttl_exhausted")
    if msg.dst in msg.path:
        return RelayResult(None, audit, "loop")
    fwd = replace(msg, hop=msg.hop + 1, ttl=msg.ttl - 1, path=(*msg.path, msg.dst))
    return RelayResult(fwd, {**audit, "hop": fwd.hop}, None)


__all__ = ["A2AMessage", "RelayResult", "relay"]
