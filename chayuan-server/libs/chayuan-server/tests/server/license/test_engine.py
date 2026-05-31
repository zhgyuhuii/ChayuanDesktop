from chayuan.server.license import engine, entstore

CFG = {"daily_free": {"video": 2, "chat": 10}, "public_key": b"", "hmac_keys": {}}
T0 = 1780000000.0  # 固定 now(UTC epoch 秒),约 2026-05


def test_status_unlicensed_shows_free_quota(tmp_path):
    s = engine.status(tmp_path, "video", CFG, now=T0)
    assert s["dailyFree"] == 2
    assert s["remainingFree"] == 2
    assert s["counts"] == 0
    assert s["timeExpireAt"] is None
    assert s["licensed"] is True  # 有免费额度也算"可用"


def test_status_time_licensed(tmp_path):
    st = entstore.read_state(tmp_path, "video")
    st["timeExpireAt"] = "2099-01-01T00:00:00.000Z"
    entstore.write_state(tmp_path, st)
    s = engine.status(tmp_path, "video", CFG, now=T0)
    assert s["licensed"] is True
    assert s["timeExpireAt"] == "2099-01-01T00:00:00.000Z"


def test_status_no_free_no_count_not_licensed(tmp_path):
    st = entstore.read_state(tmp_path, "video")
    st["freeUsedToday"] = 2
    st["freeDate"] = engine._today(T0)
    entstore.write_state(tmp_path, st)
    s = engine.status(tmp_path, "video", CFG, now=T0)
    assert s["remainingFree"] == 0
    assert s["licensed"] is False


def test_status_daily_reset_across_midnight(tmp_path):
    st = entstore.read_state(tmp_path, "video")
    st["freeUsedToday"] = 2
    st["freeDate"] = "2020-01-01"  # 旧日期
    entstore.write_state(tmp_path, st)
    s = engine.status(tmp_path, "video", CFG, now=T0)
    assert s["remainingFree"] == 2  # 跨天清零


def test_status_rollback_flagged(tmp_path):
    st = entstore.read_state(tmp_path, "video")
    st["timeExpireAt"] = "2099-01-01T00:00:00.000Z"
    st["seenMax"] = T0 + 10 * 86400  # 见过的最大时间远在未来
    entstore.write_state(tmp_path, st)
    s = engine.status(tmp_path, "video", CFG, now=T0)
    assert s["licensed"] is False
    assert s["reason"] == "rollback"


def test_free_module_always_licensed(tmp_path):
    cfg = {"daily_free": {}, "free_modules": ["kb"], "public_key": b"", "hmac_keys": {}}
    s = engine.status(tmp_path, "kb", cfg, now=T0)
    assert s["free"] is True and s["licensed"] is True
    r = engine.consume(tmp_path, "kb", cfg, now=T0)
    assert r["allowed"] is True and r["source"] == "free"
