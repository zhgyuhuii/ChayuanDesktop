from chayuan.server.video_generation.digital_human import engine as dh_engine
from chayuan.server.video_generation.digital_human import jobs as dh_jobs
from chayuan.server.video_generation import _helpers
import os, uuid

class _FakeEngine:
    def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
        if on_progress: on_progress(50)
        open(out_path, "wb").write(b"mp4")
        return out_path

def test_engine_protocol_shape():
    e = _FakeEngine()
    seen = []
    out = e.generate(avatar_path="a", audio_path="b", out_path="/tmp/o.mp4",
                     width=720, height=1280, on_progress=seen.append)
    assert out.endswith("o.mp4") and seen == [50]

def test_get_engine_returns_wav2lip():
    e = dh_engine.get_engine()
    assert hasattr(e, "generate")


import importlib.util, pytest

@pytest.mark.skipif(importlib.util.find_spec("torch") is None, reason="no torch")
def test_wav2lip_module_importable():
    from chayuan.server.video_generation.digital_human.wav2lip import infer
    assert hasattr(infer, "load_models") and hasattr(infer, "run")


def test_job_pipeline_success(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    def fake_tts(text, preset, audio_path):
        open(audio_path, "wb").write(b"wav"); return audio_path
    monkeypatch.setattr(dh_jobs, "_synthesize_narration", fake_tts)
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            if on_progress: on_progress(80)
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda eid="wav2lip": _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")

    pid = dh_jobs.store.create_preset(name="A", avatar_ref="bundled:f1",
                                      avatar_kind="video").id
    tid = uuid.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "你好", "width": 720, "height": 1280}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    st = dh_jobs.get_status(tid)
    assert st.state == "complete" and st.progress == 100
    assert st.result_path and os.path.isfile(st.result_path)


def test_job_pipeline_missing_preset(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    tid = uuid.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": "nope", "text": "x", "width": 720, "height": 1280}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    assert dh_jobs.get_status(tid).state == "failed"


def test_job_pipeline_with_product(monkeypatch, tmp_path):
    import uuid as _uuid
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    def fake_tts(text, preset, audio_path):
        open(audio_path, "wb").write(b"wav"); return audio_path
    monkeypatch.setattr(dh_jobs, "_synthesize_narration", fake_tts)
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda eid="wav2lip": _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    monkeypatch.setattr(dh_jobs, "resolve_product_path", lambda ref: str(tmp_path / "prod.png"))
    (tmp_path / "prod.png").write_bytes(b"x")
    called = {}
    def fake_render(**kw):
        called.update(kw); open(kw["out_path"], "wb").write(b"final"); return kw["out_path"]
    monkeypatch.setattr(dh_jobs, "render_with_product", fake_render)
    monkeypatch.setattr(dh_jobs, "_probe_duration_ms", lambda p: 5000)

    pid = dh_jobs.store.create_preset(name="A", avatar_ref="bundled:f1", avatar_kind="video").id
    tid = _uuid.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "你好", "width": 720, "height": 1280,
                             "product_ref": "product:prod.png", "template": "corner"}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    st = dh_jobs.get_status(tid)
    assert st.state == "complete"
    assert called.get("template") == "corner"
    assert st.result_path.endswith("digital_human.mp4")


def test_job_pipeline_matte(monkeypatch, tmp_path):
    import uuid as _uuid
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    monkeypatch.setattr(dh_jobs, "_synthesize_narration", lambda t, p, a: (open(a, "wb").write(b"w"), a)[1])
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda eid="wav2lip": _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    monkeypatch.setattr(dh_jobs, "resolve_product_path", lambda ref: str(tmp_path / "p.png"))
    (tmp_path / "p.png").write_bytes(b"x")
    monkeypatch.setattr(dh_jobs, "_probe_duration_ms", lambda p: 4000)
    seen = {"matte": 0, "plain": 0}
    def fake_matte(**kw):
        seen["matte"] += 1; open(kw["out_path"], "wb").write(b"m"); return kw["out_path"]
    def fake_plain(**kw):
        seen["plain"] += 1; open(kw["out_path"], "wb").write(b"p"); return kw["out_path"]
    monkeypatch.setattr(dh_jobs, "render_with_product_matte", fake_matte)
    monkeypatch.setattr(dh_jobs, "render_with_product", fake_plain)

    pid = dh_jobs.store.create_preset(name="A", avatar_ref="bundled:f1", avatar_kind="video").id
    tid = _uuid.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "hi", "width": 720, "height": 1280,
                             "product_ref": "product:p.png", "template": "bg", "matte": True}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    assert dh_jobs.get_status(tid).state == "complete"
    assert seen["matte"] == 1 and seen["plain"] == 0


