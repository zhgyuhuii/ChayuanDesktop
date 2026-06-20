from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class HostPolicy:
    """单机/服务器拓扑策略。单机=退化配置，唯一不随权限放开的是 sandbox。"""
    kind: str               # "trusted-local" | "shared-multitenant"
    multi_instance: bool    # 是否 per-user 多实例
    sandbox_enforced: bool  # 是否强制沙箱（共享主机才 True）
    spawn_local: bool       # spawn 目标是否本机（trusted-local True）


def derive_host_policy(*, host_policy: str, auth_required: bool) -> HostPolicy:
    hp = (host_policy or "auto").strip().lower()
    if hp == "auto":
        hp = "shared-multitenant" if auth_required else "trusted-local"
    if hp == "shared-multitenant":
        return HostPolicy(kind=hp, multi_instance=True, sandbox_enforced=True, spawn_local=False)
    return HostPolicy(kind="trusted-local", multi_instance=False, sandbox_enforced=False, spawn_local=True)
