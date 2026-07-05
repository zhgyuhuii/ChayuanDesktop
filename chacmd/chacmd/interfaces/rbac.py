"""#14 资源级 RBAC 本地判定（纯逻辑）。

主体(用户|角色) × 资源(container/agent/view/kb...) × 动作(view/dispatch/open/config) 判定，
叠加部门(tenant) 隔离（NFR-T1）与 deny 优先（NFR-GX4 三员分立/SoD 可约束 admin）。

察元的鉴权是 scope-based（require_scopes），无资源级 authz 端点，故容器/视图级派活鉴权
属 ChaCMD 本地域，由本模块承载，替换"FakeChayuanClient 恒 allow"的盲区。
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Subject:
    """鉴权主体：用户 + 其角色 + 所属部门(tenant)。"""

    id: str
    roles: tuple[str, ...] = ()
    tenant: str | None = None


@dataclass(frozen=True)
class Resource:
    """受控资源：类型 + 标识 + 所属部门。"""

    type: str
    id: str
    tenant: str | None = None


@dataclass(frozen=True)
class Grant:
    """一条授权/拒绝规则。resource_type/resource_id/actions 支持 '*' 通配，resource_id 支持前缀 'foo-*'。"""

    role: str
    resource_type: str
    actions: frozenset[str]
    resource_id: str = "*"
    effect: str = "allow"  # "allow" | "deny"


def _id_match(pattern: str, rid: str) -> bool:
    if pattern == "*":
        return True
    if pattern.endswith("*"):
        return rid.startswith(pattern[:-1])
    return pattern == rid


def _type_match(pattern: str, rtype: str) -> bool:
    return pattern == "*" or pattern == rtype


def _action_match(actions: frozenset[str], action: str) -> bool:
    return "*" in actions or action in actions


@dataclass(frozen=True)
class RbacPolicy:
    grants: tuple[Grant, ...] = ()
    admin_roles: frozenset[str] = field(default_factory=lambda: frozenset({"admin"}))

    def _matching(self, subject: Subject, resource: Resource, action: str) -> list[Grant]:
        roles = set(subject.roles)
        return [
            g
            for g in self.grants
            if g.role in roles
            and _type_match(g.resource_type, resource.type)
            and _id_match(g.resource_id, resource.id)
            and _action_match(g.actions, action)
        ]

    def check(self, subject: Subject, resource: Resource, action: str) -> bool:
        matches = self._matching(subject, resource, action)
        # deny 优先：任一命中的 deny 规则即拒（可约束 admin，NFR-GX4）。
        if any(g.effect == "deny" for g in matches):
            return False
        # admin 角色跨部门放行（无 deny 命中时）。
        if self.admin_roles & set(subject.roles):
            return True
        # 部门隔离：非 admin 跨部门一律拒（NFR-T1）。
        if subject.tenant is not None and resource.tenant is not None and subject.tenant != resource.tenant:
            return False
        return any(g.effect == "allow" for g in matches)


__all__ = ["Subject", "Resource", "Grant", "RbacPolicy"]
