"""席位授权覆盖功能级门控:有有效席位→consume/status 全放行(不弹购买)。

单机版与未购席位的网络版不受影响(各自门控不变)。
"""
from __future__ import annotations

from chayuan.server.license import engine, seat


def test_single_machine_has_no_seat_license(tmp_path, monkeypatch):
    # 单机版:席位概念不适用,恒 False(走单机自身 license,不被席位短路)
    monkeypatch.setenv("CHAYUAN_PROFILE", "single-machine")
    assert seat.has_active_deployment_license(tmp_path) is False


def test_consume_short_circuits_when_seat_active(tmp_path, monkeypatch):
    # 有席位授权 → 任意模块 allowed=True、source=seat、不扣次数
    monkeypatch.setattr(seat, "has_active_deployment_license", lambda r, now=None: True)
    cfg = {"daily_free": {"asr": 0, "chat": 0}, "free_modules": []}
    for app in ("asr", "chat", "video"):
        r = engine.consume(tmp_path, app, cfg)
        assert r["allowed"] is True and r["source"] == "seat"


def test_status_licensed_when_seat_active(tmp_path, monkeypatch):
    monkeypatch.setattr(seat, "has_active_deployment_license", lambda r, now=None: True)
    cfg = {"daily_free": {"asr": 0}, "free_modules": []}
    st = engine.status(tmp_path, "asr", cfg)
    assert st["licensed"] is True and st.get("source") == "seat"


def test_consume_blocked_without_seat_and_quota(tmp_path, monkeypatch):
    # 无席位 + 0 免费 + 无购买 → blocked(会弹购买),证明短路只在有席位时生效
    monkeypatch.setattr(seat, "has_active_deployment_license", lambda r, now=None: False)
    cfg = {"daily_free": {"asr": 0}, "free_modules": []}
    r = engine.consume(tmp_path, "asr", cfg)
    assert r["allowed"] is False
