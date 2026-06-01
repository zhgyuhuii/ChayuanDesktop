# 数字人生成管线重构 R3 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。沙箱:root→sudo 编辑/提交;py3.6 只能 py_compile(纯函数测试 py312 跑);moviepy 渲染无法本机验证。步骤 `- [ ]`。

**Goal:** 模块化生成管线:script_router 规划合成单元、并发各角色音色合成、语速/音量(ffmpeg)、昵称成片标签 + 字幕叠加。先通 single/sequential(coframe 按句轮流留 R4)。

**Architecture:** 纯函数 `script_router.plan` 产 SynthUnit 列表→jobs 用 ThreadPoolExecutor 并发逐单元 TTS(各音色)+wav2lip→按 type 合成→overlay 叠昵称/字幕(moviepy TextClip,失败兜底跳过)。语速/音量经 ffmpeg atempo/volume 后处理(provider 无关)。

**Tech Stack:** Python(moviepy/imageio-ffmpeg/concurrent.futures/pytest)。spec R3。AudioPipeline.synthesize 不收 rate/volume(故 ffmpeg 后处理);字体 `binaries.get_fonts_dir()`。

> 本仓:sudo 改+sudo git;只 stage 改的文件;分支 main;不 push(控制器 push)。py 自检:`grep -v 'from __future__ import annotations' <f>>/tmp/c.py && python3 -m py_compile /tmp/c.py`。新文件用 `sudo tee`。不做 coframe 按句轮流(R4)。

## 文件结构
- `digital_human/script_router.py`(新) — `SynthUnit` + `plan()` 纯函数。
- `digital_human/jobs.py` — `_synth_to_wav` 加 rate/volume(ffmpeg 后处理);`_gen_slot_clips`→改用 script_router + ThreadPoolExecutor 并发。
- `digital_human/overlay.py`(新) — 昵称标签 + 字幕 TextClip 叠加(fail-safe)。
- `digital_human/schemas.py` — DigitalHumanPreset 加 `subtitle_enabled: bool = True`。
- 测试:`test_digital_human_script_router.py`(新)、`test_digital_human_jobs.py`(追加)。

---

## Task 1: script_router 纯函数(规划合成单元)

**Files:** Create `.../digital_human/script_router.py`;Create `.../tests/unit_tests/test_digital_human_script_router.py`

- [ ] **Step 1: 写测试**(新文件)
```python
from chayuan.server.video_generation.digital_human.script_router import plan
from chayuan.server.video_generation.digital_human.schemas import AvatarSlot

def _roles():
    return [AvatarSlot(ref="a", kind="video", name="甲", voice_provider="sherpa", voice_name="v1", voice_rate=1.1, voice_volume=0.9),
            AvatarSlot(ref="b", kind="video", name="乙", voice_provider="piper", voice_name="v2")]

def test_plan_single():
    u = plan("single", "你好世界", None, _roles())
    assert len(u) == 1
    assert u[0].role_index == 0 and u[0].text == "你好世界"
    assert u[0].provider == "sherpa" and u[0].voice_name == "v1" and u[0].rate == 1.1 and u[0].volume == 0.9

def test_plan_sequential_per_role_scripts():
    u = plan("sequential", "", ["甲词", "乙词"], _roles())
    assert [x.text for x in u] == ["甲词", "乙词"]
    assert u[0].provider == "sherpa" and u[1].provider == "piper"

def test_plan_sequential_skips_empty():
    u = plan("sequential", "", ["甲词", ""], _roles())
    assert len(u) == 1 and u[0].text == "甲词" and u[0].role_index == 0

def test_plan_coframe_whole_script_per_role():
    u = plan("coframe", "整套台词", None, _roles())
    assert len(u) == 2 and all(x.text == "整套台词" for x in u)
    assert u[0].voice_name == "v1" and u[1].voice_name == "v2"

def test_plan_no_roles():
    assert plan("single", "x", None, []) == []
```
- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH=chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_script_router.py -q`
Expected: FAIL(模块不存在)
- [ ] **Step 3: 写 script_router.py**(用 sudo tee)
```python
"""把(类型+台词+角色)规划成合成单元列表。纯函数,无 IO,可测。
SynthUnit = 一段要合成的语音(属于某角色,带该角色音色/语速/音量)。"""
from __future__ import annotations
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class SynthUnit:
    role_index: int
    text: str
    provider: str
    voice_name: str
    rate: float = 1.0
    volume: float = 1.0


def _unit(i, role, text):
    return SynthUnit(
        role_index=i, text=text,
        provider=(getattr(role, "voice_provider", "") or ""),
        voice_name=(getattr(role, "voice_name", "") or ""),
        rate=float(getattr(role, "voice_rate", 1.0) or 1.0),
        volume=float(getattr(role, "voice_volume", 1.0) or 1.0),
    )


