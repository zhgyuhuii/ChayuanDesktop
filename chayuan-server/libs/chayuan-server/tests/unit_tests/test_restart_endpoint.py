"""C3:管理员一键重启端点单元测试。

只测纯逻辑 seam(_restart_impl / _schedule_graceful_exit),不真起 FastAPI、
不真退进程。单机版必须拒绝;网络版才调度优雅退出。
"""
from chayuan.server.api_server import services_config_routes as scr


def test_restart_blocked_in_single_machine(monkeypatch):
    monkeypatch.setattr(scr, "is_single_machine", lambda: True)
    # 单机版即便误调度也算 bug,故确保不会触发 exit:pat一个会爆的假实现。
    monkeypatch.setattr(
        scr, "_schedule_graceful_exit",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("单机不应调度退出")),
    )
    resp = scr._restart_impl()
    assert resp["code"] != 0


def test_restart_schedules_exit_in_network(monkeypatch):
    monkeypatch.setattr(scr, "is_single_machine", lambda: False)
    called = {}
    monkeypatch.setattr(scr, "_schedule_graceful_exit", lambda delay: called.__setitem__("d", delay))
    resp = scr._restart_impl()
    assert resp["code"] == 0
    assert "d" in called
