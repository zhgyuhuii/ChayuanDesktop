from chacmd.workspace import Workspace


def test_job_dir_uses_code_and_is_isolated(tmp_path):
    ws = Workspace(root=tmp_path)
    d = ws.ensure_job_dir(job_id="j1", code="world-rank-app")
    assert d.exists()
    assert d.name == "world-rank-app"
    assert (tmp_path / "world-rank-app").exists()


def test_done_marker_is_atomic(tmp_path):
    ws = Workspace(root=tmp_path)
    ws.ensure_job_dir(job_id="j1", code="c")
    assert ws.is_done("j1", "c") is False
    ws.mark_done("j1", "c", {"artifact": "out.zip"})
    assert ws.is_done("j1", "c") is True
    assert ws.read_done("j1", "c")["artifact"] == "out.zip"
