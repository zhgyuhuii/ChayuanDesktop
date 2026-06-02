from fastapi import FastAPI
from fastapi.testclient import TestClient
# 触发 chayuan.server.utils 导入(它会副作用重置 settings),放在 _client 设
# AUTH_REQUIRED=False 之前,避免在测试中后导入时把 AUTH_REQUIRED 重置回 True。
import chayuan.server.utils  # noqa: F401
from chayuan.server.api_server.digital_human_routes import digital_human_router
from chayuan.server.video_generation import _helpers


def _client(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    from chayuan.settings import Settings
    monkeypatch.setattr(Settings.basic_settings, "AUTH_REQUIRED", False)
    app = FastAPI(); app.include_router(digital_human_router)
    return TestClient(app)


class _Role:
    def __init__(self, name="", persona="", ku_ids=None):
        self.name = name
        self.persona = persona
        self.ku_ids = ku_ids or []


class _Preset:
    def __init__(self, avatars=None, model="", ku_ids=None):
        self.avatars = avatars or []
        self.model = model
        self.ku_ids = ku_ids or []


class _FakeLLM:
    def __init__(self, content):
        self._content = content

    def invoke(self, messages):
        class _Resp:
            pass
        r = _Resp()
        r.content = self._content
        return r


def test_generate_multi_returns_role_segments(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    import chayuan.server.api_server.digital_human_routes as routes
    from chayuan.server.video_generation.digital_human import store as dh_store

    preset = _Preset(
        avatars=[_Role("小李", "热情主播", ["doc:kb1"]), _Role("小周", "理性助理")],
        model="openai::gpt-4o",
        ku_ids=["doc:default"],
    )
    monkeypatch.setattr(dh_store, "get_preset", lambda pid: preset)

    seen = {"calls": []}

    def _fake_retrieve(user, ku_ids, query_text, *, top_k=5):
        seen["calls"].append(list(ku_ids))
        return "ctx", [{"file_name": "f", "snippet": "s", "kb_name": "kb1", "kind": "document"}]

    monkeypatch.setattr(routes, "_retrieve_kb_context", _fake_retrieve)
    monkeypatch.setattr(
        "chayuan.server.utils.get_ChatOpenAI",
        lambda **k: _FakeLLM("[小李] 甲\n[小周] 乙"),
    )

    r = c.post("/api/v1/digital-human/script/generate-multi",
               json={"preset_id": "p1", "subject": "卖货", "template_id": "sell4"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [(s["role_index"], s["text"]) for s in body["role_segments"]] == [(0, "甲"), (1, "乙")]
    assert body["kb_used"] is True
    assert "sources" in body and len(body["sources"]) == 2
    roles = {s["role"] for s in body["sources"]}
    assert roles == {"小李", "小周"}
    # role0 用自己的 ku_ids,role1 回退到 preset.ku_ids
    assert seen["calls"][0] == ["doc:kb1"]
    assert seen["calls"][1] == ["doc:default"]


def test_generate_multi_no_kb(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    import chayuan.server.api_server.digital_human_routes as routes
    from chayuan.server.video_generation.digital_human import store as dh_store

    preset = _Preset(avatars=[_Role("小李"), _Role("小周")], model="m1")
    monkeypatch.setattr(dh_store, "get_preset", lambda pid: preset)
    monkeypatch.setattr(routes, "_retrieve_kb_context", lambda *a, **k: (None, []))
    monkeypatch.setattr(
        "chayuan.server.utils.get_ChatOpenAI",
        lambda **k: _FakeLLM("[小李] 一段\n无标签延续。\n[小周] 另一段"),
    )

    r = c.post("/api/v1/digital-human/script/generate-multi",
               json={"preset_id": "p1", "subject": "主题"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kb_used"] is False
    assert body["sources"] == []
    assert body["role_segments"][0]["role_index"] == 0
    assert "无标签延续" in body["role_segments"][0]["text"]
    assert body["role_segments"][1]["role_index"] == 1


def test_generate_multi_missing_preset(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    from chayuan.server.video_generation.digital_human import store as dh_store
    monkeypatch.setattr(dh_store, "get_preset", lambda pid: None)
    r = c.post("/api/v1/digital-human/script/generate-multi",
               json={"preset_id": "nope", "subject": "x"})
    assert r.status_code == 404


def test_generate_multi_model_override(monkeypatch, tmp_path):
    """body.model 优先于 preset.model 透传到 get_ChatOpenAI(Med4)。"""
    c = _client(monkeypatch, tmp_path)
    import chayuan.server.api_server.digital_human_routes as routes
    from chayuan.server.video_generation.digital_human import store as dh_store

    preset = _Preset(avatars=[_Role("小李"), _Role("小周")], model="preset::base")
    monkeypatch.setattr(dh_store, "get_preset", lambda pid: preset)
    monkeypatch.setattr(routes, "_retrieve_kb_context", lambda *a, **k: (None, []))

    seen = {"model": None}

    def _fake_get_chat(**kwargs):
        seen["model"] = kwargs.get("model_name")
        return _FakeLLM("[小李] 甲\n[小周] 乙")

    monkeypatch.setattr("chayuan.server.utils.get_ChatOpenAI", _fake_get_chat)

    r = c.post("/api/v1/digital-human/script/generate-multi",
               json={"preset_id": "p1", "subject": "主题", "model": "user::override"})
    assert r.status_code == 200, r.text
    assert seen["model"] == "user::override"


def test_generate_multi_product_ref_multimodal(monkeypatch, tmp_path):
    """有 product_ref 时复用 script.py 的抽帧 + 多模态 VLM 路径(Med3)。"""
    c = _client(monkeypatch, tmp_path)
    import chayuan.server.api_server.digital_human_routes as routes
    from chayuan.server.video_generation.digital_human import store as dh_store
    from chayuan.server.video_generation.steps import script as script_mod

    preset = _Preset(avatars=[_Role("小李"), _Role("小周")], model="vl::model")
    monkeypatch.setattr(dh_store, "get_preset", lambda pid: preset)
    monkeypatch.setattr(routes, "_retrieve_kb_context", lambda *a, **k: (None, []))

    seen = {"urls": None, "model": None, "called": False}

    monkeypatch.setattr(
        script_mod, "_product_image_data_urls",
        lambda ref: ["data:image/jpeg;base64,AAAA"],
    )

    def _fake_mm(prompt, urls, *, model=None):
        seen["called"] = True
        seen["urls"] = urls
        seen["model"] = model
        return "[小李] 看图说点。\n[小周] 我也看。"

    monkeypatch.setattr(script_mod, "_invoke_llm_multimodal", _fake_mm)
    # 纯文本路径不应被走到:断言它若被调用直接失败。
    monkeypatch.setattr(
        "chayuan.server.utils.get_ChatOpenAI",
        lambda **k: (_ for _ in ()).throw(AssertionError("不应走纯文本 invoke")),
    )

    r = c.post("/api/v1/digital-human/script/generate-multi",
               json={"preset_id": "p1", "subject": "卖货", "product_ref": "product:abc.jpg"})
    assert r.status_code == 200, r.text
    assert seen["called"] is True
    assert seen["urls"] == ["data:image/jpeg;base64,AAAA"]
    assert seen["model"] == "vl::model"
    body = r.json()
    assert [s["role_index"] for s in body["role_segments"]] == [0, 1]


def test_generate_multi_product_ref_no_image_falls_back_text(monkeypatch, tmp_path):
    """product_ref 解析不到可用图像 -> 降级纯文本 invoke(不报错)。"""
    c = _client(monkeypatch, tmp_path)
    import chayuan.server.api_server.digital_human_routes as routes
    from chayuan.server.video_generation.digital_human import store as dh_store
    from chayuan.server.video_generation.steps import script as script_mod

    preset = _Preset(avatars=[_Role("小李"), _Role("小周")], model="m1")
    monkeypatch.setattr(dh_store, "get_preset", lambda pid: preset)
    monkeypatch.setattr(routes, "_retrieve_kb_context", lambda *a, **k: (None, []))
    monkeypatch.setattr(script_mod, "_product_image_data_urls", lambda ref: [])
    monkeypatch.setattr(
        "chayuan.server.utils.get_ChatOpenAI",
        lambda **k: _FakeLLM("[小李] 甲\n[小周] 乙"),
    )

    r = c.post("/api/v1/digital-human/script/generate-multi",
               json={"preset_id": "p1", "subject": "x", "product_ref": "product:missing.jpg"})
    assert r.status_code == 200, r.text
    assert len(r.json()["role_segments"]) == 2