def test_engine_registry_listing():
    items = dh_engine.list_engines()
    ids = {e["id"] for e in items}
    assert ids == {"wav2lip", "sadtalker", "musetalk"}
    w = next(e for e in items if e["id"] == "wav2lip")
    assert w["builtin"] is True and w["kind"] == "cpu" and w["installed"] is True
    g = next(e for e in items if e["id"] == "sadtalker")
    assert g["builtin"] is False and g["kind"] == "gpu" and g["installed"] is False
    assert g["input"] == "image"
    assert next(e for e in items if e["id"] == "musetalk")["input"] == "video"

def test_get_engine_default_is_wav2lip():
    assert isinstance(dh_engine.get_engine(), dh_engine.Wav2LipEngine)
    assert isinstance(dh_engine.get_engine("wav2lip"), dh_engine.Wav2LipEngine)

def test_get_engine_gpu_placeholder_raises_on_generate():
    spec = dh_engine.EngineSpec("xfake", "X", "gpu", "image", False)
    import pytest
    with pytest.raises(RuntimeError, match="未安装"):
        dh_engine._UnavailableGpuEngine(spec).generate(
            avatar_path="a", audio_path="b", out_path="o", width=720, height=1280)

def test_get_engine_unknown_raises():
    import pytest
    with pytest.raises(RuntimeError, match="未知引擎"):
        dh_engine.get_engine("nope")


def test_job_pipeline_engine_passthrough(monkeypatch, tmp_path):
    import uuid as _uuid
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    monkeypatch.setattr(dh_jobs, "_synthesize_narration", lambda t, p, a: (open(a, "wb").write(b"w"), a)[1])
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    seen = {}
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda eid="wav2lip": seen.update(engine=eid) or _E())

    pid = dh_jobs.store.create_preset(name="A", avatar_ref="bundled:f1", avatar_kind="video").id
    tid = _uuid.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "hi", "width": 720, "height": 1280,
                             "product_ref": None, "template": "none", "matte": False, "engine": "sadtalker"}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    assert seen.get("engine") == "sadtalker"


def _setup_multi(monkeypatch, tmp_path, mode):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    # 多形象走 _gen_slot_clips → _synth_to_wav(自 R3 起带 rate/volume kwargs),mock 须收 **kwargs
    monkeypatch.setattr(dh_jobs, "_synth_to_wav",
                        lambda text, provider, name, ap, **kwargs: (open(ap, "wb").write(b"wav"), ap)[1])
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda eid="wav2lip": _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    pid = dh_jobs.store.create_preset(
        name="M", avatar_ref="user:a.mp4", avatar_kind="video",
        avatars=[{"ref": "user:a.mp4", "kind": "video", "lines": "甲"},
                 {"ref": "user:b.mp4", "kind": "video", "lines": "乙"}],
        compose_mode=mode, layout="side").id
    tid = uuid.uuid4().hex[:12]
    # coframe/sequential 现按角色读 role_scripts(每角色一串),不再用共享 text 当台词
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "全局", "width": 720, "height": 1280,
                             "role_scripts": ["甲的台词", "乙的台词"]}
    dh_jobs._set(tid, state="pending", progress=0)
    return tid

def test_job_dispatch_sequential(monkeypatch, tmp_path):
    from chayuan.server.video_generation.digital_human import compose_multi as cm
    called = {}
    monkeypatch.setattr(cm, "render_sequential",
                        lambda clips, **k: (open(k["out_path"], "wb").write(b"seq"),
                                            called.setdefault("seq", len(clips)))[0] or k["out_path"])
    tid = _setup_multi(monkeypatch, tmp_path, "sequential")
    dh_jobs.run_sync(tid)
    st = dh_jobs.get_status(tid)
    assert st.state == "complete" and called.get("seq") == 2

