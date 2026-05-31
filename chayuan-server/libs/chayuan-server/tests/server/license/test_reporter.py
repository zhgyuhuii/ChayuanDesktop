from chayuan.server.license import entstore, reporter
from chayuan.server.license.fingerprint import fingerprint as _fp

T0 = "2026-06-01T00:00:00.000Z"


def test_build_report_collects_unreported(tmp_path):
    entstore.add_redeemed_card(tmp_path, {"id": "pc_a", "mid": "x", "at": T0})
    entstore.add_redeemed_card(tmp_path, {"id": "pc_b", "mid": "x", "at": T0, "reported": True})
    rep = reporter.build_report(tmp_path)
    assert rep["mid"] == _fp(tmp_path)
    assert [it["id"] for it in rep["items"]] == ["pc_a"]   # 只含未上报


def test_mark_reported(tmp_path):
    entstore.add_redeemed_card(tmp_path, {"id": "pc_a", "mid": "x", "at": T0})
    reporter.mark_reported(tmp_path, ["pc_a"])
    assert reporter.build_report(tmp_path)["items"] == []
