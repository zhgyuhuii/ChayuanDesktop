from chayuan.server.license import engine

CFG = {"products": {"wps": 0}}  # bit0 = modules1


def _mock(monkeypatch):
    # 绕过真实验签:候选指纹任意,verify_shortcode 固定返回 kind=0/value=30 的有效结果
    monkeypatch.setattr(engine, "candidate_fingerprints", lambda root: ["1122334455667788"])
    monkeypatch.setattr(
        engine, "verify_shortcode",
        lambda serial, fp, keys: {"valid": True, "fields": {"kind": 0, "value": 30, "modules": 1}, "expireAt": None},
    )


def test_time_serials_stack(tmp_path, monkeypatch):
    _mock(monkeypatch)
    now = 1_700_000_000.0
    r1 = engine.redeem_shortcode(tmp_path, "SERIAL-A", CFG, now=now)
    assert r1["ok"] is True
    exp1 = engine._ts(r1["applied"][0]["timeExpireAt"])
    assert abs(exp1 - (now + 30 * 86400)) < 2          # 第一个:now+30天

    r2 = engine.redeem_shortcode(tmp_path, "SERIAL-B", CFG, now=now)   # 不同 serial
    assert r2["ok"] is True
    exp2 = engine._ts(r2["applied"][0]["timeExpireAt"])
    assert abs(exp2 - (now + 60 * 86400)) < 2          # 叠加:now+60天


def test_same_time_serial_dedup(tmp_path, monkeypatch):
    _mock(monkeypatch)
    now = 1_700_000_000.0
    assert engine.redeem_shortcode(tmp_path, "SERIAL-A", CFG, now=now)["ok"] is True
    r = engine.redeem_shortcode(tmp_path, "SERIAL-A", CFG, now=now)    # 同 serial
    assert r["ok"] is False and r["reason"] == "used"  # 去重拒绝
