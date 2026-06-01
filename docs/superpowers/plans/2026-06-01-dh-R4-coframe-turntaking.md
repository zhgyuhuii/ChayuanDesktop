# 数字人同框「按句轮流」R4 实现计划(收口)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。沙箱:root→sudo;py3.6 只能 py_compile(纯函数 py312 验);moviepy 合成本机无法验证→必须 fail-safe + caller 兜底。步骤 `- [ ]`。

**Goal:** 多人同框:一套台词按句轮流分配给各角色(各自音色),所有角色同框(R2 位置),说话者在其句时段动口型、其余静态待机,音频按句顺序拼接。

**Architecture:** script_router coframe 改"按句轮流"产逐句单元;jobs 逐句合成(各音色,已并发)+wav2lip 片段;新 compose_multi.render_coframe_turntaking 为每角色构建"说话句=片段/他句=静态待机"全长轨,按位置合成;失败兜底 render_sequential(不崩)。

**Tech Stack:** Python(moviepy/pytest)。spec R4。复用 subtitle._split_string_by_punctuations、R2 positions、wav2lip。

> sudo 改+sudo git;只 stage 改的文件;分支 main;不 push。py 自检:`grep -v 'from __future__ import annotations' <f>>/tmp/c.py && python3 -m py_compile /tmp/c.py`。新文件 sudo tee。

## 文件结构
- `digital_human/script_router.py` — coframe 分支改按句轮流。
- `digital_human/compose_multi.py` — 加纯函数 `_turntaking_segments` + `render_coframe_turntaking`。
- `digital_human/jobs.py` — `_gen_slot_clips` 返回 (clips, unit_roles);coframe 分支用 turntaking + 兜底。
- 测试:`test_digital_human_script_router.py`(改)、`test_digital_human_compose_position.py`(追加纯函数)。

---

## Task 1: script_router coframe → 按句轮流

**Files:** Modify `.../digital_human/script_router.py`;Modify `.../tests/unit_tests/test_digital_human_script_router.py`

- [ ] **Step 1: 改测试**(替换原 test_plan_coframe_whole_script_per_role)
READ 测试文件,把 `test_plan_coframe_whole_script_per_role` 整个函数替换为:
```python
def test_plan_coframe_round_robin_sentences():
    # 一套台词按句切→轮流分配给角色(role i = 句序 % N),各用自己音色
    u = plan("coframe", "你好。今天天气好!很高兴见到你。", None, _roles())
    assert len(u) == 3
    assert u[0].role_index == 0 and u[1].role_index == 1 and u[2].role_index == 0
    assert u[0].voice_name == "v1" and u[1].voice_name == "v2"
    # 每句非空
    assert all(x.text.strip() for x in u)

def test_plan_coframe_single_sentence():
    u = plan("coframe", "只有一句话", None, _roles())
    assert len(u) == 1 and u[0].role_index == 0
```
- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH=chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_script_router.py -q -k coframe`
Expected: FAIL(现 coframe=每角色整套)
- [ ] **Step 3: 改 script_router.plan coframe 分支**
把 coframe 分支(现 `return [_unit(i, role, script or "") for i, role in enumerate(roles)]`)替换为按句轮流:
```python
    if dh_type == "coframe":
        from chayuan.server.video_generation.steps.subtitle import _split_string_by_punctuations
        sents = [s.strip() for s in _split_string_by_punctuations(script or "") if s.strip()]
        if not sents:
            sents = [(script or "")]
        out = []
        for j, sent in enumerate(sents):
            i = j % len(roles)
            out.append(_unit(i, roles[i], sent))
        return out
```
- [ ] **Step 4: 跑测试确认通过** Run: 同 Step 2(并 `-k "single or sequential"` 回归)Expected: PASS
- [ ] **Step 5: 提交**
```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/script_router.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_script_router.py
sudo git commit -m "feat(dh): R4 script_router coframe 改按句轮流(role=句序%N,各自音色)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Task 2: compose_multi 同框轮流合成(纯函数 + moviepy)

**Files:** Modify `.../digital_human/compose_multi.py`;Test `.../tests/unit_tests/test_digital_human_compose_position.py`

