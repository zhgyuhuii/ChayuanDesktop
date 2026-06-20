from __future__ import annotations
import json
from typing import Iterator, Sequence
from chayuan.server.agent_connector.base import (
    ExternalAgentConnector, AgentStatus, AgentConfigBundle, InstallEvent,
)
from chayuan.server.agent_connector.runner import AgentCliRunner


class HermesAdapter(ExternalAgentConnector):
    system_id = "hermes"

    def __init__(self, *, runner: AgentCliRunner, argv_prefix: Sequence[str] = ()):
        self.runner = runner
        self.prefix = list(argv_prefix)

    def _args(self, *p: str) -> list[str]:
        return [*self.prefix, *p]

    def status(self) -> AgentStatus:
        try:
            res = self.runner.run(self._args("status", "--all"))
        except Exception as e:  # noqa: BLE001
            return AgentStatus(installed=False, running=False, detail=str(e))
        if res.returncode != 0:
            return AgentStatus(installed=False, running=False, detail=res.stderr.strip())
        try:
            data = json.loads(res.stdout.strip() or "{}")
        except json.JSONDecodeError:
            return AgentStatus(installed=True, running=False, health="degraded")
        return AgentStatus(installed=True, running=bool(data.get("gateway")),
                           version=data.get("version"), health="ok" if data.get("gateway") else "unknown")

    def install(self) -> Iterator[InstallEvent]:
        for line in self.runner.stream(self._args("setup", "--non-interactive")):
            yield InstallEvent(level="info", message=line)
        yield InstallEvent(level="done", message="install finished")

    def start(self) -> None: self.runner.run(self._args("gateway", "start"))
    def stop(self) -> None: self.runner.run(self._args("gateway", "stop"))
    def restart(self) -> None: self.runner.run(self._args("gateway", "restart"))
    def uninstall(self) -> None: self.runner.run(self._args("uninstall"))

    def get_config(self) -> AgentConfigBundle:
        res = self.runner.run(self._args("config", "show"))
        return AgentConfigBundle(raw=res.stdout, format="yaml")

    def set_config(self, bundle: AgentConfigBundle) -> None:
        self.runner.run(self._args("config", "set"))

    def stream_logs(self) -> Iterator[str]:
        yield from self.runner.stream(self._args("logs", "--follow"))
