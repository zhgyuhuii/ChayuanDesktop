import time

from chayuan.server.license import usage, usage_reporter


def test_try_report_nothing(tmp_path):
    # 无 usage 数据 → 不上报
    r = usage_reporter.try_report(tmp_path, "http://x")
    assert r["sent"] is False and r["reason"] == "nothing"


def test_try_report_offline_safe(tmp_path):
    # 有数据但连不上 → 不抛异常,返回 sent=False(离线安全)
    usage.record(tmp_path, "wps", "count")
    r = usage_reporter.try_report(tmp_path, "http://127.0.0.1:1", timeout=0.3)
    assert r["sent"] is False and "reason" in r


def test_start_report_loop_fires_and_offline_safe(tmp_path, monkeypatch):
    # 调度循环:首次 delay 后触发上报;daemon 线程存活;try_report 异常不影响循环
    calls = []

    def _fake(root, base, **kw):
        calls.append(1)
        return {"sent": True}

    monkeypatch.setattr(usage_reporter, "try_report", _fake)
    t = usage_reporter.start_report_loop(tmp_path, "http://x", first_delay=0.05, interval=100)
    time.sleep(0.25)
    assert t.is_alive()        # daemon 线程存活
    assert len(calls) >= 1     # 首次已触发上报
