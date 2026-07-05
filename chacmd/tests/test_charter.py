"""#18 角色契约 Charter（声明式身份/目标/技能/知识范围/触发/交接）。

验收：数据来了 agent 知道做啥（trigger）、知道下一步传给谁（handoff）；派活注入 system_prompt。
"""

from chacmd.domain.charter import (
    Charter,
    Handoff,
    Trigger,
    match_triggers,
    render_system_prompt,
    resolve_handoff,
)
from chacmd.domain.events import Event


def _ev(kind: str, payload=None) -> Event:
    return Event("j1", "j1", "dev", kind, 0, payload or {})


def test_render_system_prompt_includes_goal_and_scope():
    c = Charter(
        identity="dev",
        goal="实现登录功能",
        system_prompt="你是资深工程师。",
        skills=("code", "test"),
        knowledge_scope=("doc:backend", "src:db1"),
    )
    p = render_system_prompt(c)
    assert "你是资深工程师。" in p
    assert "实现登录功能" in p
    assert "code" in p and "test" in p
    assert "doc:backend" in p


def test_match_triggers_hits_on_kind():
    c = Charter(
        identity="watcher",
        goal="监控",
        triggers=(Trigger(on="data_arrived", action="dispatch:analyze"),),
    )
    assert match_triggers(c, _ev("data_arrived")) == ["dispatch:analyze"]
    assert match_triggers(c, _ev("progress")) == []


def test_match_triggers_wildcard_and_payload_predicate():
    c = Charter(
        identity="w",
        goal="g",
        triggers=(
            Trigger(on="*", action="log"),
            Trigger(on="alert", action="escalate", when="critical"),
        ),
    )
    # 通配 on 命中任意 kind
    assert "log" in match_triggers(c, _ev("progress"))
    # 带 payload 谓词：payload 含 key 才触发
    assert "escalate" in match_triggers(c, _ev("alert", {"critical": True}))
    assert "escalate" not in match_triggers(c, _ev("alert", {}))


def test_resolve_handoff_routes_by_outcome():
    c = Charter(
        identity="dev",
        goal="g",
        handoffs=(Handoff(on_outcome="succeeded", to="reviewer"),),
        supervisor="lead",
    )
    assert resolve_handoff(c, "succeeded") == "reviewer"


def test_resolve_handoff_falls_back_to_supervisor():
    c = Charter(identity="dev", goal="g", handoffs=(), supervisor="lead")
    assert resolve_handoff(c, "succeeded") == "lead"


def test_resolve_handoff_none_when_no_route_no_supervisor():
    c = Charter(identity="dev", goal="g")
    assert resolve_handoff(c, "succeeded") is None
