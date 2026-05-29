# 时间轴编辑器 P5b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 P5a 的手拖素材编辑器加入编辑能力:编辑字幕(拖时间+改文字)、替换 clip 源、插入额外音频轨并真混音、清理草稿 task(不污染「视频任务」)。

**Architecture:** 复用 EDL + finalize 链路。字幕编辑态在前端,`finalizeDraft(taskId, timeline, subtitleCues?)` 把 cues 传后端,`finalize_task` 写 `edited.srt` 覆盖草稿 srt。插入音频轨是 timeline 第 5 轨(`kind==='audio'`),`render_from_edl` 抽该轨 clips → `generate_video(extra_audios=[{path,start_s,volume}])` 用 `with_start` 混进现有 `CompositeAudioClip`。clip 替换/字幕编辑/音频追加都是 `timeline`/`subtitleEdit` 纯算子。草稿清理:finalize 把 task `stop_at` 升 `'video'` + `VgTaskListPanel` 过滤非 video 任务。

**Tech Stack:** Python 3.12 / FastAPI / moviepy 2.x;TS / React 19 / Zustand / HTML5 DnD;vitest + pytest(compose 测试在测试里 stub moviepy,见 P5a `test_vg_p5a_render.py`)。

**前置:** P1-P3、P4a、P5a 已落地(消息卡入口 + stop_at=subtitle 草稿 + 手拖素材 + 图像渲染 + finalize 放宽 + 素材缩略图)。

**收尾:** monorepo `/work/chayuan-desktop`,commit 进 `main`,每 task `git push origin main`。

---

## File Structure

**后端**(`libs/chayuan-server/chayuan/server/video_generation/`):
- `steps/compose.py`(改)— `cues_to_srt` 工具;`generate_video(extra_audios=)`;`render_from_edl` 抽 audio 轨。
- `service.py`(改)— `finalize_task` 加 `subtitle_cues` 参数(写 srt 覆盖)+ 升 `stop_at='video'`。
- `runner.py`(改)— `enqueue_finalize`/`_run_finalize`/`_compose_via_edl` 加 `subtitle_path` 覆盖参数。
- `store/tasks.py`(改)— `update_progress` 加 `stop_at` 参数。
- `api_server/video_generation_routes.py`(改)— `finalize` body 收 `subtitle_cues`。
- `tests/unit_tests/test_vg_p5b_audio.py` / `test_vg_p5b_finalize.py`(新)。

**API**(`packages/api/src/videoGeneration.ts`,改):`vgFinalizeDraft(taskId, timeline, subtitleCues?)`;导出 `SrtCue`。

**前端**(`packages/app/src/features/video-generation/`):
- `timeline/subtitleEdit.ts`(新+测)— `editCueTime`/`editCueText`/`cuesToSrt`。
- `timeline/timelineEdit.ts`(改+测)— `DraggedMaterial.kind` 加 `'audio'`;`replaceClipSource`;`appendAudioClip`。
- `timeline/SubtitleCueTrack.tsx`(改)— 可编辑(把手拖时间 + 点改文字)。
- `timeline/AudioInsertTrack.tsx`(新)— 插入音频轨渲染。
- `timeline/VgTimeline.tsx`(改)— 选中 clip 工具条加「替换」按钮(`onReplaceClip`)。
- `timeline/TimelineTracks.tsx`(改)— 5 轨 + 插入音频轨 drop + 字幕可编辑 + 替换回调透传。
- `VgTimelineEditorPage.tsx`(改)— cues 编辑态 + finalize 传 cues + 替换素材窗 + audio drop。
- `steps/MaterialsStep.tsx`(改)— audio 素材拖拽 `kind:'audio'`。
- `VgTaskListPanel.tsx`(改)— 过滤 `stop_at !== 'video'`。

> 约定:`SrtCue { startMs; endMs; text }`(P5a 已在 `srtParse.ts` 定义并导出)。P5b 的 `subtitleEdit.ts` 复用该类型(`import type { SrtCue } from './srtParse'`)。

---

## Task 1: 后端 compose 插入音频混音(generate_video extra_audios + render_from_edl 抽 audio 轨)

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/video_generation/steps/compose.py`
- Test: `libs/chayuan-server/tests/unit_tests/test_vg_p5b_audio.py`

参考(已有):`generate_video(video_path, audio_path, subtitle_path, output_file, params)`(line ~723,末尾 `CompositeAudioClip([audio_clip, bgm_clip])`);`render_from_edl(timeline, audio_file, subtitle_path, output_file, params, *, source_resolver, threads)`(line ~349,末尾调 `generate_video`);`afx`/`AudioFileClip`/`CompositeAudioClip` 已 import;P5a `test_vg_p5a_render.py` 的 moviepy stub 模式。

- [ ] **Step 1: 写失败测试(纯抽取逻辑,mock moviepy)**

`libs/chayuan-server/tests/unit_tests/test_vg_p5b_audio.py`:
```python
import sys
import types

try:  # pragma: no cover
    import moviepy  # noqa: F401
except ModuleNotFoundError:  # pragma: no cover
    _mp = types.ModuleType("moviepy")
    _mp.__getattr__ = lambda _n: object
    sys.modules["moviepy"] = _mp
    _sub = types.ModuleType("moviepy.video.tools.subtitles")
    _sub.SubtitlesClip = object
    sys.modules["moviepy.video"] = types.ModuleType("moviepy.video")
    sys.modules["moviepy.video.tools"] = types.ModuleType("moviepy.video.tools")
    sys.modules["moviepy.video.tools.subtitles"] = _sub

from chayuan.server.video_generation.steps.compose import _build_extra_audios
from chayuan.server.video_generation.schemas import Timeline


def _tl(audio_clips):
    return Timeline.model_validate({
        "version": 1, "duration_ms": 0,
        "tracks": [
            {"id": "v", "kind": "video", "clips": []},
            {"id": "a", "kind": "audio", "clips": audio_clips},
        ],
    })


def test_extra_audios_extracts_audio_track():
    tl = _tl([
        {"id": "x", "source": {"path": "/m/x.mp3"}, "track_start_ms": 2000, "in_ms": 0, "out_ms": 0, "volume": 0.5},
        {"id": "y", "source": {"path": "/m/y.wav"}, "track_start_ms": 8000, "in_ms": 0, "out_ms": 0},
    ])
    out = _build_extra_audios(tl, source_resolver=lambda s: s.get("path", ""))
    assert out == [
        {"path": "/m/x.mp3", "start_s": 2.0, "volume": 0.5},
        {"path": "/m/y.wav", "start_s": 8.0, "volume": 1.0},
    ]


