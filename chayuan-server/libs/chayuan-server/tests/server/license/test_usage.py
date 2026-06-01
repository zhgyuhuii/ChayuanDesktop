from chayuan.server.license import engine, usage

T0 = 1780000000.0


def test_consume_records_free(tmp_path):
    cfg = {"daily_free": {"video": 1}, "products": {"video": 0}}
    engine.consume(tmp_path, "video", cfg, now=T0)
    assert usage.read(tmp_path)["video"]["free"] == 1


def test_blocked_recorded(tmp_path):
    cfg = {"daily_free": {}, "products": {"video": 0}}
    r = engine.consume(tmp_path, "video", cfg, now=T0)
    assert r["allowed"] is False
    assert usage.read(tmp_path)["video"]["blocked"] == 1


def test_telemetry_off_skips(tmp_path):
    cfg = {"daily_free": {"video": 1}, "products": {"video": 0}, "telemetry_enabled": False}
    engine.consume(tmp_path, "video", cfg, now=T0)
    assert usage.read(tmp_path) == {}


def test_hid_stable_anon(tmp_path):
    assert usage.telemetry_hid(tmp_path) == usage.telemetry_hid(tmp_path)
    assert len(usage.telemetry_hid(tmp_path)) == 16
