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
    # OS 标识不可读 → 走随机兜底;随机值不得写入固定共享文件
    import chayuan.server.license.fingerprint as fp
    monkeypatch.setattr(fp, "_os_raw_id", lambda: "")
    monkeypatch.setattr(fp, "_fixed_id_path", lambda: tmp_path / "fixed" / "machine.id")
    fp.fingerprint(tmp_path)  # 触发生成
    assert not (tmp_path / "fixed" / "machine.id").exists()  # 随机没污染共享文件