def test_job_dispatch_coframe(monkeypatch, tmp_path):
    from chayuan.server.video_generation.digital_human import compose_multi as cm
    called = {}
    # coframe 现派发到 render_coframe_turntaking(按句轮流 PIP),不再走 render_coframe(layout)
    monkeypatch.setattr(cm, "render_coframe_turntaking",
                        lambda unit_clips, unit_roles, positions, avatars, **k:
                            (open(k["out_path"], "wb").write(b"cf"),
                             called.setdefault("cf", len(unit_clips)))[0] or k["out_path"])
    tid = _setup_multi(monkeypatch, tmp_path, "coframe")
    dh_jobs.run_sync(tid)
    st = dh_jobs.get_status(tid)
    assert st.state == "complete" and called.get("cf") == 2


def test_voice_string_prefixes():
    assert dh_jobs._voice_string("sherpa", "vits-zh-hf-fanchen-C") == "sherpa:vits-zh-hf-fanchen-C"
    assert dh_jobs._voice_string("sherpa", "sherpa:already") == "sherpa:already"
    assert dh_jobs._voice_string("piper", "zh_CN-huayan-medium") == "zh_CN-huayan-medium"
    assert dh_jobs._voice_string("piper", "") is None
    assert dh_jobs._voice_string("", "") is None


