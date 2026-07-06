"""#9 技能与插件体系（SKILL.md 注册 + allowlist + 签名校验 + 绑角色契约）。

通用 SKILL.md 标准，一次装多 agent 共用；来源 ClawHub/Hermes/察元。
生产禁自动装：install 须过 allowlist + 签名校验（NFR-SEC3 供应链：allowlist+签名+沙箱+pin）。
签名复用 I3 Crypto（HMAC-SHA256）。
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Protocol

from chacmd.domain.charter import Charter


@dataclass(frozen=True)
class SkillManifest:
    name: str
    version: str
    source: str
    signature: str  # hex HMAC of manifest_bytes(不含 signature 字段)


class _Crypto(Protocol):
    def sign(self, data: bytes) -> bytes: ...
    def verify(self, data: bytes, sig: bytes) -> bool: ...


def manifest_bytes(m: SkillManifest) -> bytes:
    """签名覆盖的规范字节（不含 signature 本身）。"""
    return f"{m.name}|{m.version}|{m.source}".encode()


@dataclass
class SkillRegistry:
    crypto: _Crypto
    allowlist: set[str]
    _installed: dict[str, SkillManifest] = field(default_factory=dict)

    def verify_signature(self, m: SkillManifest) -> bool:
        try:
            sig = bytes.fromhex(m.signature)
        except ValueError:
            return False
        return self.crypto.verify(manifest_bytes(m), sig)

    def install(self, m: SkillManifest) -> None:
        if m.name not in self.allowlist:
            raise PermissionError(f"skill {m.name} not in allowlist (生产禁自动装)")
        if not self.verify_signature(m):
            raise ValueError(f"skill {m.name} signature invalid")
        self._installed[m.name] = m

    def installed(self) -> list[SkillManifest]:
        return list(self._installed.values())

    def bind(self, skill_name: str, charter: Charter) -> Charter:
        """把已装技能绑到角色契约（追加到 skills，不重复）。"""
        if skill_name not in self._installed:
            raise KeyError(f"skill not installed: {skill_name}")
        if skill_name in charter.skills:
            return charter
        return replace(charter, skills=(*charter.skills, skill_name))


__all__ = ["SkillManifest", "SkillRegistry", "manifest_bytes"]
