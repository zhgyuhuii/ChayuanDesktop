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


from chayuan.server.video_generation.digital_human.schemas import (
    DigitalHumanPreset as _P, AvatarSlot as _Slot,
)

def test_preset_backfills_avatars_from_legacy_ref():
    # 旧 presets.json 行没有 avatars/compose_mode → 应回填且默认 single
    p = _P(id="p1", name="A", avatar_ref="user:f.mp4", avatar_kind="video", created=1.0)
    assert p.compose_mode == "single"
    assert len(p.avatars) == 1
    assert p.avatars[0].ref == "user:f.mp4" and p.avatars[0].kind == "video"

def test_preset_mirrors_first_avatar_to_legacy_ref():
    # 给了 avatars → avatar_ref/kind 应镜像首槽(旧单形象消费方不破)
    p = _P(id="p2", name="B", avatar_ref="", avatar_kind="image",
           avatars=[_Slot(ref="user:a.png", kind="image", lines="台词1"),
                    _Slot(ref="user:b.mp4", kind="video")],
           compose_mode="coframe", layout="pip")
    assert p.avatar_ref == "user:a.png" and p.avatar_kind == "image"
    assert p.avatars[1].lines == ""


def test_create_preset_with_avatars(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    p = dh_store.create_preset(
        name="多形象", avatar_ref="user:a.png", avatar_kind="image",
        avatars=[{"ref": "user:a.png", "kind": "image"},
                 {"ref": "user:b.mp4", "kind": "video", "lines": "你好"}],
        compose_mode="sequential", layout="side",
    )
    assert p.compose_mode == "sequential" and len(p.avatars) == 2
    got = dh_store.get_preset(p.id)
    assert got is not None and got.avatars[1].lines == "你好"


from chayuan.server.video_generation.digital_human.reference import build_reference_image as _bri

def test_build_reference_image_empty_raises():
    import pytest
    with pytest.raises(RuntimeError):
        _bri([])

def test_build_reference_image_fallback_first(tmp_path):
    # 非图片文件 → cv2 读不出(分数都 -1)→ 回退第一张
    a = tmp_path / "a.png"; a.write_bytes(b"notimg")
    b = tmp_path / "b.png"; b.write_bytes(b"notimg")
    assert _bri([str(a), str(b)]) == str(a)


def test_preset_slot_voice_roundtrip(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    p = dh_store.create_preset(
        name="m", avatar_ref="user:a", avatar_kind="video",
        avatars=[{"ref": "user:a", "kind": "video",
                  "voice_provider": "sherpa", "voice_name": "vz"}],
        compose_mode="coframe")
    got = dh_store.get_preset(p.id)
    assert got is not None
    assert got.avatars[0].voice_provider == "sherpa"
    assert got.avatars[0].voice_name == "vz"


def test_preset_canvas_size_roundtrip(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    p = dh_store.create_preset(name="m", avatar_ref="user:a", avatar_kind="video",
                               video_width=1280, video_height=720)
    got = dh_store.get_preset(p.id)
    assert got is not None and got.video_width == 1280 and got.video_height == 720

def test_preset_canvas_default(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    p = dh_store.create_preset(name="m", avatar_ref="user:a", avatar_kind="video")
    assert p.video_width == 720 and p.video_height == 1280


from chayuan.server.video_generation.digital_human.schemas import (
    AvatarSlot as _Slot, DhGenerateRequest as _Gen,
)

def test_role_fields_defaults_and_roundtrip():
    s = _Slot(ref="user:a.png", kind="image", name="小李",
              voice_provider="sherpa", voice_name="vz",
              voice_rate=1.1, voice_volume=0.9, language="zh", x=0.1, y=0.2, scale=0.5)
    d = s.model_dump()
    assert d["name"] == "小李" and d["voice_rate"] == 1.1 and d["x"] == 0.1
    s2 = _Slot(ref="user:b.png")
    assert s2.name == "" and s2.voice_rate == 1.0 and s2.voice_volume == 1.0 and s2.scale == 1.0

def test_generate_request_scripts():
    g = _Gen(preset_id="p", text="x", script="一套台词", role_scripts=["甲词", "乙词"])
    assert g.script == "一套台词" and g.role_scripts == ["甲词", "乙词"]
    g2 = _Gen(preset_id="p", text="x")
    assert g2.script is None and g2.role_scripts is None


def test_preset_subtitle_enabled_default(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    p = dh_store.create_preset(name="m", avatar_ref="user:a", avatar_kind="video")
    assert p.subtitle_enabled is True


def test_avatar_slot_schema_has_no_role_ku_ids():
    """角色级 ku_ids 应已彻底移除(知识库收敛为 preset 单一真源)。"""
    from chayuan.server.video_generation.digital_human.schemas import AvatarSlotSchema
    assert "ku_ids" not in AvatarSlotSchema.model_fields
