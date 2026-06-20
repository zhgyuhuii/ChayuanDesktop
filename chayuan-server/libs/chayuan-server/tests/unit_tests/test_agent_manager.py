import pytest
from chayuan.server.agent_connector.manager import AgentInstanceManager
from chayuan.server.agent_connector.policy import derive_host_policy


def test_trusted_local_returns_singleton_per_system():
    mgr = AgentInstanceManager(policy=derive_host_policy(host_policy="trusted-local", auth_required=False))
    a = mgr.resolve("openclaw", user=None)
    b = mgr.resolve("openclaw", user=None)
    assert a is b
    assert a.system_id == "openclaw"


def test_unknown_system_raises():
    mgr = AgentInstanceManager(policy=derive_host_policy(host_policy="trusted-local", auth_required=False))
    with pytest.raises(KeyError):
        mgr.resolve("does-not-exist", user=None)


def test_shared_multitenant_per_user_not_implemented_yet():
    mgr = AgentInstanceManager(policy=derive_host_policy(host_policy="shared-multitenant", auth_required=True))
    with pytest.raises(NotImplementedError):
        mgr.resolve("openclaw", user={"id": 1})