def test_extra_audios_skips_unresolved():
    tl = _tl([{"id": "z", "source": {"material_id": "gone"}, "track_start_ms": 0, "in_ms": 0, "out_ms": 0}])
    out = _build_extra_audios(tl, source_resolver=lambda _s: "")
    assert out == []


def test_extra_audios_empty_when_no_audio_track():
    tl = Timeline.model_validate({"version": 1, "tracks": [{"id": "v", "kind": "video", "clips": []}]})
    assert _build_extra_audios(tl, source_resolver=lambda s: s.get("path", "")) == []
```

- [ ] **Step 2: 跑 → FAIL**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_p5b_audio.py`
Expected: FAIL(`_build_extra_audios` 不存在)。

- [ ] **Step 3: 实现 `_build_extra_audios` + `generate_video(extra_audios=)` + render_from_edl 接线**

在 `compose.py` 加纯函数(放 `_build_edl_render_plan` 附近):
```python
def _build_extra_audios(timeline, *, source_resolver) -> list[dict]:
    """抽 timeline 的 audio 轨 clips → [{path, start_s, volume}],解析为空的跳过。"""
    out: list[dict] = []
    for tr in (timeline.tracks or []):
        if tr.kind != "audio":
            continue
        for c in tr.clips:
            path = (source_resolver(c.source) or "").strip()
            if not path:
                logger.warning("[edl] 插入音频 clip %s 解析为空,跳过: %r", c.id, c.source)
                continue
            out.append({
                "path": path,
                "start_s": max(0.0, c.track_start_ms / 1000.0),
                "volume": float(getattr(c, "volume", None) or 1.0),
            })
    return out
```
给 `generate_video` 加可选 `extra_audios`:
```python
def generate_video(
    video_path: str,
    audio_path: str,
    subtitle_path: str,
    output_file: str,
    params: VideoParams,
    extra_audios: list | None = None,
):
```
在 `generate_video` 里现有 bgm 混音之后、`video_clip.with_audio(audio_clip)` 之前加:
```python
    for ea in (extra_audios or []):
        try:
            ea_clip = AudioFileClip(ea["path"]).with_effects(
                [afx.MultiplyVolume(float(ea.get("volume", 1.0)))]
            ).with_start(float(ea.get("start_s", 0.0)))
            audio_clip = CompositeAudioClip([audio_clip, ea_clip])
        except Exception as exc:  # noqa: BLE001
            logger.warning("[compose] 插入音频混音失败,跳过 %s: %s", ea.get("path"), exc)
```
> 注意:bgm 混音那段已把 `audio_clip` 变成 `CompositeAudioClip`。这里继续 Composite 包裹是安全的。确保此段在 `bgm` 块之后、`with_audio` 之前。

在 `render_from_edl` 末尾把 `generate_video` 调用改为传 extra_audios:
```python
    generate_video(
        video_path=combined_path,
        audio_path=audio_file,
        subtitle_path=subtitle_path,
        output_file=output_file,
        params=params,
        extra_audios=_build_extra_audios(timeline, source_resolver=source_resolver),
    )
```

- [ ] **Step 4: 跑 → PASS**

Run: 同 Step 2。Expected: 3 passed。

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/compose.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_p5b_audio.py
git commit -m "feat(vg): compose 插入音频轨混音(render_from_edl 抽 audio 轨 + generate_video extra_audios)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 2: 后端 finalize 收 cues 写 srt 覆盖 + 升 stop_at=video

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/video_generation/steps/compose.py`(`cues_to_srt`)
- Modify: `libs/chayuan-server/chayuan/server/video_generation/store/tasks.py`(`update_progress` 加 stop_at)
- Modify: `libs/chayuan-server/chayuan/server/video_generation/runner.py`(finalize 链 subtitle_path 覆盖)
- Modify: `libs/chayuan-server/chayuan/server/video_generation/service.py`(finalize_task 写 srt + 升 stop_at)
- Test: `libs/chayuan-server/tests/unit_tests/test_vg_p5b_finalize.py`、`test_vg_finalize.py`(补)

参考(已有):`finalize_task`(校验 audio+subtitle+vclip,enqueue_finalize);`enqueue_finalize(task_id, params, *, audio_file, subtitle_path)`、`_run_finalize(task_id, params, audio_file, subtitle_path)`、`_compose_via_edl(task_id, params, audio_file, subtitle_path)`;`tasks_store.update_progress(*, state, progress, result_patch, error)`;`_helpers.task_dir`。

- [ ] **Step 1: 写失败测试**

`libs/chayuan-server/tests/unit_tests/test_vg_p5b_finalize.py`:
```python
import os
import tempfile
from unittest import mock

from chayuan.server.video_generation.steps.compose import cues_to_srt
from chayuan.server.video_generation import service


def test_cues_to_srt_format():
    srt = cues_to_srt([
        {"startMs": 0, "endMs": 2500, "text": "你好"},
        {"startMs": 2500, "endMs": 5000, "text": "世界"},
    ])
    assert "1\n00:00:00,000 --> 00:00:02,500\n你好" in srt
    assert "2\n00:00:02,500 --> 00:00:05,000\n世界" in srt


def _draft_row():
    return {
        "task_id": "d1", "owner_id": 1, "state": "complete", "stop_at": "subtitle",
        "params": {"video_subject": "t", "video_script": "hi"},
        "result": {"audio_file": "/d/a.mp3", "subtitle_path": "/d/s.srt"},
    }


def test_finalize_with_cues_writes_srt_and_overrides(monkeypatch, tmp_path):
    monkeypatch.setattr(service.tasks_store, "get_task", lambda *a, **k: _draft_row())
    monkeypatch.setattr(service.tasks_store, "update_progress", lambda *a, **k: True)
    monkeypatch.setattr(service, "task_dir", lambda *a, **k: str(tmp_path))
    captured = {}
    def _enq(task_id, params, *, audio_file, subtitle_path):
        captured["subtitle_path"] = subtitle_path
    monkeypatch.setattr(service.runner, "enqueue_finalize", _enq)
    tl = {"version": 1, "tracks": [{"id": "v", "kind": "video", "clips": [
        {"id": "x", "source": {"url": "http://e/x.mp4"}, "track_start_ms": 0, "in_ms": 0, "out_ms": 0}]}]}
    ok = service.finalize_task("d1", tl, owner_id=1, subtitle_cues=[
        {"startMs": 0, "endMs": 1000, "text": "改过的字幕"},
    ])
    assert ok is True
    # 用了新写的 edited.srt 而不是草稿原 /d/s.srt
    assert captured["subtitle_path"] != "/d/s.srt"
    assert os.path.isfile(captured["subtitle_path"])
    assert "改过的字幕" in open(captured["subtitle_path"], encoding="utf-8").read()


