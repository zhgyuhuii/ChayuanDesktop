"""#15 外部数据接入（归一化 + 信任分级 + 触发门控，纯逻辑）。

某容器可拉数据(轮询)/接数据(webhook/MQ)/感知外部数据(事件触发编排)；信任分级：
外部来源默认降权（trust=external），**默认不直接驱动高权限 agent**（NFR-SEC4 间接注入防护），
仅在显式 allow_external 时才让外部事件命中 charter 触发。
"""

from __future__ import annotations

from dataclasses import dataclass

from chacmd.api.taskapi import trust_level
from chacmd.domain.charter import Charter, match_triggers
from chacmd.domain.events import Event


@dataclass(frozen=True)
class NormalizedEvent:
    kind: str
    payload: dict
    trust: str
    source: str


def normalize(source: str, kind: str, payload: dict) -> NormalizedEvent:
    """把外部输入归一化为带信任级的事件。"""
    return NormalizedEvent(kind=kind, payload=payload, trust=trust_level(source), source=source)


def gated_triggers(charter: Charter, nevent: NormalizedEvent, allow_external: bool = False) -> list[str]:
    """外部事件命中的 charter 触发动作；external 信任默认不驱动（除非 allow_external）。"""
    if nevent.trust == "external" and not allow_external:
        return []
    ev = Event(
        job_id="external",
        task_id="external",
        container=nevent.source,
        kind=nevent.kind,
        seq=0,
        payload=nevent.payload,
    )
    return match_triggers(charter, ev)


__all__ = ["NormalizedEvent", "normalize", "gated_triggers"]
