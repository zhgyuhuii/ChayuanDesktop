from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Iterator, Optional


@dataclass
class AgentStatus:
    installed: bool
    running: bool
    version: Optional[str] = None
    uptime_seconds: Optional[int] = None
    pid: Optional[int] = None
    health: str = "unknown"          # ok | degraded | unknown
    detail: str = ""


@dataclass
class AgentConfigBundle:
    raw: str                          # 主配置文本（OpenClaw 是 openclaw.json）
    soul: str = ""                    # SOUL.md 人格文本
    format: str = "json5"             # 给前端选编辑器高亮


@dataclass
class InstallEvent:
    level: str                        # info | warn | error | done
    message: str
    ts: int = 0


@dataclass
class Skill:
    id: str
    name: str
    version: str
    description: str
    permissions: list = field(default_factory=list)
    installed: bool = False
    publisher: str = ""
    verified: bool = False
    readme: str = ""


class ExternalAgentConnector(ABC):
    """单个外部 agent 系统（OpenClaw/Hermes/…）的统一契约。
    v1 仅实现 OpenClaw + trusted-local；per-user/instance 由 AgentInstanceManager 负责。"""

    system_id: str = ""

    @abstractmethod
    def status(self) -> AgentStatus: ...

    @abstractmethod
    def install(self) -> Iterator[InstallEvent]:
        """流式安装事件（供 SSE）。"""

    @abstractmethod
    def start(self) -> None: ...

    @abstractmethod
    def stop(self) -> None: ...

    @abstractmethod
    def restart(self) -> None: ...

    @abstractmethod
    def uninstall(self) -> None: ...

    @abstractmethod
    def get_config(self) -> AgentConfigBundle: ...

    @abstractmethod
    def set_config(self, bundle: AgentConfigBundle) -> None: ...

    @abstractmethod
    def stream_logs(self) -> Iterator[str]: ...

    def list_skills(self) -> list: raise NotImplementedError
    def search_skills(self, query: str) -> list: raise NotImplementedError
    def install_skill(self, skill_id: str) -> "Iterator[InstallEvent]": raise NotImplementedError
    def uninstall_skill(self, skill_id: str) -> None: raise NotImplementedError
    def skill_detail(self, skill_id: str) -> "Skill": raise NotImplementedError