def test_finalize_without_cues_uses_draft_srt(monkeypatch, tmp_path):
    monkeypatch.setattr(service.tasks_store, "get_task", lambda *a, **k: _draft_row())
    monkeypatch.setattr(service.tasks_store, "update_progress", lambda *a, **k: True)
    monkeypatch.setattr(service, "task_dir", lambda *a, **k: str(tmp_path))
    captured = {}
    monkeypatch.setattr(service.runner, "enqueue_finalize",
                        lambda t, p, *, audio_file, subtitle_path: captured.update(subtitle_path=subtitle_path))
    tl = {"version": 1, "tracks": [{"id": "v", "kind": "video", "clips": [
        {"id": "x", "source": {"url": "http://e/x.mp4"}, "track_start_ms": 0, "in_ms": 0, "out_ms": 0}]}]}
    assert service.finalize_task("d1", tl, owner_id=1) is True
    assert captured["subtitle_path"] == "/d/s.srt"
```

- [ ] **Step 2: 跑 → FAIL**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_p5b_finalize.py`
Expected: FAIL(`cues_to_srt` 不存在 / `finalize_task` 无 `subtitle_cues`)。

- [ ] **Step 3: `cues_to_srt`(compose.py)**

在 `compose.py` 加(模块级):
```python
def cues_to_srt(cues: list) -> str:
    """[{startMs,endMs,text}] -> SRT 文本。"""
    def _ts(ms: int) -> str:
        ms = max(0, int(ms))
        h, ms = divmod(ms, 3600000)
        m, ms = divmod(ms, 60000)
        s, ms = divmod(ms, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    lines = []
    for i, c in enumerate(cues, 1):
        lines.append(str(i))
        lines.append(f"{_ts(c.get('startMs', 0))} --> {_ts(c.get('endMs', 0))}")
        lines.append(str(c.get("text", "")).strip())
        lines.append("")
    return "\n".join(lines)
```

- [ ] **Step 4: `update_progress` 加 stop_at(store/tasks.py)**

把 `update_progress` 签名加 `stop_at: Optional[str] = None`,并在 body 里(`if state is not None:` 附近)加:
```python
    if stop_at is not None:
        row.stop_at = stop_at
```

- [ ] **Step 5: finalize 链路加 subtitle_path 覆盖(runner.py)**

`enqueue_finalize` / `_run_finalize` / `_compose_via_edl` 不变签名也可 —— 因为 `finalize_task` 直接把覆盖后的 `subtitle_path` 作为现有 `subtitle_path` 参数传 `enqueue_finalize`。**无需改 runner**(覆盖在 service 层完成:service 决定传哪个 srt 路径)。本步确认 runner 链路透传 subtitle_path 到 `render_from_edl`(已是):`_run_finalize(... subtitle_path)` → `_compose_via_edl(... subtitle_path)` → `render_from_edl(timeline, audio_file, subtitle_path, ...)`。✓ 无改动,跳过。

- [ ] **Step 6: `finalize_task` 加 subtitle_cues + 升 stop_at(service.py)**

`service.py` 顶部确认可 `from .steps.compose import cues_to_srt`(惰性 import 防 moviepy 在无关路径加载:放函数内 import)。改 `finalize_task` 签名 + 逻辑:
```python
def finalize_task(
    task_id: str, timeline: Dict[str, Any], *,
    owner_id: Optional[int] = None,
    subtitle_cues: Optional[list] = None,
) -> bool:
    row = tasks_store.get_task(task_id, owner_id=owner_id)
    if not row:
        return False
    result = row.get("result") or {}
    audio_file = result.get("audio_file")
    subtitle_path = result.get("subtitle_path")
    if not audio_file or not subtitle_path:
        logger.warning("[service] finalize_task %s 草稿缺 audio/subtitle", task_id)
        return False
    vclips = [
        c for tr in (timeline.get("tracks") or []) if tr.get("kind") == "video"
        for c in (tr.get("clips") or [])
    ]
    if not vclips:
        logger.warning("[service] finalize_task %s 视频轨为空,拒绝", task_id)
        return False
    # 编辑后的字幕 cues → 写 edited.srt 覆盖草稿 srt
    if subtitle_cues:
        try:
            from .steps.compose import cues_to_srt
            from ._helpers import task_dir
            edited = os.path.join(task_dir(task_id, create=True), "edited.srt")
            with open(edited, "w", encoding="utf-8") as f:
                f.write(cues_to_srt(subtitle_cues))
            subtitle_path = edited
        except Exception as e:  # noqa: BLE001
            logger.warning("[service] finalize_task %s 写 edited.srt 失败,用草稿 srt: %r", task_id, e)
    try:
        params = VideoParams.model_validate(row.get("params") or {})
        from .schemas import Timeline
        params.timeline = Timeline.model_validate(timeline)
    except Exception as e:  # noqa: BLE001
        logger.warning("[service] finalize_task %s params/timeline 解析失败: %r", task_id, e)
        return False
    # 草稿收尾 → 升 stop_at=video,出现在「视频任务」并显渲染进度
    tasks_store.update_progress(task_id, state=VgTaskState.pending.value, progress=70, stop_at="video")
    runner.enqueue_finalize(task_id, params, audio_file=audio_file, subtitle_path=subtitle_path)
    logger.info("[service] finalize_task %s 入队 compose-only (cues=%s)", task_id, bool(subtitle_cues))
    return True
```
> `service.py` 顶部需 `import os`(若没有则加)。测试通过 `monkeypatch.setattr(service, "task_dir", ...)` 打桩 —— 因此把 `from ._helpers import task_dir` 提到模块顶部 import(`from ._helpers import task_dir`),而非函数内,这样 `service.task_dir` 可被 patch。同理 `cues_to_srt` 测试不直接 patch,留函数内 import 即可(compose 在真环境可用;单测 test_vg_p5b_finalize 不触发 compose 的 moviepy?——`cues_to_srt` 在 compose.py,import compose 会触发 moviepy)。**故测试文件顶部加 P5a 同款 moviepy stub**(见下 Step 7)。

- [ ] **Step 7: 给 finalize 测试加 moviepy stub**

`test_vg_p5b_finalize.py` 顶部(import 前)加与 `test_vg_p5b_audio.py` 相同的 moviepy stub 块(因 `from ...compose import cues_to_srt` 会加载 compose→moviepy)。

