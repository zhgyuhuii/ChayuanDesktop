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
