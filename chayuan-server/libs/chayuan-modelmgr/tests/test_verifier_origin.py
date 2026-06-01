"""write_manifest origin 记录回归(Task 2.1)。"""
from __future__ import annotations

import json

from chayuan_modelmgr.verifier import MANIFEST_NAME, write_manifest


def test_write_manifest_records_origin(tmp_path):
    (tmp_path / "config.json").write_text("{}", encoding="utf-8")
    out = write_manifest(
        tmp_path,
        source="downloaded",
        origin={"source": "huggingface", "repo_id": "Qwen/X", "revision": "main"},
    )
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["source"] == "downloaded"
    assert data["origin"]["source"] == "huggingface"
    assert data["origin"]["repo_id"] == "Qwen/X"
    assert data["origin"]["revision"] == "main"


def test_write_manifest_origin_defaults_null(tmp_path):
    """不传 origin 时 payload 仍含 origin 键(值为 None / null)。"""
    (tmp_path / "config.json").write_text("{}", encoding="utf-8")
    out = write_manifest(tmp_path, source="imported")
    data = json.loads(out.read_text(encoding="utf-8"))
    assert "origin" in data
    assert data["origin"] is None
    assert out.name == MANIFEST_NAME
