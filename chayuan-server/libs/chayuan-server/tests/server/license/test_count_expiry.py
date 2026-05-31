from chayuan.server.license import engine, entstore

T0 = 1780000000.0
DAY = 86400


def test_count_expires_blocks_consume(tmp_path):
    cfg = {"daily_free": {}, "products": {"video": 0}}
    st = entstore.read_state(tmp_path, "video")
    st["counts"] = 5
    st["countExpireAt"] = engine._to_iso(T0 - DAY)   # 昨天到期
    entstore.write_state(tmp_path, st)
    r = engine.consume(tmp_path, "video", cfg, now=T0)
    assert r["allowed"] is False               # 次数已过期 → 不放行
    assert engine.status(tmp_path, "video", cfg, now=T0)["licensed"] is False


def test_count_not_expired_allows(tmp_path):
    cfg = {"daily_free": {}, "products": {"video": 0}}
    st = entstore.read_state(tmp_path, "video")
    st["counts"] = 5
    st["countExpireAt"] = engine._to_iso(T0 + DAY)   # 明天到期
    entstore.write_state(tmp_path, st)
    r = engine.consume(tmp_path, "video", cfg, now=T0)
    assert r["allowed"] is True and r["source"] == "count"


def test_apply_grant_count_until_sets_countexpireat(tmp_path):
    engine._apply_grant(tmp_path, {"app": "video", "kind": "count", "n": 3, "until": T0 + 10 * DAY}, T0)
    st = entstore.read_state(tmp_path, "video")
    assert st["counts"] == 3
    assert abs(engine._ts(st["countExpireAt"]) - (T0 + 10 * DAY)) < 1
