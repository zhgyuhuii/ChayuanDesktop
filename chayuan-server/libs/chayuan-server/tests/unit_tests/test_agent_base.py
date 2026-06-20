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


def test_skill_dataclass_and_methods():
    from chayuan.server.agent_connector.base import Skill, ExternalAgentConnector
    sk = Skill(id="x", name="X", version="1.0", description="d", permissions=["net"], installed=False)
    assert sk.publisher == "" and sk.verified is False
    for m in ("list_skills", "search_skills", "install_skill", "uninstall_skill", "skill_detail"):
        assert hasattr(ExternalAgentConnector, m)
