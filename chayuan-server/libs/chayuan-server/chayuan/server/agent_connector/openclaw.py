from __future__ import annotations
import json
from typing import Iterator, Sequence
from chayuan.server.agent_connector.base import (
    ExternalAgentConnector, AgentStatus, AgentConfigBundle, InstallEvent,
)
from chayuan.server.agent_connector.runner import AgentCliRunner


class OpenClawAdapter(ExternalAgentConnector):
    """映射 openclaw CLI。argv_prefix 让测试可把 fake 脚本插在子命令前。"""
    system_id = "openclaw"

    def __init__(self, *, runner: AgentCliRunner, argv_prefix: Sequence[str] = ()):
        self.runner = runner
        self.prefix = list(argv_prefix)

    def _args(self, *parts: str) -> list[str]:
        return [*self.prefix, *parts]

    def status(self) -> AgentStatus:
        try:
            res = self.runner.run(self._args("status", "--json"))
        except Exception as e:  # noqa: BLE001
            return AgentStatus(installed=False, running=False, detail=str(e))
        if res.returncode != 0:
            return AgentStatus(installed=False, running=False, detail=res.stderr.strip())
        try:
            data = json.loads(res.stdout.strip() or "{}")
        except json.JSONDecodeError:
            return AgentStatus(installed=True, running=False, health="degraded",
                               detail="status json parse failed")
        up_ms = data.get("uptimeMs") or 0
        return AgentStatus(
            installed=True,
            running=bool(data.get("running")),
            version=data.get("version"),
            uptime_seconds=int(up_ms // 1000) if up_ms else None,
            pid=data.get("pid"),
            health=data.get("health", "unknown"),
        )

    def install(self) -> Iterator[InstallEvent]:
        for line in self.runner.stream(self._args("onboard", "--install-daemon")):
            yield InstallEvent(level="info", message=line)
        yield InstallEvent(level="done", message="install finished")

    def start(self) -> None:
        self.runner.run(self._args("gateway", "start"))

    def stop(self) -> None:
        self.runner.run(self._args("gateway", "stop"))

    def restart(self) -> None:
        self.runner.run(self._args("gateway", "restart"))

    def uninstall(self) -> None:
        self.runner.run(self._args("uninstall"))

    def get_config(self) -> AgentConfigBundle:
        res = self.runner.run(self._args("config", "get"))
        return AgentConfigBundle(raw=res.stdout, format="json5")

    def set_config(self, bundle: AgentConfigBundle) -> None:
        self.runner.run(self._args("config", "set", "--file", "-"))

    def stream_logs(self) -> Iterator[str]:
        yield from self.runner.stream(self._args("logs", "--follow"))

    def _skill_from(self, d: dict, installed: bool):
        from chayuan.server.agent_connector.base import Skill
        return Skill(id=d.get("slug", ""), name=d.get("name", ""), version=str(d.get("version", "")),
                     description=d.get("description", ""), permissions=list(d.get("requires", [])),
                     installed=installed, verified=bool(d.get("verified", False)))

    def list_skills(self) -> list:
        res = self.runner.run(self._args("skills", "list", "--json"))
        return [self._skill_from(d, installed=True) for d in json.loads(res.stdout or "[]")]

    def search_skills(self, query: str) -> list:
        res = self.runner.run(self._args("skills", "search", query, "--json"))
        return [self._skill_from(d, installed=False) for d in json.loads(res.stdout or "[]")]

    def install_skill(self, skill_id: str):
        from chayuan.server.agent_connector.base import InstallEvent
        for line in self.runner.stream(self._args("skills", "install", skill_id)):
            yield InstallEvent(level="info", message=line)
        yield InstallEvent(level="done", message="skill installed")

    def uninstall_skill(self, skill_id: str) -> None:
        self.runner.run(self._args("skills", "uninstall", skill_id))
