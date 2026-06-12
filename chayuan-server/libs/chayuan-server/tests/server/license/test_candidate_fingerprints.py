from pathlib import Path
from chayuan.server.license.fingerprint import candidate_fingerprints, fingerprint
from chayuan.server.license import fingerprint_home


def test_candidates_include_main_and_home(tmp_path, monkeypatch):
    # 固定 home → 已知 fpHome
    monkeypatch.setattr(fingerprint_home.os.path, "expanduser", lambda _p: "/home/alice")
    cands = candidate_fingerprints(tmp_path)
    assert fingerprint(tmp_path).lower() in cands          # 主指纹(fpOS)在内
    assert "0da135ff2ca62640" in cands                     # fpHome(/home/alice)在内
    assert all(len(c) == 16 for c in cands)                # 全 16hex
    assert len(cands) == len(set(cands))                   # 去重


def test_random_not_written_to_fixed(tmp_path, monkeypatch):
    # OS 标识不可读 → 随机兜底;随机值不得写入固定共享文件,且二次调用也不得
    import chayuan.server.license.fingerprint as fp
    monkeypatch.setattr(fp, "_os_raw_id", lambda: "")
    monkeypatch.setattr(fp, "_fixed_id_path", lambda: tmp_path / "fixed" / "machine.id")
    fp.fingerprint(tmp_path)
    assert not (tmp_path / "fixed" / "machine.id").exists()
    fp.fingerprint(tmp_path)  # 二次调用:legacy 已有随机值,仍不得污染 fixed
    assert not (tmp_path / "fixed" / "machine.id").exists()


def test_os_id_written_to_fixed(tmp_path, monkeypatch):
    # OS 标识可读 → 确定性,应写入固定共享文件(保证两端同源有效)
    import chayuan.server.license.fingerprint as fp
    monkeypatch.setattr(fp, "_os_raw_id", lambda: "real-machine-id-1234")
    monkeypatch.setattr(fp, "_fixed_id_path", lambda: tmp_path / "fixed" / "machine.id")
    fp.fingerprint(tmp_path)
    assert (tmp_path / "fixed" / "machine.id").exists()
