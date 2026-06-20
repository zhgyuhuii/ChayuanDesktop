from chayuan.server.agent_connector.policy import HostPolicy, derive_host_policy


def test_auto_without_auth_is_trusted_local():
    p = derive_host_policy(host_policy="auto", auth_required=False)
    assert p.kind == "trusted-local"
    assert p.sandbox_enforced is False
    assert p.multi_instance is False


def test_auto_with_auth_is_shared_multitenant():
    p = derive_host_policy(host_policy="auto", auth_required=True)
    assert p.kind == "shared-multitenant"
    assert p.sandbox_enforced is True
    assert p.multi_instance is True


def test_explicit_override_wins():
    p = derive_host_policy(host_policy="trusted-local", auth_required=True)
    assert p.kind == "trusted-local"
