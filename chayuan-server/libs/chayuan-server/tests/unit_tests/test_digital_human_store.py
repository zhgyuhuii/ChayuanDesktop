import os
from chayuan.server.video_generation import _helpers

def test_digital_human_dirs(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    d = _helpers.digital_human_dir(create=True)
    assert os.path.isdir(d)
    assert d.endswith(os.path.join("data", "digital_human"))
    av = _helpers.dh_avatars_dir(create=True)
    assert os.path.isdir(av) and av.endswith(os.path.join("digital_human", "avatars"))
    assert _helpers.dh_presets_path().endswith("presets.json")


from chayuan.server.video_generation.digital_human.schemas import (
    DigitalHumanPreset, DhGenerateRequest, DhTaskStatus,
)

def test_dh_schemas_roundtrip():
    p = DigitalHumanPreset(
        id="p1", name="主播A", avatar_ref="bundled:female1",
        avatar_kind="video", is_greenscreen=False,
        voice_provider="clone", voice_name="clone:abc", created=1.0,
    )
    assert p.model_dump()["name"] == "主播A"
    req = DhGenerateRequest(preset_id="p1", text="你好")
    assert req.template == "none" and req.matte is False
    st = DhTaskStatus(task_id="t1", state="pending", progress=0)
    assert st.state == "pending"


from chayuan.server.video_generation.digital_human import store as dh_store

def test_preset_crud(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    p = dh_store.create_preset(name="A", avatar_ref="bundled:f1",
                               avatar_kind="video", voice_provider="clone",
                               voice_name="clone:x", is_greenscreen=True)
    assert p.id and dh_store.list_presets()[0].name == "A"
    p2 = dh_store.update_preset(p.id, name="B")
    assert p2 is not None and p2.name == "B"
    assert dh_store.get_preset(p.id).name == "B"
    assert dh_store.delete_preset(p.id) is True
    assert dh_store.list_presets() == []

def test_list_avatars_bundled_and_user(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    av_dir = _helpers.dh_avatars_dir(create=True)
    open(os.path.join(av_dir, "u1.mp4"), "wb").write(b"x")
    items = dh_store.list_avatars()
    assert any(a["ref"] == "user:u1.mp4" and a["kind"] == "video" for a in items)

    bundled_dir = tmp_path / "bundled"
    bundled_dir.mkdir()
    (bundled_dir / "avatar.mp4").write_bytes(b"x")
    monkeypatch.setattr(dh_store, "_bundled_avatars_root", lambda: str(bundled_dir))
    items2 = dh_store.list_avatars()
    assert any(a["ref"] == "bundled:avatar.mp4" and a["source"] == "bundled" for a in items2)


def test_product_dir_and_resolve(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    pdir = _helpers.dh_products_dir(create=True)
    assert os.path.isdir(pdir) and pdir.endswith(os.path.join("digital_human", "products"))
    open(os.path.join(pdir, "p1.png"), "wb").write(b"x")
    assert dh_store.resolve_product_path("product:p1.png").endswith("p1.png")
    assert dh_store.resolve_product_path("product:missing.png") is None
    assert dh_store.resolve_product_path("bad") is None