- [ ] **Step 1: 写纯函数测试**(追加)
```python
from chayuan.server.video_generation.digital_human.compose_multi import _turntaking_segments

def test_turntaking_segments():
    # 3 句:role 0,1,0;时长 [1000,2000,1500]ms
    unit_roles = [0, 1, 0]
    durs = [1000, 2000, 1500]
    # 角色 0 的全长轨:说(1000)→待机(2000)→说(1500)
    segs0 = _turntaking_segments(unit_roles, durs, 0)
    assert segs0 == [(True, 1000), (False, 2000), (True, 1500)]
    # 角色 1:待机(1000)→说(2000)→待机(1500)
    segs1 = _turntaking_segments(unit_roles, durs, 1)
    assert segs1 == [(False, 1000), (True, 2000), (False, 1500)]
```
- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH=chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_compose_position.py -q -k turntaking`
Expected: FAIL(`_turntaking_segments` 不存在)
- [ ] **Step 3: 加 _turntaking_segments(纯) + render_coframe_turntaking(moviepy,fail-safe)**
在 compose_multi.py 加:
```python
def _turntaking_segments(unit_roles, durations, role_index):
    """某角色的全长轨分段:每句 (is_speak, duration_ms) —— 属于该角色=说,否则=待机。"""
    out = []
    for r, d in zip(unit_roles, durations):
        out.append((r == role_index, int(d)))
    return out


def _probe_ms(path):
    try:
        from moviepy import VideoFileClip
        c = VideoFileClip(path)
        try:
            return int(c.duration * 1000)
        finally:
            c.close()
    except Exception:  # noqa: BLE001
        return 0


def render_coframe_turntaking(unit_clips, unit_roles, positions, avatars, *,
                              out_path, width, height):
    """同框按句轮流:每角色全长轨(说话句=该句片段,他句=静态待机帧),按 positions 合成。
    只说话句带音频→叠加即顺序音轨。失败抛异常(caller 兜底)。"""
    from moviepy import VideoFileClip, ImageClip, CompositeVideoClip, concatenate_videoclips
    import numpy as np
    n_roles = len(positions)
    durs = [max(1, _probe_ms(c)) for c in unit_clips]
    pos_px = _resolve_positions(positions, "side", n_roles, width, height)
    opened = []
    try:
        # 预读每句说话片段
        speak_clips = [VideoFileClip(c) for c in unit_clips]
        opened.extend(speak_clips)
        role_tracks = []
        for ri in range(n_roles):
            x, y, tw = pos_px[ri]
            segs = []
            for j, (r, d) in enumerate(zip(unit_roles, durs)):
                if r == ri:
                    segs.append(speak_clips[j].resized(width=tw))
                else:
                    # 待机:该角色静态帧(用其说话片段首帧;无则用 avatar 图)持续 d 毫秒,无音频
                    src = None
                    for jj, rr in enumerate(unit_roles):
                        if rr == ri:
                            src = speak_clips[jj]; break
                    if src is not None:
                        frame = src.get_frame(0)
                        idle = ImageClip(frame)
                    else:
                        idle = ImageClip(avatars[ri])
                    idle = idle.resized(width=tw).with_duration(d / 1000.0)
                    segs.append(idle)
            track = concatenate_videoclips(segs, method="compose").with_position((x, y))
            role_tracks.append(track)
            opened.append(track)
        comp = CompositeVideoClip(role_tracks, size=(width, height))
        comp.write_videofile(out_path, codec="libx264", audio_codec="aac", fps=25, threads=2, logger=None)
        opened.append(comp)
        return out_path
    finally:
        for c in opened:
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass
```
(注:`get_frame(0)` 取首帧待机;`ImageClip` 接受 ndarray 帧或路径。avatars[ri] 为图像形象路径兜底。`resized(width=...)` 与现有 compose_multi 用法一致。)
- [ ] **Step 4: 跑纯函数测试确认通过** Run: 同 Step 2 Expected: PASS(纯函数 _turntaking_segments;render_* 本机无法验证,靠 fail-safe)
- [ ] **Step 5: 提交**
```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/compose_multi.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_compose_position.py
sudo git commit -m "feat(dh): R4 compose_multi 同框按句轮流合成(全长轨说话/待机,fail-safe)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Task 3: jobs coframe 用同框轮流 + 兜底