def plan(dh_type: str, script: Optional[str], role_scripts: Optional[List[str]], roles) -> List[SynthUnit]:
    roles = list(roles or [])
    if not roles:
        return []
    if dh_type == "sequential":
        rs = role_scripts or []
        out = []
        for i, role in enumerate(roles):
            t = (rs[i] if i < len(rs) else "") or ""
            if t.strip():
                out.append(_unit(i, role, t))
        return out
    if dh_type == "coframe":
        # R3 暂:每角色整套 script 一单元(按句轮流=R4)
        return [_unit(i, role, script or "") for i, role in enumerate(roles)]
    # single
    return [_unit(0, roles[0], script or "")]
```
- [ ] **Step 4: 跑测试确认通过** Run: 同 Step 2 Expected: PASS
- [ ] **Step 5: 提交**
```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/script_router.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_script_router.py
sudo git commit -m "feat(dh): R3 script_router 纯函数规划合成单元(各角色音色)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Task 2: _synth_to_wav 语速/音量(ffmpeg atempo/volume 后处理)

**Files:** Modify `.../digital_human/jobs.py`;Test `.../tests/unit_tests/test_digital_human_jobs.py`

- [ ] **Step 1: 写测试**(追加;测纯函数 `_af_filter`)
```python
def test_af_filter_builds_string():
    assert dh_jobs._af_filter(1.0, 1.0) == ""
    assert dh_jobs._af_filter(1.1, 1.0) == "atempo=1.100"
    assert dh_jobs._af_filter(1.0, 0.8) == "volume=0.800"
    assert dh_jobs._af_filter(1.2, 0.5) == "atempo=1.200,volume=0.500"
```
- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH=chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py -q -k af_filter`
Expected: FAIL(`_af_filter` 不存在)
- [ ] **Step 3: 改 jobs.py**
加纯函数(放 `_synth_to_wav` 之前):
```python
def _af_filter(rate: float, volume: float) -> str:
    """ffmpeg -af 滤镜串;rate≈1 且 volume≈1 → 空串(不处理)。atempo 仅 0.5-2.0。"""
    parts = []
    r = max(0.5, min(2.0, float(rate or 1.0)))
    if abs(r - 1.0) > 1e-3:
        parts.append("atempo=%.3f" % r)
    v = float(volume or 1.0)
    if abs(v - 1.0) > 1e-3:
        parts.append("volume=%.3f" % v)
    return ",".join(parts)