- [ ] **Step 8: 跑 → PASS + 回归 finalize 旧测试**

Run:
```bash
cd /work/chayuan-desktop/chayuan-server
PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_p5b_finalize.py libs/chayuan-server/tests/unit_tests/test_vg_finalize.py
```
Expected: 全 passed(旧 finalize 6 条不受影响 —— `finalize_task` 新增参数有默认值,旧调用兼容;`update_progress` mock 接受 `stop_at` kwarg)。
> 若旧 `test_vg_finalize.py` 的 `update_progress` mock 是 `lambda *a, **k: True` 则兼容 stop_at;若是严格签名 mock 需补 stop_at。

- [ ] **Step 9: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/compose.py chayuan-server/libs/chayuan-server/chayuan/server/video_generation/store/tasks.py chayuan-server/libs/chayuan-server/chayuan/server/video_generation/service.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_p5b_finalize.py
git commit -m "feat(vg): finalize 收编辑字幕 cues 写 srt 覆盖 + 升 stop_at=video

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 3: 后端路由 finalize 收 subtitle_cues

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py`

参考(已有,P5a):`finalize_task` 路由(body 取 timeline,调 `vg_service.finalize_task(task_id, timeline, owner_id=...)`)。

- [ ] **Step 1: 路由透传 subtitle_cues**

把 finalize 路由体:
```python
    timeline = body.get("timeline")
    if not isinstance(timeline, dict):
        raise HTTPException(422, "body.timeline 必填(Timeline 对象)")
    ok = vg_service.finalize_task(task_id, timeline, owner_id=_owner_id_of(user))
```
改为:
```python
    timeline = body.get("timeline")
    if not isinstance(timeline, dict):
        raise HTTPException(422, "body.timeline 必填(Timeline 对象)")
    subtitle_cues = body.get("subtitle_cues")
    if subtitle_cues is not None and not isinstance(subtitle_cues, list):
        raise HTTPException(422, "subtitle_cues 必须是数组")
    ok = vg_service.finalize_task(task_id, timeline, owner_id=_owner_id_of(user), subtitle_cues=subtitle_cues)
```

- [ ] **Step 2: py_compile + import 冒烟**

Run:
```bash
cd /work/chayuan-desktop/chayuan-server
PYTHONPATH="libs/chayuan-server" python -m py_compile libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py && echo OK
```
Expected: OK。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py
git commit -m "feat(vg): finalize 路由透传 subtitle_cues

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 4: API 客户端 finalizeDraft 加 subtitleCues

**Files:**
- Modify: `packages/api/src/videoGeneration.ts`

参考(已有):`vgFinalizeDraft(taskId, timeline)`(POST finalize);`srtParse.ts` 的 `SrtCue`(在 app 包,api 包不可依赖 app)。**api 包内自定义轻量 cue 类型**避免跨包依赖。

- [ ] **Step 1: 改 vgFinalizeDraft 签名**

```ts
export interface VgSubtitleCue {
  startMs: number;
  endMs: number;
  text: string;
}

/** 草稿收尾:用编辑后的时间轴(+可选编辑字幕)只跑 compose。 */
export async function vgFinalizeDraft(
  taskId: string,
  timeline: VgTimeline,
  subtitleCues?: VgSubtitleCue[],
): Promise<VgTask> {
  return rd<VgTask>(`/api/v1/video-generation/tasks/${encodeURIComponent(taskId)}/finalize`, {
    method: 'POST',
    body: subtitleCues ? { timeline, subtitle_cues: subtitleCues } : { timeline },
  });
}
```
(`videoGeneration.finalizeDraft` 聚合引用不变。)

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/api typecheck`
Expected: 0 错误。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/api/src/videoGeneration.ts
git commit -m "feat(client/vg): vgFinalizeDraft 加可选 subtitleCues

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 5: 前端纯算子 subtitleEdit + 单测

**Files:**
- Create: `packages/app/src/features/video-generation/timeline/subtitleEdit.ts`
- Test: `packages/app/src/features/video-generation/timeline/subtitleEdit.test.ts`

参考:`srtParse.ts` 的 `SrtCue`。

- [ ] **Step 1: 写失败测试**

`subtitleEdit.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { editCueTime, editCueText, cuesToSrt } from './subtitleEdit';
import type { SrtCue } from './srtParse';

const base: SrtCue[] = [
  { startMs: 0, endMs: 2000, text: 'a' },
  { startMs: 2000, endMs: 4000, text: 'b' },
];

it('editCueTime clamps end >= start + 200, start >= 0', () => {
  expect(editCueTime(base, 0, -500, 1500)[0]).toEqual({ startMs: 0, endMs: 1500, text: 'a' });
  // end 太小被夹到 start+200
  expect(editCueTime(base, 1, 3000, 3000)[1]).toEqual({ startMs: 3000, endMs: 3200, text: 'b' });
});

it('editCueText replaces text, keeps timing', () => {
  const r = editCueText(base, 1, '改了');
  expect(r[1]).toEqual({ startMs: 2000, endMs: 4000, text: '改了' });
  expect(r[0]).toEqual(base[0]);
});

it('cuesToSrt formats with index + comma ms', () => {
  const srt = cuesToSrt([{ startMs: 0, endMs: 2500, text: 'hi' }]);
  expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,500\nhi');
});
```

- [ ] **Step 2: 跑 → FAIL**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm exec vitest run packages/app/src/features/video-generation/timeline/subtitleEdit.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`subtitleEdit.ts`:
```typescript
import type { SrtCue } from './srtParse';

const MIN_CUE_MS = 200;

export function editCueTime(cues: SrtCue[], i: number, startMs: number, endMs: number): SrtCue[] {
  const s = Math.max(0, Math.round(startMs));
  const e = Math.max(s + MIN_CUE_MS, Math.round(endMs));
  return cues.map((c, idx) => (idx === i ? { ...c, startMs: s, endMs: e } : c));
}

export function editCueText(cues: SrtCue[], i: number, text: string): SrtCue[] {
  return cues.map((c, idx) => (idx === i ? { ...c, text } : c));
}

const ts = (ms: number): string => {
  const v = Math.max(0, Math.round(ms));
  const h = Math.floor(v / 3600000);
  const m = Math.floor((v % 3600000) / 60000);
  const s = Math.floor((v % 60000) / 1000);
  const milli = v % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(milli, 3)}`;
};

