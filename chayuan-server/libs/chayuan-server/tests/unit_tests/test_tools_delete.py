from __future__ import annotations
import pytest


def test_delete_key_removes_node(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    from chayuan.server.config_panel import yaml_store
    yaml_store.save_updates("tool_settings.yaml", {"foo.use": True, "bar.use": False})
    assert yaml_store.delete_key("tool_settings.yaml", "foo") is True
    res = yaml_store.load_yaml("tool_settings.yaml")
    assert "foo" not in (res.doc or {}) and "bar" in (res.doc or {})
    assert yaml_store.delete_key("tool_settings.yaml", "nope") is False


def test_delete_config_unknown_key_raises(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    from chayuan.server.tools.config_service import delete_config
    with pytest.raises(KeyError):
        delete_config("___not_in_catalog___")