**Files:** Modify `.../digital_human/jobs.py`;Test `.../tests/unit_tests/test_digital_human_jobs.py`

- [ ] **Step 1: 写测试**(追加;验证 coframe 走 turntaking 且传 unit_roles)
```python
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
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "甲说。乙说。再甲说。", "width": 720, "height": 1280}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    assert dh_jobs.get_status(tid).state == "complete"
    assert seen.get("roles") == [0, 1, 0]   # 按句轮流
    assert len(seen.get("positions")) == 2  # 每角色一个位置
```
- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH=chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py -q -k coframe_turntaking_dispatch`
Expected: FAIL(coframe 现用 render_coframe 非 turntaking,且无 unit_roles)
- [ ] **Step 3: 改 _gen_slot_clips 返回 (clips, unit_roles) + coframe 分支用 turntaking**
(a) `_gen_slot_clips`:在 lipsync 循环里同时收集 unit_roles;`return clips` 改 `return clips, unit_roles`。在循环前 `unit_roles = []`,append clip 处同时 `unit_roles.append(u.role_index)`。
(b) READ `_run_pipeline` 调 `_gen_slot_clips` 处(约 line 253)。改为解包:`clips, unit_roles = _gen_slot_clips(...)`。
(c) coframe 分支(约 line 261-265):
```python
                if mode == "coframe":
                    positions = [(float(getattr(s, "x", 0.0) or 0.0),
                                  float(getattr(s, "y", 0.0) or 0.0),
                                  float(getattr(s, "scale", 1.0) or 1.0)) for s in slots]
                    avatars = [resolve_avatar_path(s.ref) for s in slots]
                    try:
                        _cm.render_coframe_turntaking(clips, unit_roles, positions, avatars,
                                                      out_path=out_path, width=args["width"], height=args["height"])
                    except Exception as e:  # noqa: BLE001
                        logger.warning("[dh] 同框轮流合成失败,回退按句顺序: %r", e)
                        _cm.render_sequential(clips, out_path=out_path, width=args["width"], height=args["height"])
                else:
                    _cm.render_sequential(clips, out_path=out_path, width=args["width"], height=args["height"])
```
(d) 若别处(R3 测试)依赖 `_gen_slot_clips` 返回 list,注意现返回 tuple——但 _gen_slot_clips 仅在 _run_pipeline 调用,已改解包,无其它调用方(grep 确认)。
- [ ] **Step 4: 跑测试确认通过** Run: 同 Step 2;回归 `-k "units_concurrent or coframe_passes_positions or sequential_uses_role_scripts"`。Expected: PASS(注:coframe_passes_positions 是 R2 旧测试,断言 render_coframe 收 positions——R4 后 coframe 改走 turntaking,该旧测试需更新或标记;若它失败,把它改为断言 render_coframe_turntaking 被调 + positions 长度=2,与本任务新测试一致)。
- [ ] **Step 5: 提交**
```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/jobs.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py
sudo git commit -m "feat(dh): R4 jobs coframe 用同框按句轮流 + 失败回退顺序播

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## 自检结论
- **Spec 覆盖**:R4 覆盖 spec 同框语义(一套台词按句轮流、各自音色、同框说话动口型他者待机、音频顺序);收口 R1-R4 全模型。
- **占位**:无 TBD;每 code step 完整代码/命令/预期。
- **类型一致**:`_turntaking_segments(unit_roles, durations, role_index)`、`render_coframe_turntaking(unit_clips, unit_roles, positions, avatars, *, out_path, width, height)`、`_gen_slot_clips→(clips, unit_roles)` 各处签名一致;positions=每角色归一 (x,y,scale)。
- **风险**:render_coframe_turntaking 是 moviepy 复杂合成,本机不可验证→已设计成 caller try/except 兜底回退 render_sequential(出片不失败);待机帧用首帧 ImageClip(若 get_frame 失败,整 turntaking 抛异常→兜底顺序播);R2 旧测试 test_coframe_passes_positions 因 coframe 改路径需同步更新(Step4 注明)。性能:同框轮流为每角色×每句构建分段,句多时合成较重——属可接受(桌面单任务)。
