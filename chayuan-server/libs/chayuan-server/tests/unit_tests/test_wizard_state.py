"""D1 — 向导完成状态读写端点的纯函数单测。

只测 state 文件读写 helper + 单机短路 _effective_state,不拉 FastAPI app。
"""
from chayuan.server.api_server import wizard_routes


def test_default_not_completed(tmp_path, monkeypatch):
    monkeypatch.setattr(wizard_routes, "_state_path", lambda: tmp_path / "wizard_state.json")
    assert wizard_routes._read_state()["completed"] is False


def test_write_then_read_completed(tmp_path, monkeypatch):
    # _write_state 在单机版 no-op,这里显式置网络版以稳定测落盘路径。
    monkeypatch.setattr(wizard_routes, "is_single_machine", lambda: False)
    monkeypatch.setattr(wizard_routes, "_state_path", lambda: tmp_path / "wizard_state.json")
    wizard_routes._write_state({"completed": True})
    assert wizard_routes._read_state()["completed"] is True


def test_single_machine_write_is_noop(tmp_path, monkeypatch):
    # 单机版 _write_state 必须 no-op,不在桌面端落生这个用不到的文件。
    p = tmp_path / "wizard_state.json"
    monkeypatch.setattr(wizard_routes, "is_single_machine", lambda: True)
    monkeypatch.setattr(wizard_routes, "_state_path", lambda: p)
    wizard_routes._write_state({"completed": True})
    assert not p.exists()


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
