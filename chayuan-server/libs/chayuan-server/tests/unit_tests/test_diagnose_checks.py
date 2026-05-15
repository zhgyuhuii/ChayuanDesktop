"""diagnose.checks 单元测试。

每个 check 是纯函数,外部依赖通过 monkeypatch 模拟。
"""
from __future__ import annotations

import pytest

from chayuan.server.diagnose.types import DiagnoseCheck, DiagnoseReport


def test_check_sidecar_healthz_returns_ok():
    """sidecar.healthz check:模块跑起来就 ok"""
    from chayuan.server.diagnose.checks import check_sidecar_healthz

    c = check_sidecar_healthz()
    assert isinstance(c, DiagnoseCheck)
    assert c.name == "sidecar.healthz"
    assert c.ok is True
    assert c.severity == "ok"


def test_diagnose_check_dataclass_defaults():
    """DiagnoseCheck context 默认 None,severity 必填"""
    c = DiagnoseCheck(name="x", ok=True, severity="ok", detail="d")
    assert c.context is None


def test_check_vendor_llama_server_binary_present(tmp_path, monkeypatch):
    """vendor 二进制存在时 → ok,detail 含路径 + version"""
    from chayuan.server.model_registry import local_runtime
    from chayuan.server.diagnose.checks import check_vendor_llama_server_binary

    services = tmp_path / "services" / "llama-server"
    services.mkdir(parents=True)
    exe = services / "llama-server.exe"
    exe.write_bytes(b"x" * 1024)
    (services / "VERSION").write_text("b4404\n2026-05-15\n")
    monkeypatch.setattr(local_runtime, "_INSTALL_SERVICES_DIRS", [tmp_path / "services"])

    c = check_vendor_llama_server_binary()
    assert c.name == "vendor.llama-server.binary"
    assert c.ok is True
    assert c.severity == "ok"
    assert "b4404" in c.detail
    assert "llama-server.exe" in c.detail


def test_check_vendor_llama_server_binary_missing(tmp_path, monkeypatch):
    """vendor 二进制缺失时 → fail"""
    from chayuan.server.model_registry import local_runtime
    from chayuan.server.diagnose.checks import check_vendor_llama_server_binary

    monkeypatch.setattr(local_runtime, "_INSTALL_SERVICES_DIRS", [tmp_path / "nothing"])
    c = check_vendor_llama_server_binary()
    assert c.ok is False
    assert c.severity == "fail"
    assert "未找到" in c.detail or "not found" in c.detail.lower()


def test_check_bundled_models_chat_present(tmp_path, monkeypatch):
    """bundled_models 至少 1 个 chat .gguf → ok"""
    from chayuan.server.diagnose.checks import check_bundled_models_chat

    fake_entries = [
        type("Entry", (), {"capability": "chat", "model_id": "qwen3-4b", "path": str(tmp_path / "a.gguf")})()
    ]
    fake_index = type("Idx", (), {"by_capability": lambda self, cap: fake_entries if cap == "chat" else []})()
    monkeypatch.setattr(
        "chayuan.server.diagnose.checks.get_local_index",
        lambda **kw: fake_index,
    )

    c = check_bundled_models_chat()
    assert c.name == "vendor.bundled_models.chat"
    assert c.ok is True
    assert "1" in c.detail or "qwen3" in c.detail.lower()


def test_check_bundled_models_chat_empty(monkeypatch):
    """bundled_models 0 个 chat 模型 → fail"""
    from chayuan.server.diagnose.checks import check_bundled_models_chat

    fake_index = type("Idx", (), {"by_capability": lambda self, cap: []})()
    monkeypatch.setattr(
        "chayuan.server.diagnose.checks.get_local_index",
        lambda **kw: fake_index,
    )

    c = check_bundled_models_chat()
    assert c.ok is False
    assert c.severity == "fail"