def test_gen_slot_clips_uses_per_slot_voice(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    seen = []
    # _synth_to_wav 自 R3 起带 rate/volume kwargs,mock 须收 **kwargs(否则 ThreadPool 内抛 TypeError)
    def fake_synth(text, provider, name, ap, **kwargs):
        seen.append((provider, name)); open(ap, "wb").write(b"w"); return ap
    monkeypatch.setattr(dh_jobs, "_synth_to_wav", fake_synth)
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda eid="wav2lip": _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    from chayuan.server.video_generation.digital_human.schemas import DigitalHumanPreset, AvatarSlot
    # 多形象现经 script_router.plan 规划单元:sequential + 每角色 role_scripts → 每槽一单元,
    # 各单元音色取自所属槽(script_router._unit 只读槽,故每槽须显式配音色)。
    preset = DigitalHumanPreset(
        id="p", name="m", avatar_ref="user:a", avatar_kind="video", compose_mode="sequential",
        voice_provider="piper", voice_name="default",
        avatars=[AvatarSlot(ref="user:a", kind="video", voice_provider="sherpa", voice_name="vz"),
                 AvatarSlot(ref="user:b", kind="video", voice_provider="piper", voice_name="default")])
    clips, unit_roles = dh_jobs._gen_slot_clips(
        "t", preset, preset.avatars, "全局", "wav2lip", str(tmp_path), 720, 1280,
        role_scripts=["甲词", "乙词"])
    assert len(clips) == 2
    assert unit_roles == [0, 1]
    # ThreadPoolExecutor 并发合成,seen 顺序不保证;验证两槽各自音色都出现
    assert ("sherpa", "vz") in seen
    assert ("piper", "default") in seen


def test_task_persistence_survives_restart(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    dh_jobs._STATUS.clear(); dh_jobs._PERSISTED_LOADED = False
    dh_jobs._set("tk1", state="complete", progress=100, result_path="/x.mp4")
    # 模拟进程重启:清内存 + 复位加载标志
    dh_jobs._STATUS.clear(); dh_jobs._PERSISTED_LOADED = False
    sts = {s.task_id: s for s in dh_jobs.list_statuses()}
    assert "tk1" in sts and sts["tk1"].state == "complete"


def test_task_zombie_running_marked_failed(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    dh_jobs._STATUS.clear(); dh_jobs._PERSISTED_LOADED = False
    dh_jobs._set("tk2", state="running", progress=50)
    dh_jobs._STATUS.clear(); dh_jobs._PERSISTED_LOADED = False
    assert dh_jobs.get_status("tk2").state == "failed"


def test_sequential_uses_role_scripts(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    seen = []
    monkeypatch.setattr(dh_jobs, "_synth_to_wav",
        lambda text, provider, name, ap, **kwargs: (seen.append((text, provider, name)), open(ap, "wb").write(b"w"), ap)[2])
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda eid="wav2lip": _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    from chayuan.server.video_generation.digital_human import compose_multi as cm
    monkeypatch.setattr(cm, "render_sequential", lambda clips, **k: (open(k["out_path"], "wb").write(b"s"), k["out_path"])[1])
    pid = dh_jobs.store.create_preset(name="m", avatar_ref="user:a", avatar_kind="video",
        avatars=[{"ref": "user:a", "kind": "video", "voice_provider": "sherpa", "voice_name": "v1"},
                 {"ref": "user:b", "kind": "video", "voice_provider": "piper", "voice_name": "v2"}],
        compose_mode="sequential").id
    tid = uuid.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "全局", "width": 720, "height": 1280,
                             "role_scripts": ["甲的台词", "乙的台词"]}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    assert ("甲的台词", "sherpa", "v1") in seen and ("乙的台词", "piper", "v2") in seen


def test_coframe_passes_positions(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    monkeypatch.setattr(dh_jobs, "_synth_to_wav",
        lambda text, provider, name, ap, **kwargs: (open(ap, "wb").write(b"w"), ap)[1])
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda eid="wav2lip": _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    from chayuan.server.video_generation.digital_human import compose_multi as cm
    seen = {}
    monkeypatch.setattr(cm, "render_coframe_turntaking",
        lambda unit_clips, unit_roles, positions, avatars, **k:
            (seen.update({"positions": positions}), open(k["out_path"], "wb").write(b"c"), k["out_path"])[2])
    pid = dh_jobs.store.create_preset(name="m", avatar_ref="user:a", avatar_kind="video",
        avatars=[{"ref": "user:a", "kind": "video", "x": 0.1, "y": 0.2, "scale": 0.5},
                 {"ref": "user:b", "kind": "video", "x": 0.6, "y": 0.2, "scale": 0.5}],
        compose_mode="coframe").id
    tid = uuid.uuid4().hex[:12]
    # coframe 现按角色读 role_scripts(每角色一串),须给台词才会产出单元、触发 turntaking 合成
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "全局", "width": 720, "height": 1280,
                             "role_scripts": ["甲词", "乙词"]}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    assert seen.get("positions") == [(0.1, 0.2, 0.5), (0.6, 0.2, 0.5)]
    assert len(seen.get("positions")) == 2


def test_af_filter_builds_string():
    assert dh_jobs._af_filter(1.0, 1.0) == ""
    assert dh_jobs._af_filter(1.1, 1.0) == "atempo=1.100"
    assert dh_jobs._af_filter(1.0, 0.8) == "volume=0.800"
    assert dh_jobs._af_filter(1.2, 0.5) == "atempo=1.200,volume=0.500"


def test_units_concurrent_synth_per_voice(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    calls = []
    monkeypatch.setattr(dh_jobs, "_synth_to_wav",
        lambda text, provider, name, ap, rate=1.0, volume=1.0:
            (calls.append((text, provider, name, rate, volume)), open(ap, "wb").write(b"w"), ap)[2])
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda eid="wav2lip": _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    from chayuan.server.video_generation.digital_human import compose_multi as cm
    monkeypatch.setattr(cm, "render_sequential", lambda clips, **k: (open(k["out_path"], "wb").write(b"s"), k["out_path"])[1])
    pid = dh_jobs.store.create_preset(name="m", avatar_ref="user:a", avatar_kind="video",
        avatars=[{"ref": "user:a", "kind": "video", "voice_provider": "sherpa", "voice_name": "v1", "voice_rate": 1.1},
                 {"ref": "user:b", "kind": "video", "voice_provider": "piper", "voice_name": "v2", "voice_volume": 0.8}],
        compose_mode="sequential").id
    tid = uuid.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "全局", "width": 720, "height": 1280,
                             "role_scripts": ["甲词", "乙词"]}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    assert ("甲词", "sherpa", "v1", 1.1, 1.0) in calls
    assert ("乙词", "piper", "v2", 1.0, 0.8) in calls


def test_coframe_turntaking_dispatch(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    monkeypatch.setattr(dh_jobs, "_synth_to_wav",
        lambda text, provider, name, ap, rate=1.0, volume=1.0: (open(ap, "wb").write(b"w"), ap)[1])
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda eid="wav2lip": _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    from chayuan.server.video_generation.digital_human import compose_multi as cm
    seen = {}
    monkeypatch.setattr(cm, "render_coframe_turntaking",
        lambda unit_clips, unit_roles, positions, avatars, **k:
            (seen.update({"roles": unit_roles, "positions": positions, "n": len(unit_clips)}),
             open(k["out_path"], "wb").write(b"c"), k["out_path"])[2])
    pid = dh_jobs.store.create_preset(name="m", avatar_ref="user:a", avatar_kind="video",
        avatars=[{"ref": "user:a", "kind": "video", "voice_name": "v1", "x": 0.0},
                 {"ref": "user:b", "kind": "video", "voice_name": "v2", "x": 0.5}],
        compose_mode="coframe").id
    tid = uuid.uuid4().hex[:12]
    # coframe 现按角色读 role_scripts,各自按句切分后按句序交织(甲1,乙1,甲2,...)。
    # 甲两句、乙一句 → 句序交织得 roles=[0,1,0]。
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "", "width": 720, "height": 1280,
                             "role_scripts": ["甲说。再甲说。", "乙说。"]}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    assert dh_jobs.get_status(tid).state == "complete"
    assert seen.get("roles") == [0, 1, 0]
    assert len(seen.get("positions")) == 2


def test_empty_slot_voice_inherits_preset(monkeypatch, tmp_path):
    """R3 重构丢失的回退:槽留空音色时应继承预设级 voice_provider/voice_name
    (对齐 schema 注释)。第二槽留空 → 合成时用 ("piper","default") 而非默认音色。"""
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    seen = []
    monkeypatch.setattr(dh_jobs, "_synth_to_wav",
        lambda text, provider, name, ap, **kwargs:
            (seen.append((text, provider, name)), open(ap, "wb").write(b"w"), ap)[2])
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda eid="wav2lip": _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    from chayuan.server.video_generation.digital_human import compose_multi as cm
    monkeypatch.setattr(cm, "render_sequential", lambda clips, **k: (open(k["out_path"], "wb").write(b"s"), k["out_path"])[1])
    # 预设级音色 piper/default;第一槽自带 sherpa/v1,第二槽留空音色 → 应继承预设级。
    pid = dh_jobs.store.create_preset(name="m", avatar_ref="user:a", avatar_kind="video",
        voice_provider="piper", voice_name="default",
        avatars=[{"ref": "user:a", "kind": "video", "voice_provider": "sherpa", "voice_name": "v1"},
                 {"ref": "user:b", "kind": "video"}],
        compose_mode="sequential").id
    tid = uuid.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "全局", "width": 720, "height": 1280,
                             "role_scripts": ["甲的台词", "乙的台词"]}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    assert dh_jobs.get_status(tid).state == "complete"
    # 第一槽用自己的音色;第二槽留空 → 继承预设级 piper/default(非 voice=None 默认音色)。
    assert ("甲的台词", "sherpa", "v1") in seen
    assert ("乙的台词", "piper", "default") in seen


def test_single_narration_uses_role_rate_volume(monkeypatch):
    seen = {}
    monkeypatch.setattr(dh_jobs, "_synth_to_wav",
        lambda text, provider, name, ap, rate=1.0, volume=1.0: (seen.update({"rate": rate, "volume": volume}), ap)[1])
    from chayuan.server.video_generation.digital_human.schemas import DigitalHumanPreset, AvatarSlot
    preset = DigitalHumanPreset(id="p", name="m", avatar_ref="user:a", avatar_kind="image",
        avatars=[AvatarSlot(ref="user:a", kind="image", voice_rate=1.2, voice_volume=0.7)])
    dh_jobs._synthesize_narration("hi", preset, "/tmp/x.wav")
    assert seen == {"rate": 1.2, "volume": 0.7}
