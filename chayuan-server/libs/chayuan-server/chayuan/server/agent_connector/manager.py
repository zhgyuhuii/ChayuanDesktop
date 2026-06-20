from __future__ import annotations
from typing import Any, Dict, Optional
from chayuan.server.agent_connector.base import ExternalAgentConnector
from chayuan.server.agent_connector.policy import HostPolicy
from chayuan.server.agent_connector import registry


class AgentInstanceManager:
    """按 HostPolicy 解析 agent 实例。
    trusted-local：每 system 一个进程级单例。
    shared-multitenant：per-user 实例（v4 实现，v1 抛 NotImplementedError 占位）。"""

    def __init__(self, *, policy: HostPolicy):
        self.policy = policy
        self._singletons: Dict[str, ExternalAgentConnector] = {}

    def resolve(self, system_id: str, *, user: Optional[Dict[str, Any]]) -> ExternalAgentConnector:
        if self.policy.multi_instance:
            raise NotImplementedError("shared-multitenant per-user spawner is v4")
        inst = self._singletons.get(system_id)
        if inst is None:
            inst = registry.build_adapter(system_id)   # 不存在 system 抛 KeyError
            self._singletons[system_id] = inst
        return inst
