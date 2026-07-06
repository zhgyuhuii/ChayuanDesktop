"""#8 免密开容器界面 —— 一次性 token 预认证（纯逻辑）。

指挥系统免密打开某容器 OS 界面：签发一次性 token（单用 + 短 TTL + RBAC 门 + 只读/可操作），
上游反代凭 token 预认证放行。反代/KasmVNC 免密本身需基建；本层只管 token 生命周期与鉴权。
NFR-SEC7：外部/前端永不直连容器；一次性 token 绑主体 + 短有效 + 审计。
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass, field

from chacmd.interfaces.rbac import RbacPolicy, Resource, Subject


@dataclass(frozen=True)
class DesktopToken:
    token: str
    nickname: str
    subject: str
    mode: str  # "readonly" | "interactive"
    expires_at: float


@dataclass
class OneTimeTokenService:
    rbac: RbacPolicy | None = None
    _store: dict[str, DesktopToken] = field(default_factory=dict)

    def issue(
        self,
        nickname: str,
        subject: Subject,
        mode: str,
        *,
        now: float,
        ttl: float = 60.0,
    ) -> DesktopToken:
        """签发一次性桌面访问 token（越权拒，#14/#8）。"""
        if self.rbac is not None and not self.rbac.check(subject, Resource("container", nickname), "open"):
            raise PermissionError(f"{subject.id} not allowed to open desktop of {nickname}")
        token = secrets.token_urlsafe(18)
        dt = DesktopToken(token, nickname, subject.id, mode, now + ttl)
        self._store[token] = dt
        return dt

    def consume(self, token: str, *, now: float) -> DesktopToken | None:
        """消费 token（单用：无论有效与否都移除）；过期/未知返回 None。"""
        dt = self._store.pop(token, None)
        if dt is None:
            return None
        if now >= dt.expires_at:
            return None
        return dt


__all__ = ["DesktopToken", "OneTimeTokenService"]
