"""数字人预设绑定字段(model/ku_ids/allow_model_override/allow_kb_override)。

待 py312 跑:
PYTHONPATH=/work/chayuan-desktop/chayuan-server/libs/chayuan-server \
  pytest -q libs/chayuan-server/tests/unit_tests/test_dh_preset_bind_fields.py
"""
from __future__ import annotations


def test_defaults_backward_compatible():
    # 旧 presets.json 行(无新字段)→ 默认值,不破坏向后兼容
    from chayuan.server.video_generation.digital_human.schemas import DigitalHumanPreset
    d = DigitalHumanPreset(id="i", name="n")
    assert d.model == ""
    assert d.ku_ids == []
    assert d.allow_model_override is True
    assert d.allow_kb_override is True


def test_schema_accepts_bind_fields():
    # 纯构造,不落盘
    from chayuan.server.video_generation.digital_human.schemas import DigitalHumanPreset
    d = DigitalHumanPreset(
        id="i", name="n", model="ollama::qwen3",
        ku_ids=["doc:kb1", "src:s1"],
        allow_model_override=False, allow_kb_override=True,
    )
    assert d.model == "ollama::qwen3"
    assert d.ku_ids == ["doc:kb1", "src:s1"]
    assert d.allow_model_override is False
    assert d.allow_kb_override is True


def test_create_preset_bind_fields(monkeypatch, tmp_path):
    # store 用 dh_presets_path() 定位 presets.json;monkeypatch 到 tmp 目录
    from chayuan.server.video_generation.digital_human import store
    presets = tmp_path / "presets.json"
    monkeypatch.setattr(store, "dh_presets_path", lambda: str(presets))
    monkeypatch.setattr(store, "digital_human_dir", lambda *, create=False: str(tmp_path))

    p = store.create_preset(
        name="x", model="ollama::qwen3", ku_ids=["doc:kb1"],
        allow_model_override=False, allow_kb_override=True,
    )
    assert p.model == "ollama::qwen3"
    assert p.ku_ids == ["doc:kb1"]
    assert p.allow_model_override is False
    assert p.allow_kb_override is True

    # 落盘可重读且字段保留
    reloaded = store.get_preset(p.id)
    assert reloaded is not None
    assert reloaded.model == "ollama::qwen3"
    assert reloaded.ku_ids == ["doc:kb1"]
    assert reloaded.allow_model_override is False


def test_update_preset_bind_fields(monkeypatch, tmp_path):
    from chayuan.server.video_generation.digital_human import store
    presets = tmp_path / "presets.json"
    monkeypatch.setattr(store, "dh_presets_path", lambda: str(presets))
    monkeypatch.setattr(store, "digital_human_dir", lambda *, create=False: str(tmp_path))

    p = store.create_preset(name="x")
    assert p.model == "" and p.ku_ids == []
    upd = store.update_preset(
        p.id, model="edge::gpt", ku_ids=["doc:kb2"],
        allow_model_override=False, allow_kb_override=False,
    )
    assert upd is not None
    assert upd.model == "edge::gpt"
    assert upd.ku_ids == ["doc:kb2"]
    assert upd.allow_model_override is False
    assert upd.allow_kb_override is False