export function cuesToSrt(cues: SrtCue[]): string {
  return cues.map((c, i) => `${i + 1}\n${ts(c.startMs)} --> ${ts(c.endMs)}\n${(c.text ?? '').trim()}\n`).join('\n');
}
```

- [ ] **Step 4: 跑 → PASS**

Run: 同 Step 2。Expected: 全 PASS。

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/subtitleEdit.ts chayuan-client/packages/app/src/features/video-generation/timeline/subtitleEdit.test.ts
git commit -m "feat(client/vg): subtitleEdit 纯算子(editCueTime/editCueText/cuesToSrt)+ 单测

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 6: timelineEdit 加 replaceClipSource + appendAudioClip(+ DraggedMaterial 'audio')

**Files:**
- Modify: `packages/app/src/features/video-generation/timeline/timelineEdit.ts`
- Test: `packages/app/src/features/video-generation/timeline/timelineEdit.test.ts`(补)

参考(已有):`videoClips`/`withVideoClips`/`recomputeStarts`(内部);`appendClipFromMaterial`/`DraggedMaterial`(P5a,kind `'video'|'image'`);`VgTimeline`/`VgTimelineClip`/`VgTimelineTrack`。

- [ ] **Step 1: 补失败测试**

在 `timelineEdit.test.ts` 末尾加:
```typescript
import { replaceClipSource, appendAudioClip } from './timelineEdit';

it('replaceClipSource swaps source, keeps timing', () => {
  const t = { version: 1, duration_ms: 0, tracks: [{ id: 'v', kind: 'video' as const, clips: [
    { id: 'a', source: { path: '/a.mp4' }, track_start_ms: 0, in_ms: 500, out_ms: 4000 },
  ] }] };
  const r = replaceClipSource(t, 'a', { material_id: 'm9' });
  const c = r.tracks[0]!.clips!.find((x) => x.id === 'a')!;
  expect(c.source).toEqual({ material_id: 'm9' });
  expect(c.in_ms).toBe(500);
  expect(c.out_ms).toBe(4000);
});

it('appendAudioClip adds to audio track at end', () => {
  const t = { version: 1, duration_ms: 0, tracks: [{ id: 'v', kind: 'video' as const, clips: [] }] };
  const r = appendAudioClip(t, { materialId: 'snd1', kind: 'audio', durationMs: 3000 });
  const atr = r.tracks.find((x) => x.kind === 'audio')!;
  expect(atr.clips).toHaveLength(1);
  expect(atr.clips![0]!.source).toEqual({ material_id: 'snd1' });
  expect(atr.clips![0]!.out_ms).toBe(3000);
  // 第二条接在前一条末尾
  const r2 = appendAudioClip(r, { url: 'http://e/s2.mp3', kind: 'audio', durationMs: 2000 });
  const atr2 = r2.tracks.find((x) => x.kind === 'audio')!;
  expect(atr2.clips![1]!.track_start_ms).toBe(3000);
});
```

- [ ] **Step 2: 跑 → FAIL**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm exec vitest run packages/app/src/features/video-generation/timeline/timelineEdit.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

把 `DraggedMaterial` 的 `kind` 改为 `'video' | 'image' | 'audio'`:
```typescript
export interface DraggedMaterial {
  materialId?: string;
  url?: string;
  kind: 'video' | 'image' | 'audio';
  durationMs?: number;
}
```
在 `timelineEdit.ts` 末尾加:
```typescript
/** 替换 clip 的素材源,保留 in/out/时长/位置。 */
export function replaceClipSource(
  t: VgTimeline,
  clipId: string,
  source: { material_id?: string; url?: string },
): VgTimeline {
  const tracks = (t.tracks || []).map((tr) => ({
    ...tr,
    clips: (tr.clips || []).map((c) => (c.id === clipId ? { ...c, source } : c)),
  }));
  return { ...t, tracks };
}

/** 往 audio 轨追加一个插入音频 clip(顺序排在该轨末尾;无 audio 轨则建)。 */
export function appendAudioClip(t: VgTimeline, m: DraggedMaterial, atIndex?: number): VgTimeline {
  const tracks = [...(t.tracks || [])];
  let ai = tracks.findIndex((tr) => tr.kind === 'audio');
  if (ai < 0) { tracks.push({ id: 'a', kind: 'audio', clips: [] }); ai = tracks.length - 1; }
  const clips = [...(tracks[ai]!.clips || [])];
  const dur = m.durationMs && m.durationMs > 0 ? Math.round(m.durationMs) : 0;
  // 顺序排:start = 现有末尾(上一条 start + 其时长)
  const last = clips[clips.length - 1];
  const start = last ? (last.track_start_ms + (last.out_ms && last.out_ms > 0 ? last.out_ms : (last.duration_ms || 0))) : 0;
  const clip: VgTimelineClip = {
    id: `a${Date.now()}${Math.floor(Math.random() * 1000)}`,
    source: m.materialId ? { material_id: m.materialId } : { url: m.url ?? '' },
    track_start_ms: start,
    in_ms: 0,
    out_ms: dur,
    duration_ms: dur,
  };
  const at = atIndex == null ? clips.length : Math.max(0, Math.min(atIndex, clips.length));
  clips.splice(at, 0, clip);
  tracks[ai] = { ...tracks[ai]!, clips };
  return { ...t, tracks };
}
```
> `appendClipFromMaterial`(P5a,视频轨)不变。注意:视频轨 drop 仍只接受 video/image;audio 走 `appendAudioClip`(编辑器按 kind 路由,见 Task 11)。

- [ ] **Step 4: 跑 → PASS**

Run: 同 Step 2。Expected: 全 PASS。

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/timelineEdit.ts chayuan-client/packages/app/src/features/video-generation/timeline/timelineEdit.test.ts
git commit -m "feat(client/vg): replaceClipSource + appendAudioClip 算子 + DraggedMaterial 'audio'

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 7: SubtitleCueTrack 可编辑(拖时间 + 改文字)

**Files:**
- Modify: `packages/app/src/features/video-generation/timeline/SubtitleCueTrack.tsx`

参考(已有,P5a):`SubtitleCueTrack`(props cues/pxPerSec/contentWidthPx,绝对定位 cue 块);`msToPx`/`pxToMs`;`editCueTime`/`editCueText`(Task5);`SrtCue`。

- [ ] **Step 1: 加 editable 交互**

props 加:
```tsx
  editable?: boolean;
  onCuesChange?: (cues: SrtCue[]) => void;
