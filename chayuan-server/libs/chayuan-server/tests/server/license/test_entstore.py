from chayuan.server.license import entstore


def test_default_state_when_missing(tmp_path):
    s = entstore.read_state(tmp_path, "video")
    assert s == {"app": "video", "timeExpireAt": None, "counts": 0,
                 "freeUsedToday": 0, "freeDate": None, "seenMax": 0}


def test_write_then_read_roundtrip(tmp_path):
    s = entstore.read_state(tmp_path, "video")
    s["counts"] = 5
    s["timeExpireAt"] = "2026-07-01T00:00:00.000Z"
    entstore.write_state(tmp_path, s)
    again = entstore.read_state(tmp_path, "video")
    assert again["counts"] == 5
    assert again["timeExpireAt"] == "2026-07-01T00:00:00.000Z"


def test_corrupt_file_falls_back_to_default(tmp_path):
    p = entstore.state_path(tmp_path, "video")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("{ not json", encoding="utf-8")
    assert entstore.read_state(tmp_path, "video")["counts"] == 0


def test_redeemed_set_add_and_check(tmp_path):
    assert entstore.read_redeemed(tmp_path) == set()
    assert entstore.is_redeemed(tmp_path, "abc") is False
    entstore.add_redeemed(tmp_path, "abc")
    assert entstore.is_redeemed(tmp_path, "abc") is True
    assert "abc" in entstore.read_redeemed(tmp_path)