```
`_synth_to_wav(text, provider, name, audio_path)` 加 `rate=1.0, volume=1.0` 形参;在写完 wav 后追加:
```python
    af = _af_filter(rate, volume)
    if af:
        try:
            import subprocess, imageio_ffmpeg, os as _os
            ff = imageio_ffmpeg.get_ffmpeg_exe()
            tmp = audio_path + ".af.wav"
            subprocess.run([ff, "-y", "-i", audio_path, "-af", af, tmp],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            _os.replace(tmp, audio_path)
        except Exception as e:  # noqa: BLE001
            logger.warning("[dh] 语速/音量后处理失败(忽略,用原速): %r", e)
    return audio_path
```
- [ ] **Step 4: 跑测试确认通过** Run: 同 Step 2 Expected: PASS
- [ ] **Step 5: 提交**
```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/jobs.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py
sudo git commit -m "feat(dh): R3 _synth_to_wav 语速/音量经 ffmpeg atempo/volume 后处理

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Task 3: jobs 用 script_router + 并发逐单元合成

**Files:** Modify `.../digital_human/jobs.py`;Test `.../tests/unit_tests/test_digital_human_jobs.py`

- [ ] **Step 1: 写测试**(追加;验证并发各单元、各自音色、rate/volume 透传)
```python
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
        avatars=[{"ref":"user:a","kind":"video","voice_provider":"sherpa","voice_name":"v1","voice_rate":1.1},
                 {"ref":"user:b","kind":"video","voice_provider":"piper","voice_name":"v2","voice_volume":0.8}],
        compose_mode="sequential").id
    tid = uuid.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "全局", "width":720, "height":1280,
                             "role_scripts": ["甲词", "乙词"]}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    assert ("甲词", "sherpa", "v1", 1.1, 1.0) in calls
    assert ("乙词", "piper", "v2", 1.0, 0.8) in calls
```
- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH=chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py -q -k units_concurrent_synth_per_voice`
Expected: FAIL(当前未透传 rate/volume,且按 slot 非 unit)
- [ ] **Step 3: 改 _gen_slot_clips → 基于 script_router + 并发**
READ 现 `_gen_slot_clips`。重写为:用 `script_router.plan` 得 units,`ThreadPoolExecutor` 并发为每个 unit 合成 wav(用 unit.provider/voice_name/rate/volume)→ 各 unit 串行/并发跑 wav2lip 产片段(wav2lip 引擎模型 module 级缓存,**引擎调用建议串行**避免显存争用——合成可并发,lipsync 串行);返回片段路径列表(按 unit 顺序)。骨架:
```python
def _gen_slot_clips(tid, preset, slots, global_text, engine, td, width, height, role_scripts=None):
    from chayuan.server.video_generation.digital_human import script_router as _sr
    from concurrent.futures import ThreadPoolExecutor
    dh_type = getattr(preset, "compose_mode", "single") or "single"
    units = _sr.plan(dh_type, global_text, role_scripts, slots)
    if not units:
        raise RuntimeError("无可合成台词")
    # 1) 并发合成各单元音频(各自音色/语速/音量)
    def _do_synth(idx_unit):
        i, u = idx_unit
        ap = os.path.join(td, f"seg{i}.wav")
        _synth_to_wav(u.text, u.provider, u.voice_name, ap, rate=u.rate, volume=u.volume)
        return i, ap, u
    with ThreadPoolExecutor(max_workers=min(4, len(units))) as ex:
        synthd = list(ex.map(_do_synth, list(enumerate(units))))
    synthd.sort(key=lambda t: t[0])
    # 2) 串行 lipsync(引擎模型共享,避免争用)
    clips = []
    for i, ap, u in synthd:
        av = resolve_avatar_path(slots[u.role_index].ref)
        if not av:
            logger.warning("[dh] 角色 %d 形象缺失,跳过: %s", u.role_index, slots[u.role_index].ref)
            continue
        cp = os.path.join(td, f"seg{i}.mp4")
        get_engine(engine).generate(avatar_path=av, audio_path=ap, out_path=cp,
                                    width=width, height=height, on_progress=None)
        clips.append(cp)
        _set(tid, progress=10 + int((i + 1) * 78 / max(1, len(units))))
    if not clips:
        raise RuntimeError("没有可用片段(形象缺失)")
    return clips
```
(删除原按 slot.lines/role_scripts 的旧循环;`_run_pipeline` 调用处保持传 `role_scripts=args.get("role_scripts")`,coframe 的 positions/分支不变;coframe 现每角色一片段=units 顺序与 slots 对应,render_coframe positions 仍按 slots 顺序——确认 clips 顺序==slots 顺序:coframe 下 units=每角色一条,enumerate 顺序即 slots 顺序,OK。)
- [ ] **Step 4: 跑测试确认通过** Run: 同 Step 2;并回归跑 `-k "sequential_uses_role_scripts or coframe_passes_positions"` 确保不破。Expected: PASS
- [ ] **Step 5: 提交**
```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/jobs.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py
sudo git commit -m "feat(dh): R3 jobs 用 script_router + 并发逐单元合成(各音色/语速/音量)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Task 4: 昵称标签 + 字幕叠加(moviepy,fail-safe) + subtitle_enabled

**Files:** Create `.../digital_human/overlay.py`;Modify `.../digital_human/schemas.py`、`.../digital_human/jobs.py`;Test `.../tests/unit_tests/test_digital_human_store.py`

- [ ] **Step 1: schemas 加 subtitle_enabled + 测试**(追加到 store 测试)
```python
def test_preset_subtitle_enabled_default(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    p = dh_store.create_preset(name="m", avatar_ref="user:a", avatar_kind="video")
    assert p.subtitle_enabled is True
```
DigitalHumanPreset(schemas.py)在 layout 后加 `subtitle_enabled: bool = True`。store.create_preset 形参加 `subtitle_enabled: bool = True` 并传入构造;route create 透传 `subtitle_enabled=bool(body.get("subtitle_enabled", True))`。
- [ ] **Step 2: 跑该测试确认失败→实现→通过**
Run: `PYTHONPATH=chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py -q -k subtitle_enabled`(先 FAIL 后 PASS)
- [ ] **Step 3: 写 overlay.py**(sudo tee;fail-safe)
```python
"""成片文字叠加:昵称标签 + 字幕。moviepy TextClip;字体取 bundled。
所有函数 fail-safe:渲染失败返回原视频路径,绝不让出片失败。"""
from __future__ import annotations
import logging
from typing import List, Optional, Tuple

logger = logging.getLogger("chayuan.dh.overlay")


def _font() -> Optional[str]:
    try:
        from chayuan.server.video_generation import binaries
        import os
        d = binaries.get_fonts_dir()
        for f in sorted(os.listdir(d)):
            if f.lower().endswith((".ttf", ".otf", ".ttc")):
                return os.path.join(d, f)
    except Exception:  # noqa: BLE001
        pass
    return None


def add_overlays(video_path: str, out_path: str, *, labels: List[Tuple[str, float, float]] = None,
                 cues=None, width: int = 720, height: int = 1280) -> str:
    """labels: [(text, x_norm, y_norm)] 昵称标签;cues: List[SrtCue] 字幕(底部居中)。
    任一失败 → 返回原 video_path(不阻断出片)。成功 → 写 out_path 并返回它。"""
    if not labels and not cues:
        return video_path
    try:
        from moviepy import VideoFileClip, TextClip, CompositeVideoClip
        font = _font()
        base = VideoFileClip(video_path)
        layers = [base]
        if labels:
            for text, xn, yn in labels:
                if not text:
                    continue
                tc = TextClip(text=text, font=font, font_size=max(18, int(height * 0.03)),
                              color="white", stroke_color="black", stroke_width=2)
                tc = tc.with_position((float(xn), float(yn)), relative=True).with_duration(base.duration)
                layers.append(tc)
        for c in (cues or []):
            tc = TextClip(text=getattr(c, "text", "") or "", font=font,
                          font_size=max(20, int(height * 0.035)), color="white",
                          stroke_color="black", stroke_width=2)
            start = getattr(c, "start_ms", 0) / 1000.0
            end = getattr(c, "end_ms", 0) / 1000.0
            tc = tc.with_position(("center", 0.86), relative=True).with_start(start).with_end(max(start + 0.1, end))
            layers.append(tc)
        comp = CompositeVideoClip(layers, size=(width, height)).with_duration(base.duration)
        comp.write_videofile(out_path, codec="libx264", audio_codec="aac", fps=25, threads=2, logger=None)
        for c in (comp, base):
            try: c.close()
            except Exception: pass
        return out_path
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] 文字叠加失败(忽略,用无字幕成片): %r", e)
        return video_path
```
- [ ] **Step 4: jobs 接 overlay**(_run_pipeline 出片后,complete 前)
在拿到最终 `result_path/out_path` 后、`_set(state="complete")` 前加:
```python
        try:
            from chayuan.server.video_generation.digital_human import overlay as _ov
            from chayuan.server.video_generation.digital_human.timeline_bridge import build_cues_from_script
            from chayuan.server.video_generation.steps.subtitle import _probe_audio_duration_ms
            labels = [((getattr(s, "name", "") or ""),
                       float(getattr(s, "x", 0.0) or 0.0),
                       min(0.95, float(getattr(s, "y", 0.0) or 0.0) + 0.0)) for s in slots if getattr(s, "name", "")]
            cues = []
            if getattr(preset, "subtitle_enabled", True):
                dur = _probe_audio_duration_ms(result_path) or 0
                cues = build_cues_from_script(args.get("text") or "", dur)
            if labels or cues:
                ov_out = os.path.join(td, "with_overlay.mp4")
                r2 = _ov.add_overlays(result_path, ov_out, labels=labels, cues=cues,
                                      width=args["width"], height=args["height"])
                if r2 and os.path.isfile(r2):
                    result_path = r2
        except Exception as _e:  # noqa: BLE001
            logger.warning("[dh] overlay 接入失败(忽略): %r", _e)
```
(单形象路径用 result_path;多形象路径同理对 out_path 处理。`slots` 在多形象分支有;单形象分支 slots=preset.avatars,name 标签也适用。READ 两分支确认变量名,分别接入或抽小函数复用。)
- [ ] **Step 5: 语法自检 + 提交**
```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/overlay.py chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/schemas.py chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/jobs.py chayuan-server/libs/chayuan-server/chayuan/server/api_server/digital_human_routes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py
sudo git commit -m "feat(dh): R3 昵称标签+字幕叠加(moviepy,fail-safe)+ subtitle_enabled

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## 自检结论
- **Spec 覆盖**:R3 覆盖 spec §3 模块化(script_router/synth 并发/overlay)、§4 R3(并发各音色+昵称标签+字幕)。coframe 按句轮流=R4(本期 coframe=每角色整套 script)。语速/音量经 ffmpeg 落地(spec 说 piper length_scale/sherpa speed 支持不一→统一后处理更稳)。
- **占位**:无 TBD;每 code step 给完整代码/命令/预期。
- **类型一致**:`SynthUnit{role_index,text,provider,voice_name,rate,volume}` Task1 定义、Task3 使用一致;`_af_filter(rate,volume)`、`_synth_to_wav(...,rate,volume)`、`add_overlays(video,out,*,labels,cues,width,height)` 签名各处一致;`build_cues_from_script(script,total_ms)`(R3 已存)复用。
- **风险**:moviepy TextClip 依赖字体+ImageMagick/pillow,本机无法验证 → 全程 try/except 兜底(失败出无字幕片,不崩);atempo 仅 0.5-2.0(已 clamp);并发合成共享 AudioPipeline 单例需线程安全——TTS 各 provider 多为无状态/各自子进程,若实测有竞态则把 max_workers 降为 1(留实测调整点);lipsync 串行避免显存争用。