```
import 加 `import { editCueTime, editCueText } from './subtitleEdit';`、`import { pxToMs } from './timelineScale';`。
每个 cue 块在 `editable` 时:
- 块上加左右把手(`onPointerDown` 起拖),move 用 `pxToMs(delta)` 改 start/end:
  ```tsx
  const startDrag = (e: React.PointerEvent, i: number, edge: 'start' | 'end') => {
    if (!editable || !onCuesChange) return;
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const c0 = cues[i]!;
    const move = (ev: PointerEvent) => {
      const d = pxToMs(ev.clientX - startX, pxPerSec);
      onCuesChange(edge === 'start'
        ? editCueTime(cues, i, c0.startMs + d, c0.endMs)
        : editCueTime(cues, i, c0.startMs, c0.endMs + d));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  ```
- 双击 cue 块 → 进入编辑:本地 `editingIdx` state,渲染一个 `<input defaultValue={c.text}>`,onBlur/Enter 调 `onCuesChange(editCueText(cues, i, val))` 并退出编辑。
- 非 editable 保持 P5a 只读渲染(title=text)。

完整组件骨架(实现者补细节,保留 P5a 只读分支):
```tsx
import * as React from 'react';
import { msToPx, pxToMs } from './timelineScale';
import { TRACK_H } from './TrackHeader';
import type { SrtCue } from './srtParse';
import { editCueTime, editCueText } from './subtitleEdit';

export const SubtitleCueTrack: React.FC<{
  cues: SrtCue[];
  pxPerSec: number;
  contentWidthPx: number;
  editable?: boolean;
  onCuesChange?: (cues: SrtCue[]) => void;
}> = ({ cues, pxPerSec, contentWidthPx, editable, onCuesChange }) => {
  const [editingIdx, setEditingIdx] = React.useState<number | null>(null);
  const startDrag = (e: React.PointerEvent, i: number, edge: 'start' | 'end') => { /* 如上 */ };
  return (
    <div className="relative border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
      style={{ height: TRACK_H, width: contentWidthPx }}>
      {cues.length === 0 && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">字幕(渲染后生成)</span>}
      {cues.map((c, i) => (
        <div key={i}
          style={{ left: msToPx(c.startMs, pxPerSec), width: Math.max(8, msToPx(c.endMs - c.startMs, pxPerSec)) }}
          className="absolute top-1.5 flex h-8 items-center overflow-hidden rounded border border-amber-300 bg-amber-50 px-1 text-[9px] text-amber-800"
          title={c.text}
          onDoubleClick={() => editable && setEditingIdx(i)}>
          {editingIdx === i ? (
            <input autoFocus defaultValue={c.text}
              onBlur={(e) => { onCuesChange?.(editCueText(cues, i, e.target.value)); setEditingIdx(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="w-full bg-transparent text-[9px] outline-none" />
          ) : (
            <span className="truncate">{c.text}</span>
          )}
          {editable && onCuesChange && (
            <>
              <span onPointerDown={(e) => startDrag(e, i, 'start')} className="absolute left-0 top-0 h-full w-1 cursor-ew-resize bg-amber-400/70" />
              <span onPointerDown={(e) => startDrag(e, i, 'end')} className="absolute right-0 top-0 h-full w-1 cursor-ew-resize bg-amber-400/70" />
            </>
          )}
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/SubtitleCueTrack.tsx
git commit -m "feat(client/vg): SubtitleCueTrack 可编辑(把手拖时间 + 双击改文字)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 8: AudioInsertTrack 组件

**Files:**
- Create: `packages/app/src/features/video-generation/timeline/AudioInsertTrack.tsx`

参考:`msToPx`;`clipDurMs`(timelineEdit);`TRACK_H`;`VgTimelineClip`。

- [ ] **Step 1: 组件**

```tsx
import * as React from 'react';
import { Music2 } from 'lucide-react';
import type { VgTimeline } from '@chayuan/api';
import { msToPx } from './timelineScale';
import { clipDurMs } from './timelineEdit';
import { TRACK_H } from './TrackHeader';

/** 插入音频轨:按 track_start_ms + clipDurMs 绝对定位音频 clip 块(只读展示)。 */
export const AudioInsertTrack: React.FC<{
  timeline: VgTimeline;
  pxPerSec: number;
  contentWidthPx: number;
}> = ({ timeline, pxPerSec, contentWidthPx }) => {
  const clips = (timeline.tracks || []).find((t) => t.kind === 'audio')?.clips ?? [];
  return (
    <div className="relative border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
      style={{ height: TRACK_H, width: contentWidthPx }}>
      {clips.length === 0 && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">拖音频到此处</span>}
      {clips.map((c) => (
        <div key={c.id}
          style={{ left: msToPx(c.track_start_ms, pxPerSec), width: Math.max(12, msToPx(clipDurMs(c), pxPerSec)) }}
          className="absolute top-1.5 flex h-8 items-center gap-1 overflow-hidden rounded border border-sky-300 bg-sky-50 px-1 text-[9px] text-sky-800">
          <Music2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{c.source.material_id || c.source.url || '音频'}</span>
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/AudioInsertTrack.tsx
git commit -m "feat(client/vg): AudioInsertTrack 插入音频轨组件

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 9: VgTimeline 选中 clip 加「替换」按钮

**Files:**
- Modify: `packages/app/src/features/video-generation/timeline/VgTimeline.tsx`

参考(已有):选中 clip 的 `[‹][›][🗑]` 工具条(P3/P5a);props。

- [ ] **Step 1: 加 onReplaceClip prop + 按钮**

props 加:
```tsx
  onReplaceClip?: (clipId: string) => void;
```
解构加 `onReplaceClip`。import lucide 加 `Replace`(`import { ChevronLeft, ChevronRight, Trash2, Replace } from 'lucide-react';`)。
在选中工具条(`{selected && onChange && (...)}` 内,🗑 按钮旁)加:
```tsx
                    {onReplaceClip && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); onReplaceClip(s.id); }}
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]" title="替换素材">
                        <Replace className="h-3.5 w-3.5" />
                      </button>
                    )}
```

- [ ] **Step 2: typecheck + P3 算子单测不破**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client
pnpm --filter @chayuan/app typecheck
pnpm exec vitest run packages/app/src/features/video-generation/timeline/timelineEdit.test.ts
```
Expected: typecheck 0;算子单测全 PASS。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/VgTimeline.tsx
git commit -m "feat(client/vg): VgTimeline 选中 clip 加「替换素材」按钮

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 10: TimelineTracks 升 5 轨 + 插入音频轨 + 字幕可编辑 + 替换透传

**Files:**
- Modify: `packages/app/src/features/video-generation/timeline/TimelineTracks.tsx`

参考(已有,P5a):4 轨(视频/旁白/音乐/字幕)+ 视频轨 drop;`VG_MATERIAL_DND_MIME`/`DraggedMaterial`;轨道头列。

- [ ] **Step 1: 接新 props + 5 轨 + 音频 drop + 字幕编辑透传**

import 加 `import { AudioInsertTrack } from './AudioInsertTrack';`、`import type { SrtCue } from './srtParse';`(若未导入)。
props 加:
```tsx
  onDropAudio?: (m: DraggedMaterial) => void;
  onCuesChange?: (cues: SrtCue[]) => void;
  onReplaceClip?: (clipId: string) => void;
```
`lanesH` 改 `TRACK_H * 5`。
轨道头列顺序改为(加「音频」):视频 / 旁白 / **音频** / 音乐 / 字幕:
```tsx
        <TrackHeader label="视频" icon={<Film className="h-3 w-3" />} />
        <TrackHeader label="旁白" icon={<Mic className="h-3 w-3" />} />
        <TrackHeader label="音频" icon={<Music2 className="h-3 w-3" />} />
        <TrackHeader label="音乐" icon={<Music className="h-3 w-3" />} />
        <TrackHeader label="字幕" icon={<Captions className="h-3 w-3" />} />
```
(import lucide 加 `Music2`。)
lane 区顺序:视频轨(P5a drop)→ 旁白(AudioWaveTrack)→ **插入音频轨(AudioInsertTrack + drop)** → 音乐(BgmTrack)→ 字幕(SubtitleCueTrack editable):
```tsx
            <AudioWaveTrack peaks={peaks} contentWidthPx={contentWidthPx} loading={peaksLoading} />
            {/* 插入音频轨(drop 音频素材) */}
            <div style={{ height: TRACK_H }} className="relative border-b border-[var(--cy-border-subtle)]"
              onDragOver={(e) => { if (e.dataTransfer.types.includes(VG_MATERIAL_DND_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
              onDrop={(e) => {
                const raw = e.dataTransfer.getData(VG_MATERIAL_DND_MIME);
                if (!raw) return;
                e.preventDefault();
                try { const m = JSON.parse(raw) as DraggedMaterial; if (m.kind === 'audio') onDropAudio?.(m); } catch { /* ignore */ }
              }}>
              <AudioInsertTrack timeline={timeline} pxPerSec={pxPerSec} contentWidthPx={contentWidthPx} />
            </div>
            <BgmTrack bgmName={bgmName} contentWidthPx={contentWidthPx} />
            <SubtitleCueTrack cues={cues} pxPerSec={pxPerSec} contentWidthPx={contentWidthPx}
              editable onCuesChange={onCuesChange} />
```
视频轨 `<VideoTrack ... />` 传 `onReplaceClip={onReplaceClip}`。视频轨 drop 仅接受 video/image(P5a drop 调 `onDropMaterial`,该回调在编辑器侧已按 kind 路由 —— Task 11 让 onDropMaterial 忽略 audio)。

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误(新 props 都可选,编辑器 Task 11 再传)。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/TimelineTracks.tsx
git commit -m "feat(client/vg): TimelineTracks 5 轨 + 插入音频轨 drop + 字幕可编辑 + 替换透传

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 11: 编辑器接线(cues 编辑/finalize 传 cues + 替换窗 + audio drop)

**Files:**
- Modify: `packages/app/src/features/video-generation/VgTimelineEditorPage.tsx`
- Modify: `packages/app/src/features/video-generation/steps/MaterialsStep.tsx`

参考(已有):`cues` state(P5a)、`onDropMaterial`(append 视频)、`finalizeDraft(taskId, timeline)`、`<TimelineTracks .../>`;`appendAudioClip`/`replaceClipSource`(Task6);MaterialsStep `isAudio`/`setDragData`(P5a)。

- [ ] **Step 1: MaterialsStep audio 素材 kind='audio'**

MineTab 卡片 `onDragStart` 的 kind 现为 `isImg(m) ? 'image' : 'video'`,改为三态:
```tsx
                kind: isImg(m) ? 'image' : isAudio(m) ? 'audio' : 'video',
```
(OnlineTab 主要是视频/图像,保持原 video/image 判断即可。)

- [ ] **Step 2: 编辑器 audio drop + 替换窗 + finalize 传 cues**

import 加 `appendAudioClip, replaceClipSource`(从 timelineEdit)。
- 视频 drop 忽略 audio:
  ```tsx
  const onDropMaterial = (m: DraggedMaterial) => {
    if (m.kind === 'audio') return; // 音频走音频轨
    onTimelineChange(appendClipFromMaterial(timeline, m));
  };
  const onDropAudio = (m: DraggedMaterial) => { onTimelineChange(appendAudioClip(timeline, m)); };
  ```
- 替换窗:本地 `const [replacingClipId, setReplacingClipId] = React.useState<string | null>(null);`
  `const onReplaceClip = (clipId: string) => setReplacingClipId(clipId);`
  在 JSX 末尾加一个简单替换弹层(复用 MaterialsStep,选中后取首个 video_materials 变化?——简化:用一个最小素材网格 Dialog;P5b 先用 MaterialsStep 包 Dialog,点素材卡 onToggle 时拿到 url/material_id 完成替换)。最小实现:
  ```tsx
  {replacingClipId && (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6" onClick={() => setReplacingClipId(null)}>
      <div className="max-h-[80vh] w-[min(720px,92vw)] overflow-y-auto cy-hide-scrollbar rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-3" onClick={(e) => e.stopPropagation()}>
        <p className="mb-2 text-sm font-semibold text-[var(--cy-text-primary)]">选择替换素材(拖到片段或点选)</p>
        <p className="mb-2 text-[11px] text-[var(--cy-text-tertiary)]">从下方拖一个素材到时间轴该片段,或点素材直接替换:</p>
        <ReplacePicker onPick={(src) => { onTimelineChange(replaceClipSource(timeline, replacingClipId, src)); setReplacingClipId(null); }} />
      </div>
    </div>
  )}
  ```
  其中 `ReplacePicker` 用 `videoGeneration.listMaterials` 拉「我的素材」网格,点卡片回调 `{material_id}`(P5b 替换源限「我的素材」库,简化;在线搜索替换留后续)。把 `ReplacePicker` 定义在本文件:
  ```tsx
  const ReplacePicker: React.FC<{ onPick: (src: { material_id?: string; url?: string }) => void }> = ({ onPick }) => {
    const q = useQuery({ queryKey: ['vg.materials.replace'], queryFn: () => videoGeneration.listMaterials({ page: 1, page_size: 60 }) });
    const items = q.data?.items ?? [];
    return (
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {items.map((m) => (
          <li key={m.material_id}>
            <button type="button" onClick={() => onPick({ material_id: m.material_id })}
              className="block w-full overflow-hidden rounded-lg border border-[var(--cy-border-subtle)] hover:border-[var(--cy-brand-500)]">
              <img src={videoGeneration.materialThumbUrl(m.material_id)} alt={m.name} className="aspect-video w-full object-cover" loading="lazy" />
              <span className="block truncate px-1 py-0.5 text-[10px] text-[var(--cy-text-secondary)]">{m.name}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  };
  ```
  (`listMaterials` 返回 `VgMaterial[]`,字段 `material_id`/`name`。确认 import 了 `useQuery`。)
- finalize 传 cues:把 `videoGeneration.finalizeDraft(draft.taskId, timeline)` 改为 `videoGeneration.finalizeDraft(draft.taskId, timeline, cues.length ? cues : undefined)`。
- `<TimelineTracks .../>` 加 props:`onDropAudio={onDropAudio}`、`onCuesChange={setCues}`、`onReplaceClip={onReplaceClip}`。

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 4: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/VgTimelineEditorPage.tsx chayuan-client/packages/app/src/features/video-generation/steps/MaterialsStep.tsx
git commit -m "feat(client/vg): 编辑器接线 — audio drop / 替换素材窗 / finalize 传编辑字幕 cues

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 12: 视频任务列表过滤草稿

**Files:**
- Modify: `packages/app/src/features/video-generation/VgTaskListPanel.tsx`

参考(已有):`const tasks = q.data?.items ?? [];`(line ~39)。

- [ ] **Step 1: 过滤非 video 任务**

把:
```tsx
  const tasks = q.data?.items ?? [];
```
改为:
```tsx
  // 只显示完整生成任务;stop_at!=video 的是时间轴草稿(stop_at=subtitle),不污染列表。
  // finalize 后草稿会被升为 stop_at=video,正常显示渲染进度。
  const tasks = (q.data?.items ?? []).filter((t) => t.stop_at === 'video');
```

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/VgTaskListPanel.tsx
git commit -m "feat(client/vg): 视频任务列表过滤掉 stop_at!=video 的时间轴草稿

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 13: 联调验证

- [ ] **Step 1: 全量 typecheck + 单测 + 构建**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client
pnpm --filter @chayuan/app typecheck && pnpm --filter @chayuan/api typecheck
pnpm exec vitest run packages/app/src/features/video-generation/timeline
cd /work/chayuan-desktop/chayuan-server
PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_p5b_audio.py libs/chayuan-server/tests/unit_tests/test_vg_p5b_finalize.py libs/chayuan-server/tests/unit_tests/test_vg_finalize.py
cd /work/chayuan-desktop/chayuan-client && pnpm run build:web 2>&1 | tail -3
```
Expected: typecheck 0;前端 timeline 单测全 PASS(含 subtitleEdit 3 + timelineEdit 新 2);后端 P5b audio 3 + P5b finalize ~4 + 旧 finalize 6;web build `✓ built`。

- [ ] **Step 2: 手动验收清单(重建前端 + 重启 sidecar 后)**

- 进编辑器(去编辑合成)→ 5 轨:视频/旁白/音频/音乐/字幕。
- 字幕轨:拖 cue 把手改起止;双击 cue 改文字。
- 拖音频素材到「音频」轨 → 出现音频 clip(按位置)。
- 选中视频 clip → 工具条「替换」→ 选素材 → clip 源被替换(时长不变)。
- 「提交合成」→ 成片:旁白 + BGM + 插入音频按位混音;字幕用编辑后的文字/时间。
- 草稿不再出现在「视频任务」;finalize 后该任务显渲染进度。

- [ ] **Step 3: 最终推送(若联调有微调)**

```bash
cd /work/chayuan-desktop
git add -A && git commit -m "fix(vg): P5b 联调微调" && git push origin main
```

---

## Self-Review

**Spec coverage:**
- ① 编辑字幕 → Task 5(subtitleEdit)、7(SubtitleCueTrack 可编辑)、4(api cues)、2/3(后端写 srt 覆盖 + 路由)、11(finalize 传 cues)。✓
- ② 替换 clip → Task 6(replaceClipSource)、9(替换按钮)、11(替换窗)。✓
- ③ 插入音频轨 → Task 6(appendAudioClip + DraggedMaterial audio)、8(AudioInsertTrack)、10(5 轨 + audio drop)、11(MaterialsStep audio kind + onDropAudio)、1(compose 抽 audio 轨 + extra_audios 混音)。✓
- ④ 清理草稿 → Task 2(finalize 升 stop_at=video + update_progress stop_at)、12(列表过滤)。✓

**Placeholder scan:** 无 TBD;各步给完整代码。Task 11 替换窗用 `ReplacePicker`(本文件定义,限「我的素材」库,在线搜索替换列后续 —— 已在 spec 非目标/此处说明,非占位)。

**Type consistency:** `SrtCue`(srtParse,P5a)被 subtitleEdit(Task5)、SubtitleCueTrack(Task7)、TimelineTracks(Task10)、编辑器(Task11)一致使用;`VgSubtitleCue`(api,Task4)与后端 `subtitle_cues`(Task2/3)字段 `startMs/endMs/text` 一致;`DraggedMaterial.kind` 加 `'audio'`(Task6)被 MaterialsStep(Task11)、TimelineTracks audio drop(Task10)、编辑器路由(Task11)一致;`replaceClipSource`/`appendAudioClip`(Task6)被 Task9/10/11 一致调用;`finalize_task(subtitle_cues=)`(Task2)与路由(Task3)、api(Task4)、编辑器(Task11)一致;`update_progress(stop_at=)`(Task2 store)与 finalize_task 调用一致;`generate_video(extra_audios=)`/`_build_extra_audios`(Task1)与 render_from_edl 接线一致;`onReplaceClip`/`onDropAudio`/`onCuesChange`(Task10 props)与编辑器(Task11)一致。

**依赖顺序:** 后端 1(audio 混音)→2(finalize cues+stop_at)→3(路由);api 4;前端算子 5(subtitle)、6(clip/audio);UI 7(字幕)、8(音频轨)、9(替换按钮)、10(装配)、11(编辑器接线)、12(列表过滤);13 联调。Task 10 的新 props 均可选,故 7/8/9 之后 10 可独立 typecheck 绿;11 补齐传参。无循环依赖。
