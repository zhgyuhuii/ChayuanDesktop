import pytest
from chayuan.server.agent_connector.base import (
    ExternalAgentConnector, AgentStatus, AgentConfigBundle,
)


def test_status_dataclass_defaults():
    s = AgentStatus(installed=False, running=False)
    assert s.version is None and s.uptime_seconds is None and s.pid is None


def test_connector_is_abstract():
    with pytest.raises(TypeError):
        ExternalAgentConnector()


def test_required_methods_present():
    for name in ("status", "install", "start", "stop", "restart",
                 "uninstall", "get_config", "set_config", "stream_logs"):
        assert hasattr(ExternalAgentConnector, name)
