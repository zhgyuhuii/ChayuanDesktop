"""#15 外部数据接入（归一化 + 信任分级 + 默认不直接驱动高权限 agent）。"""

from chacmd.domain.charter import Charter, Trigger
from chacmd.orchestrator.external_data import gated_triggers, normalize


def test_normalize_tags_trust():
    assert normalize("webhook", "order_created", {"id": 1}).trust == "external"
    assert normalize("internal", "tick", {}).trust == "internal"


def test_external_default_does_not_fire_triggers():
    c = Charter(identity="w", goal="g", triggers=(Trigger(on="order_created", action="dispatch:handle"),))
    nev = normalize("webhook", "order_created", {})
    # 默认外部事件不直接驱动
    assert gated_triggers(c, nev) == []


def test_external_fires_when_explicitly_allowed():
    c = Charter(identity="w", goal="g", triggers=(Trigger(on="order_created", action="dispatch:handle"),))
    nev = normalize("webhook", "order_created", {})
    assert gated_triggers(c, nev, allow_external=True) == ["dispatch:handle"]


def test_trusted_source_fires_triggers():
    c = Charter(identity="w", goal="g", triggers=(Trigger(on="tick", action="poll"),))
    nev = normalize("internal", "tick", {})
    assert gated_triggers(c, nev) == ["poll"]
