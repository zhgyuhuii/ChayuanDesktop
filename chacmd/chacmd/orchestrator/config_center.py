"""#10 统一配置中心（每 agent 模型/Key/BaseURL 的 CRUD + 下发 env + 热更新）。

中心存每个数字员工的模型配置，供给时 to_env 注入容器；运行中改配置走 hot_update
发总线事件（agent.<nickname>.config），容器侧热加载，无需重启。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class AgentConfig:
    model: str
    api_key: str
    base_url: str
    extra: dict[str, str] = field(default_factory=dict)


class _Bus(Protocol):
    async def publish(self, subject: str, message: dict) -> None: ...


class ConfigCenter:
    def __init__(self, bus: _Bus | None = None) -> None:
        self._by_nick: dict[str, AgentConfig] = {}
        self._bus = bus

    def set(self, nickname: str, config: AgentConfig) -> None:
        self._by_nick[nickname] = config

    def get(self, nickname: str) -> AgentConfig | None:
        return self._by_nick.get(nickname)

    def delete(self, nickname: str) -> None:
        self._by_nick.pop(nickname, None)

    def to_env(self, nickname: str) -> dict[str, str]:
        """把配置映射成容器 env（供 Provisioner 下发）。"""
        cfg = self._by_nick.get(nickname)
        if cfg is None:
            return {}
        return {
            "CHACMD_MODEL": cfg.model,
            "OPENAI_API_KEY": cfg.api_key,
            "OPENAI_BASE_URL": cfg.base_url,
            **cfg.extra,
        }

    async def hot_update(self, nickname: str, config: AgentConfig) -> None:
        """热更新：改配置并发总线事件让运行中容器热加载（不重启）。"""
        self._by_nick[nickname] = config
        if self._bus is not None:
            await self._bus.publish(
                f"agent.{nickname}.config",
                {"nickname": nickname, "env": self.to_env(nickname)},
            )


__all__ = ["AgentConfig", "ConfigCenter"]
