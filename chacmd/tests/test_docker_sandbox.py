import pytest

from chacmd.interfaces.docker_sandbox import build_run_kwargs
from chacmd.interfaces.sandbox import SandboxSpec


def test_hardening_baseline_applied():
    kw = build_run_kwargs(SandboxSpec(nickname="w1", image="chatop-ai:latest"))
    assert kw["cap_drop"] == ["ALL"]
    assert kw["security_opt"] == ["no-new-privileges"]
    assert kw["read_only"] is True
    assert kw["network_mode"] == "none"  # 默认拒绝出站(NFR-SEC2)
    assert kw["image"] == "chatop-ai:latest"


def test_container_name_prefixed_and_unique():
    kw1 = build_run_kwargs(SandboxSpec(nickname="w1", image="x"))
    kw2 = build_run_kwargs(SandboxSpec(nickname="w1", image="x"))
    assert kw1["name"].startswith("chacmd-w1-")
    assert kw1["name"] != kw2["name"]  # 每次唯一，避免撞名


def test_resource_limits_present():
    kw = build_run_kwargs(SandboxSpec(nickname="w1", image="x"))
    assert kw["mem_limit"]
    assert kw["pids_limit"]


def test_socket_mount_rejected_at_spec():
    with pytest.raises(ValueError):
        SandboxSpec(nickname="w1", image="x", mounts=["/var/run/docker.sock:/x"])
