"""D1 — 向导完成状态读写端点的纯函数单测。

只测 state 文件读写 helper + 单机短路 _effective_state,不拉 FastAPI app。
"""
from chayuan.server.api_server import wizard_routes


def test_default_not_completed(tmp_path, monkeypatch):
    monkeypatch.setattr(wizard_routes, "_state_path", lambda: tmp_path / "wizard_state.json")
    assert wizard_routes._read_state()["completed"] is False


def test_write_then_read_completed(tmp_path, monkeypatch):
    monkeypatch.setattr(wizard_routes, "_state_path", lambda: tmp_path / "wizard_state.json")
    wizard_routes._write_state({"completed": True})
    assert wizard_routes._read_state()["completed"] is True


def test_parse_error_returns_default(tmp_path, monkeypatch):
    p = tmp_path / "wizard_state.json"
    p.write_text("{ not json", encoding="utf-8")
    monkeypatch.setattr(wizard_routes, "_state_path", lambda: p)
    assert wizard_routes._read_state()["completed"] is False


def test_single_machine_reads_completed(monkeypatch):
    # 单机版向导永不展示 → state 恒报 completed,不读盘。
    monkeypatch.setattr(wizard_routes, "is_single_machine", lambda: True)
    assert wizard_routes._effective_state()["completed"] is True


def test_network_effective_delegates_to_read(tmp_path, monkeypatch):
    monkeypatch.setattr(wizard_routes, "is_single_machine", lambda: False)
    monkeypatch.setattr(wizard_routes, "_state_path", lambda: tmp_path / "wizard_state.json")
    assert wizard_routes._effective_state()["completed"] is False
    wizard_routes._write_state({"completed": True})
    assert wizard_routes._effective_state()["completed"] is True
