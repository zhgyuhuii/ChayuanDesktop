"""#18 角色契约 Charter（声明式，纯逻辑）。

Charter = 一个数字员工的岗位说明书：身份 / 目标 / 系统提示词 / 技能 / 知识范围 /
触发规则(trigger：什么事件来了该干嘛) / 交接规则(handoff：产出后传给谁)。
派活时把 render_system_prompt 注入 agent；事件来了用 match_triggers 决定动作；
一轮结束用 resolve_handoff 决定接力对象（无匹配则回 supervisor）。
"""

from __future__ import annotations

from dataclasses import dataclass

from chacmd.domain.events import Event


@dataclass(frozen=True)
class Trigger:
    """事件触发规则：on=事件 kind（'*' 通配）；when=payload 需含的键；action=触发的动作串。"""

    on: str
    action: str
    when: str | None = None


@dataclass(frozen=True)
class Handoff:
    """交接规则：某结果 → 交给某昵称。"""

    on_outcome: str
    to: str


@dataclass(frozen=True)
class Charter:
    identity: str
    goal: str
    system_prompt: str = ""
    skills: tuple[str, ...] = ()
    knowledge_scope: tuple[str, ...] = ()
    triggers: tuple[Trigger, ...] = ()
    handoffs: tuple[Handoff, ...] = ()
    #: 无匹配 handoff 时的兜底接力对象（总指挥）。
    supervisor: str | None = None


def render_system_prompt(charter: Charter) -> str:
    """把契约拼成注入 agent 的系统提示词。"""
    lines = []
    if charter.system_prompt:
        lines.append(charter.system_prompt)
    lines.append(f"身份：{charter.identity}")
    lines.append(f"目标：{charter.goal}")
    if charter.skills:
        lines.append(f"技能：{', '.join(charter.skills)}")
    if charter.knowledge_scope:
        lines.append(f"可查知识范围：{', '.join(charter.knowledge_scope)}")
    return "\n".join(lines)


def match_triggers(charter: Charter, event: Event) -> list[str]:
    """返回该事件命中的所有 trigger 动作（保持声明顺序）。"""
    actions: list[str] = []
    payload = event.payload or {}
    for t in charter.triggers:
        if t.on not in ("*", event.kind):
            continue
        if t.when is not None and t.when not in payload:
            continue
        actions.append(t.action)
    return actions


def resolve_handoff(charter: Charter, outcome: str) -> str | None:
    """按结果决定接力对象；无匹配则回 supervisor；再无则 None。"""
    for h in charter.handoffs:
        if h.on_outcome == outcome:
            return h.to
    return charter.supervisor


__all__ = [
    "Trigger",
    "Handoff",
    "Charter",
    "render_system_prompt",
    "match_triggers",
    "resolve_handoff",
]
