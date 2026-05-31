import re
from chayuan.server.license.fingerprint import fingerprint
from chayuan.server.license import store

def test_fingerprint_stable_16hex(tmp_path):
    a = fingerprint(tmp_path)
    b = fingerprint(tmp_path)
    assert a == b
    assert re.fullmatch(r"[0-9a-f]{16}", a)

def test_store_roundtrip(tmp_path):
    rec = {"mid": "1122334455667788", "app": "video", "expireAt": "2026-07-01T00:00:00.000Z", "seenMax": 1, "source": "shortcode", "credential": "S"}
    store.write_activation(tmp_path, rec)
    assert store.read_activation(tmp_path, "video")["mid"] == "1122334455667788"

def test_store_missing_returns_none(tmp_path):
    assert store.read_activation(tmp_path, "nope") is None


def test_delete_activation(tmp_path):
    from chayuan.server.license import store
    rec = {"mid": "1122334455667788", "app": "video", "expireAt": "2026-07-01T00:00:00.000Z",
           "seenMax": 0, "source": "shortcode", "credential": "x"}
    store.write_activation(tmp_path, rec)
    assert store.read_activation(tmp_path, "video") is not None
    assert store.delete_activation(tmp_path, "video") is True
    assert store.read_activation(tmp_path, "video") is None
    # 再删返回 False(已无文件)
    assert store.delete_activation(tmp_path, "video") is False
