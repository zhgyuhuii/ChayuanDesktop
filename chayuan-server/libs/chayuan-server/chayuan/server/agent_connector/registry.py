from __future__ import annotations
from chayuan.server.agent_connector.openclaw import OpenClawAdapter
from chayuan.server.agent_connector.hermes import HermesAdapter
from chayuan.server.agent_connector.runner import AgentCliRunner

# v1 仅 openclaw；Hermes 在 v2 加一行。
_OPENCLAW_SUBCMDS = {"--version", "status", "config", "onboard", "gateway", "uninstall", "logs"}
_HERMES_SUBCMDS = {"status", "config", "setup", "gateway", "uninstall", "logs", "skills"}


def build_adapter(system_id: str):
    if system_id == "openclaw":
        runner = AgentCliRunner(bin_path="openclaw", allowed_subcommands=_OPENCLAW_SUBCMDS)
        return OpenClawAdapter(runner=runner)
    if system_id == "hermes":
        runner = AgentCliRunner(bin_path="hermes", allowed_subcommands=_HERMES_SUBCMDS)
        return HermesAdapter(runner=runner)
    raise KeyError(f"unknown agent system: {system_id}")


SUPPORTED_SYSTEMS = ("openclaw", "hermes")
