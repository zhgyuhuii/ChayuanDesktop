"""D1 — 向导完成状态读写端点的纯函数单测。

只测 state 文件读写 helper + 受管短路 _effective_state/_managed,不拉 FastAPI app。

「受管部署」= 网络版,或单机内核但已注册真实 admin(网页管理小型部署)。
唯一不受管 = 桌面匿名单机(单机内核 + 无真实 admin):向导永不展示/落盘。
"""
from chayuan.server.api_server import wizard_routes


def _set_profile(monkeypatch, *, single_machine: bool, has_admin: bool):
    """统一摆放 profile + admin 两个判据,让 _managed() 取确定值。"""
    monkeypatch.setattr(wizard_routes, "is_single_machine", lambda: single_machine)
    monkeypatch.setattr(wizard_routes, "_has_real_admin", lambda: has_admin)


def test_default_not_completed(tmp_path, monkeypatch):
    monkeypatch.setattr(wizard_routes, "_state_path", lambda: tmp_path / "wizard_state.json")
    assert wizard_routes._read_state()["completed"] is False


def test_write_then_read_completed(tmp_path, monkeypatch):
    # _write_state 在非受管形态 no-op,这里显式置网络版以稳定测落盘路径。
    _set_profile(monkeypatch, single_machine=False, has_admin=False)
    monkeypatch.setattr(wizard_routes, "_state_path", lambda: tmp_path / "wizard_state.json")
    wizard_routes._write_state({"completed": True})
    assert wizard_routes._read_state()["completed"] is True


def test_desktop_anonymous_write_is_noop(tmp_path, monkeypatch):
    # 桌面匿名单机(单机内核 + 无真实 admin)_write_state 必须 no-op,不落生用不到的文件。
    p = tmp_path / "wizard_state.json"
    _set_profile(monkeypatch, single_machine=True, has_admin=False)
    monkeypatch.setattr(wizard_routes, "_state_path", lambda: p)
    wizard_routes._write_state({"completed": True})
    assert not p.exists()


def test_parse_error_returns_default(tmp_path, monkeypatch):
    p = tmp_path / "wizard_state.json"
    p.write_text("{ not json", encoding="utf-8")
    monkeypatch.setattr(wizard_routes, "_state_path", lambda: p)
    assert wizard_routes._read_state()["completed"] is False


def test_desktop_anonymous_reads_completed(monkeypatch):
    # 桌面匿名单机向导永不展示 → state 恒报 completed,不读盘。
    _set_profile(monkeypatch, single_machine=True, has_admin=False)
    assert wizard_routes._effective_state()["completed"] is True


def test_network_effective_delegates_to_read(tmp_path, monkeypatch):
    _set_profile(monkeypatch, single_machine=False, has_admin=False)
    monkeypatch.setattr(wizard_routes, "_state_path", lambda: tmp_path / "wizard_state.json")
    assert wizard_routes._effective_state()["completed"] is False
    wizard_routes._write_state({"completed": True})
    assert wizard_routes._effective_state()["completed"] is True


def test_single_machine_with_admin_is_managed(tmp_path, monkeypatch):
    # 关键回归:单机内核 + 已注册真实 admin(docker-compose.single.yaml 网页管理部署)
    # → 受管 → 向导照常展示(首次 completed=False)且完成状态能落盘。
    _set_profile(monkeypatch, single_machine=True, has_admin=True)
    monkeypatch.setattr(wizard_routes, "_state_path", lambda: tmp_path / "wizard_state.json")
    # 首次:无文件 → 应展示向导(未完成)。
    assert wizard_routes._effective_state()["completed"] is False
    # 完成后写盘(单机内核下也必须真写,否则反复弹)。
    wizard_routes._write_state({"completed": True})
    assert (tmp_path / "wizard_state.json").exists()
    assert wizard_routes._effective_state()["completed"] is True


def test_managed_helper_truth_table(monkeypatch):
    # 网络版:恒受管(无论有无 admin)。
    monkeypatch.setattr(wizard_routes, "is_single_machine", lambda: False)
    monkeypatch.setattr(wizard_routes, "_has_real_admin", lambda: False)
    assert wizard_routes._managed() is True
    # 单机 + 无 admin:不受管(桌面匿名)。
    monkeypatch.setattr(wizard_routes, "is_single_machine", lambda: True)
    monkeypatch.setattr(wizard_routes, "_has_real_admin", lambda: False)
    assert wizard_routes._managed() is False
    # 单机 + 有 admin:受管(网页管理)。
    monkeypatch.setattr(wizard_routes, "_has_real_admin", lambda: True)
    assert wizard_routes._managed() is True
