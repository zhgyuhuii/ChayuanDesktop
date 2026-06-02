from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.api_server.digital_human_routes import digital_human_router
from chayuan.server.video_generation import _helpers
from chayuan.server.video_generation.digital_human import jobs as dh_jobs
from chayuan.server.video_generation.digital_human import engine as dh_engine


def _client(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    # AUTH_REQUIRED=true in the running environment — patch it off so the bare
    # TestClient (no JWT middleware) can exercise the routes without 401.
    from chayuan.settings import Settings
    monkeypatch.setattr(Settings.basic_settings, "AUTH_REQUIRED", False)
    app = FastAPI(); app.include_router(digital_human_router)
    return TestClient(app)


def test_preset_crud_endpoints(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    r = c.post("/api/v1/digital-human/presets", json={
        "name": "主播A", "avatar_ref": "bundled:f1", "avatar_kind": "video",
        "voice_provider": "clone", "voice_name": "clone:x"})
    assert r.status_code == 200
    pid = r.json()["id"]
    assert c.get("/api/v1/digital-human/presets").json()["items"][0]["name"] == "主播A"
    assert c.delete(f"/api/v1/digital-human/presets/{pid}").json()["deleted"] is True


def test_generate_enqueues(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    monkeypatch.setattr(dh_jobs, "submit", lambda **k: "tid123")
    r = c.post("/api/v1/digital-human/generate",
               json={"preset_id": "p1", "text": "你好", "width": 720, "height": 1280})
    assert r.status_code == 200 and r.json()["task_id"] == "tid123"


def test_upload_product(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    r = c.post("/api/v1/digital-human/products",
               files={"file": ("p.png", b"x", "image/png")})
    assert r.status_code == 200 and r.json()["ref"].startswith("product:")


def test_generate_passes_product(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    seen = {}
    monkeypatch.setattr(dh_jobs, "submit", lambda **k: seen.update(k) or "tid9")
    r = c.post("/api/v1/digital-human/generate",
               json={"preset_id": "p1", "text": "hi", "product_image": "product:p.png", "template": "corner"})
    assert r.status_code == 200 and r.json()["task_id"] == "tid9"
    assert seen.get("product_ref") == "product:p.png" and seen.get("template") == "corner"


def test_generate_passes_matte(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    seen = {}
    monkeypatch.setattr(dh_jobs, "submit", lambda **k: seen.update(k) or "tidM")
    r = c.post("/api/v1/digital-human/generate",
               json={"preset_id": "p1", "text": "hi", "product_image": "product:p.png",
                     "template": "bg", "matte": True})
    assert r.status_code == 200 and seen.get("matte") is True


def test_list_engines(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    r = c.get("/api/v1/digital-human/engines")
    assert r.status_code == 200
    items = r.json()["items"]
    ids = {e["id"] for e in items}
    assert ids == {"wav2lip", "sadtalker", "musetalk"}
    assert next(e for e in items if e["id"] == "wav2lip")["installed"] is True


def test_generate_passes_engine(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    seen = {}
    monkeypatch.setattr(dh_jobs, "submit", lambda **k: seen.update(k) or "tidE")
    r = c.post("/api/v1/digital-human/generate",
               json={"preset_id": "p1", "text": "hi", "engine": "musetalk"})
    assert r.status_code == 200 and seen.get("engine") == "musetalk"


def test_live_offer_relays(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    import chayuan.server.api_server.digital_human_routes as routes
    monkeypatch.setattr(routes, "_realtime_port_listening", lambda: True)

    class _Resp:
        status_code = 200

        def json(self):
            return {"sdp": "ANSWER", "type": "answer"}

        def raise_for_status(self):
            pass

    class _Client:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json, timeout=None):
            assert url.endswith(":18880/offer")
            return _Resp()

    monkeypatch.setattr("httpx.Client", _Client)
    r = c.post("/api/v1/digital-human/live/offer", json={"sdp": "OFFER", "type": "offer"})
    assert r.status_code == 200 and r.json()["sdp"] == "ANSWER"


def test_live_available(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    import chayuan.server.api_server.digital_human_routes as routes
    monkeypatch.setattr(routes, "_realtime_port_listening", lambda: True)
    r = c.get("/api/v1/digital-human/live/available")
    assert r.json()["available"] is True


def test_create_preset_route_accepts_avatars(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    r = c.post("/api/v1/digital-human/presets", json={
        "name": "X", "avatar_ref": "user:a.png", "avatar_kind": "image",
        "avatars": [{"ref": "user:a.png", "kind": "image"}],
        "compose_mode": "coframe", "layout": "pip"})
    assert r.status_code == 200
    data = r.json()
    assert data["compose_mode"] == "coframe" and len(data["avatars"]) == 1


def test_generate_passes_scripts(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    seen = {}
    monkeypatch.setattr(dh_jobs, "submit", lambda **k: (seen.update(k), "tid")[1])
    r = c.post("/api/v1/digital-human/generate",
               json={"preset_id": "p", "text": "x", "script": "一套", "role_scripts": ["甲", "乙"]})
    assert r.status_code == 200
    assert seen.get("script") == "一套" and seen.get("role_scripts") == ["甲", "乙"]


def test_retrieve_kb_context_helper(monkeypatch):
    """_retrieve_kb_context: ku_ids 非空走 kb_query.search,返回 (context, sources)。
    透传 top_k;命中含来源清单;空 ku_ids / 空 query / 检索抛错时返回 (None, [])。"""
    import chayuan.server.api_server.digital_human_routes as routes

    # 空 ku_ids -> (None, []),且不调检索
    assert routes._retrieve_kb_context({}, [], "主题") == (None, [])
    # 空 query -> (None, [])
    assert routes._retrieve_kb_context({}, ["doc:kb1"], "  ") == (None, [])

    seen = {}

    def _fake_search(subject, req):
        seen["ku_ids"] = list(req.ku_ids)
        seen["query"] = req.contents[0].text
        seen["top_k"] = req.options.top_k
        return {"data": {"items": [{"results": [
            {"source_type": "document", "text": "命中正文",
             "citation": {"file_name": "f.pdf", "kb_name": "kb1"}},
        ]}]}}

    monkeypatch.setattr("chayuan.server.kb_query.service.search", _fake_search)
    context, sources = routes._retrieve_kb_context(
        {"sub": "u1"}, ["doc:kb1", " "], "主题X", top_k=7,
    )
    assert seen["ku_ids"] == ["doc:kb1"]  # 空白项被过滤
    assert seen["query"] == "主题X"
    assert seen["top_k"] == 7  # top_k 透传
    assert context is not None and "命中正文" in context and "f.pdf" in context
    assert len(sources) == 1
    assert sources[0]["file_name"] == "f.pdf"
    assert sources[0]["kind"] == "document"

    # 检索抛错 -> 降级 (None, [])
    def _boom(subject, req):
        raise RuntimeError("kb down")

    monkeypatch.setattr("chayuan.server.kb_query.service.search", _boom)
    assert routes._retrieve_kb_context({}, ["doc:kb1"], "主题") == (None, [])


def test_format_kb_context_nondoc_fallback():
    """非文档源(向量 text 空)用 metadata/payload 兜底拼文本;结构化用 text;
    来源清单始终记一条(含 kind)。"""
    import chayuan.server.api_server.digital_human_routes as routes

    res = {"data": {"items": [
        {"kind": "vector", "results": [
            # vector text 空 -> 用 metadata 兜底
            {"source_type": "vector", "text": "",
             "metadata": {"name": "省电空调", "price": 1999, "blank": ""},
             "citation": {"collection": "products", "source_name": "向量库A"}},
        ]},
        {"kind": "structured", "results": [
            {"source_type": "structured", "text": "命中 3 行结构化数据",
             "citation": {"source_name": "订单库", "table": "orders"}},
        ]},
    ]}}
    context, sources = routes._format_kb_context(res)
    assert context is not None
    assert "name=省电空调" in context and "price=1999" in context
    assert "blank" not in context  # 空值被跳过
    assert "命中 3 行结构化数据" in context
    assert len(sources) == 2
    kinds = {s["kind"] for s in sources}
    assert kinds == {"vector", "structured"}

    # 既无 text 又无可读 metadata 的向量命中:跳过正文但 sources 仍记一条
    res2 = {"data": {"items": [
        {"kind": "vector", "results": [
            {"source_type": "vector", "text": "", "metadata": {},
             "citation": {"collection": "c1", "source_name": "向量库B"}},
        ]},
    ]}}
    context2, sources2 = routes._format_kb_context(res2)
    assert context2 is None  # 无可读文本 -> 不注入 grounding 头
    assert len(sources2) == 1 and sources2[0]["kind"] == "vector"


def test_script_generate_returns_kb_used_and_sources(monkeypatch, tmp_path):
    """/script/generate 响应含 kb_used + sources;kb_top_k 透传到检索。"""
    c = _client(monkeypatch, tmp_path)
    import chayuan.server.api_server.digital_human_routes as routes

    seen = {}

    def _fake_retrieve(user, ku_ids, query_text, *, top_k=5):
        seen["ku_ids"] = list(ku_ids)
        seen["top_k"] = top_k
        return "GROUND", [{"file_name": "f.pdf", "snippet": "x", "kb_name": "kb1", "kind": "document"}]

    monkeypatch.setattr(routes, "_retrieve_kb_context", _fake_retrieve)
    monkeypatch.setattr(
        "chayuan.server.video_generation.steps.script.generate_script",
        lambda *a, **k: "文案",
    )
    r = c.post("/api/v1/digital-human/script/generate",
               json={"subject": "空调推广", "ku_ids": ["doc:kb1"], "kb_top_k": 8})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["script"] == "文案"
    assert data["kb_used"] is True
    assert len(data["sources"]) == 1 and data["sources"][0]["file_name"] == "f.pdf"
    assert seen["top_k"] == 8

    # 空命中 -> kb_used False, sources []
    monkeypatch.setattr(routes, "_retrieve_kb_context",
                        lambda *a, **k: (None, []))
    r2 = c.post("/api/v1/digital-human/script/generate",
                json={"subject": "空调推广"})
    assert r2.status_code == 200 and r2.json()["kb_used"] is False
    assert r2.json()["sources"] == []


def test_script_from_video_passes_model_and_kb(monkeypatch, tmp_path):
    """/script/from-video: model / ku_ids 经表单透传 ->
    _retrieve_kb_context 拿到 ku_ids,generate_script 拿到 model + kb_context。
    mock 掉 ffmpeg 抽音轨 / ASR 转写 / KB 检索 / generate_script。"""
    c = _client(monkeypatch, tmp_path)
    import chayuan.server.api_server.digital_human_routes as routes

    # 抽音轨直接成功(不真跑 ffmpeg)
    monkeypatch.setattr("subprocess.run", lambda *a, **k: None)
    # ASR 转写返回固定 transcript
    monkeypatch.setattr(
        "chayuan.server.modality.audio.AudioPipeline._transcribe_via_sidecar",
        lambda self, wav: "这是参考视频的转写文本",
    )
    # KB 检索:断言拿到 ku_ids + transcript,返回 grounding 块
    kb_seen = {}

    def _fake_retrieve(user, ku_ids, query_text, *, top_k=5):
        kb_seen["ku_ids"] = list(ku_ids)
        kb_seen["query"] = query_text
        kb_seen["top_k"] = top_k
        return "GROUND", [{"file_name": "f.pdf", "snippet": "s", "kb_name": "kb1", "kind": "document"}]

    monkeypatch.setattr(routes, "_retrieve_kb_context", _fake_retrieve)
    # generate_script:断言 model + kb_context 透传
    gen_seen = {}

    def _fake_gen(subject, *, model=None, kb_context=None, **kw):
        gen_seen["subject"] = subject
        gen_seen["model"] = model
        gen_seen["kb_context"] = kb_context
        return "改写后的口播文案"

    monkeypatch.setattr(
        "chayuan.server.video_generation.steps.script.generate_script", _fake_gen,
    )

    r = c.post(
        "/api/v1/digital-human/script/from-video",
        files={"file": ("ref.mp4", b"\x00\x01", "video/mp4")},
        data={"model": "openai::gpt-4o", "ku_ids": ["doc:kb1", "src:s2"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["script"] == "改写后的口播文案"
    assert kb_seen["ku_ids"] == ["doc:kb1", "src:s2"]
    assert "这是参考视频的转写文本" in kb_seen["query"]
    assert gen_seen["model"] == "openai::gpt-4o"
    assert gen_seen["kb_context"] == "GROUND"
    assert "这是参考视频的转写文本" in gen_seen["subject"]
    assert r.json()["kb_used"] is True
    assert len(r.json()["sources"]) == 1 and r.json()["sources"][0]["file_name"] == "f.pdf"



# ---- /tasks/{tid}/to-timeline: 注册各段 material + 模式建轨 + 失败降级 ----

class _St:
    """轻量 DhTaskStatus 替身(只带 to-timeline 用到的字段)。"""
    def __init__(self, **kw):
        self.task_id = kw.get("task_id", "t1")
        self.state = kw.get("state", "complete")
        self.result_path = kw.get("result_path", "/tmp/dh/out.mp4")
        self.script = kw.get("script", "甲: 你好 乙: 再见")
        self.preset_id = kw.get("preset_id", "p1")
        self.segments = kw.get("segments", [])


class _Slot:
    def __init__(self, name="", x=0.0, y=0.0, scale=1.0):
        self.name, self.x, self.y, self.scale = name, x, y, scale


class _Preset:
    def __init__(self, compose_mode="coframe", avatars=None):
        self.compose_mode = compose_mode
        self.avatars = avatars or []


def _to_timeline_env(monkeypatch, *, status, preset, create_fail_on=None):
    """patch get_status / os 文件探测 / create_material / get_preset / 时长探测。
    create_fail_on: 命中该 source 时 create_material 抛错(模拟段注册失败)。"""
    import chayuan.server.api_server.digital_human_routes as routes
    from chayuan.server.video_generation.store import materials as materials_store
    from chayuan.server.video_generation.digital_human import store as dh_store

    monkeypatch.setattr(dh_jobs, "get_status", lambda tid: status)
    monkeypatch.setattr(dh_store, "get_preset", lambda pid: preset)
    # os 文件探测:所有路径都视为存在、固定大小
    monkeypatch.setattr(routes.os.path, "isfile", lambda p: True)
    monkeypatch.setattr(routes.os.path, "getsize", lambda p: 1234)
    # 时长探测
    monkeypatch.setattr(
        "chayuan.server.video_generation.steps.subtitle._probe_audio_duration_ms",
        lambda p: 8000,
    )

    made = {"calls": []}

    def _fake_create(*, source, name, path, owner_id=None, mime="", size=0,
                     duration_ms=0, tags=None, **kw):
        made["calls"].append({"source": source, "tags": list(tags or [])})
        if create_fail_on and source == create_fail_on:
            raise RuntimeError("create boom")
        return {"material_id": f"mid-{source}-{len(made['calls'])}",
                "source": source, "name": name, "tags": list(tags or [])}

    monkeypatch.setattr(materials_store, "create_material", _fake_create)
    return made


def test_to_timeline_coframe_registers_segments_and_multitrack(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    segs = [
        {"role_index": 0, "path": "/tmp/dh/r0.mp4", "text": "你好", "duration_ms": 3000},
        {"role_index": 1, "path": "/tmp/dh/r1.mp4", "text": "再见", "duration_ms": 5000},
    ]
    st = _St(segments=segs, preset_id="p1")
    preset = _Preset(compose_mode="coframe",
                     avatars=[_Slot("甲", 0.1, 0.2, 0.5), _Slot("乙", 0.6, 0.2, 0.5)])
    made = _to_timeline_env(monkeypatch, status=st, preset=preset)

    r = c.post("/api/v1/digital-human/tasks/t1/to-timeline")
    assert r.status_code == 200, r.text
    data = r.json()
    # ① materials = 成片 + 各段
    mats = data["materials"]
    assert len(mats) == 3
    assert mats[0]["source"] == "digital_human"
    assert mats[1]["source"] == "digital_human_role"
    assert mats[2]["source"] == "digital_human_role"
    assert any("role_0" in m["tags"] for m in mats)
    assert any("role_1" in m["tags"] for m in mats)
    # ② timeline 多轨:主轨空 + 每角色轨 + 字幕轨
    tracks = data["timeline"]["tracks"]
    ids = [t["id"] for t in tracks]
    assert ids[0] == "dh-main" and not tracks[0]["clips"]
    assert "dh-role-0" in ids and "dh-role-1" in ids
    assert any(t["kind"] == "subtitle" for t in tracks)
    # 段 clip 落到对应角色轨
    role0 = next(t for t in tracks if t["id"] == "dh-role-0")
    assert len(role0["clips"]) == 1 and role0["clips"][0]["out_ms"] == 3000


def test_to_timeline_segment_create_failure_degrades_to_single(monkeypatch, tmp_path):
    """某段 create_material 抛错 -> 整体退回单片,不 500;只返成片 material。"""
    c = _client(monkeypatch, tmp_path)
    segs = [
        {"role_index": 0, "path": "/tmp/dh/r0.mp4", "text": "你好", "duration_ms": 3000},
        {"role_index": 1, "path": "/tmp/dh/r1.mp4", "text": "再见", "duration_ms": 5000},
    ]
    st = _St(segments=segs, preset_id="p1")
    preset = _Preset(compose_mode="coframe", avatars=[_Slot("甲"), _Slot("乙")])
    _to_timeline_env(monkeypatch, status=st, preset=preset,
                     create_fail_on="digital_human_role")

    r = c.post("/api/v1/digital-human/tasks/t1/to-timeline")
    assert r.status_code == 200, r.text
    data = r.json()
    # 降级:只剩成片 material
    assert len(data["materials"]) == 1
    assert data["materials"][0]["source"] == "digital_human"
    # timeline 退回单片(单视频轨 + 字幕轨,无 dh-role-*)
    ids = [t["id"] for t in data["timeline"]["tracks"]]
    assert "dh-video" in ids
    assert not any(i.startswith("dh-role-") for i in ids)


def test_to_timeline_legacy_no_segments_single(monkeypatch, tmp_path):
    """旧任务无 segments -> 退回单片,只返成片 material。"""
    c = _client(monkeypatch, tmp_path)
    st = _St(segments=[], preset_id="")
    _to_timeline_env(monkeypatch, status=st, preset=None)

    r = c.post("/api/v1/digital-human/tasks/t1/to-timeline")
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["materials"]) == 1
    ids = [t["id"] for t in data["timeline"]["tracks"]]
    assert "dh-video" in ids
