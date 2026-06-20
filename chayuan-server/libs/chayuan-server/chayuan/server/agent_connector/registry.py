from __future__ import annotations
from chayuan.server.agent_connector.openclaw import OpenClawAdapter
from chayuan.server.agent_connector.runner import AgentCliRunner

# v1 仅 openclaw；Hermes 在 v2 加一行。
_OPENCLAW_SUBCMDS = {"--version", "status", "config", "onboard", "gateway", "uninstall", "logs"}


def build_adapter(system_id: str):
    if system_id == "openclaw":
        runner = AgentCliRunner(bin_path="openclaw", allowed_subcommands=_OPENCLAW_SUBCMDS)
        return OpenClawAdapter(runner=runner)
    raise KeyError(f"unknown agent system: {system_id}")


SUPPORTED_SYSTEMS = ("openclaw",)
