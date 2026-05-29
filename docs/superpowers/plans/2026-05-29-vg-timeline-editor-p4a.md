# 时间轴编辑器 P4a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把时间轴编辑器从 P3 的"小卡片单视频轨"重设计为三区 NLE 布局(左小素材库 + 右大预览 / transport / 全宽多轨),引入预生成草稿(复用 `stop_at=materials`)、旁白波形/字幕 cue/BGM 三轨只读可视化、proxy 预览 + 播放头联动、zoom/标尺/轨道头。

**Architecture:** 后端复用 pipeline:`stop_at="materials"` 产出旁白音频/字幕/素材并落库为"草稿 task";编辑 V 轨后 `POST /tasks/{id}/finalize` 只跑 compose(复用 `render_from_edl`,不重跑 TTS)。新增 `audio-peaks`(波形)、`thumb`(抽帧)两只读接口。前端 `VgTimelineEditorPage` 重写为三区容器,时间轴拆成 TimeRuler/Playhead/TransportBar/PreviewPlayer/TimelineTracks/各轨小组件 + 纯函数 `timelineScale`/`srtParse`。草稿状态进 vgComposer store(不进 `params`),按 `scriptHash` 失效。

**Tech Stack:** Python 3.12 / FastAPI / moviepy 2.x / ffmpeg(imageio_ffmpeg) / numpy;TS / React 19 / Zustand / TanStack Query / Tailwind v4;vitest(前端纯函数)+ pytest(后端)。

**前置:** P1(EDL schema + 渲染)、P2(`/preview-edl` + 只读时间轴)、P3(`timelineEdit.ts` 算子 + 交互编辑)已落地。

**收尾:** monorepo `/work/chayuan-desktop`,commit 进 `main`,每 task 完成 `git push origin main`。

---

## File Structure

**后端**(`libs/chayuan-server/chayuan/server/video_generation/`):
- `steps/media_probe.py`(新)— 波形下采样 + 抽帧缩略图纯工具 + ffmpeg 封装。
- `runner.py`(改)— 新增 `enqueue_finalize` + `_run_finalize`(compose-only)。
- `service.py`(改)— 新增 `finalize_task`。
- `api_server/video_generation_routes.py`(改)— `+POST /tasks/{id}/finalize`、`+GET /files/{id}/audio-peaks`、`+GET /files/{id}/thumb`。
- `tests/unit_tests/test_vg_media_probe.py` / `test_vg_finalize.py`(新)。

**API 客户端**(`packages/api/src/videoGeneration.ts`,改):`vgFinalizeDraft` / `vgFetchAudioPeaks` / `vgThumbUrl` + 类型,挂进 `videoGeneration` 聚合对象。

**前端纯工具**(`packages/app/src/features/video-generation/timeline/`,新):
- `timelineScale.ts`(+`.test.ts`)— pxPerSec↔ms 换算、totalDurationMs、fit、clamp。
- `srtParse.ts`(+`.test.ts`)— srt 文本 → cue 数组。

**前端 store**(`packages/app/src/features/video-generation/store/vgComposer.ts`,改):`VgTimelineDraft` 状态 + `scriptHashOf` + `setDraft`/`patchDraft`。

**前端组件**(`packages/app/src/features/video-generation/timeline/`,新)+ 页面重写:
- `TimeRuler.tsx`、`Playhead.tsx`、`TransportBar.tsx`、`PreviewPlayer.tsx`、`TrackHeader.tsx`、`AudioWaveTrack.tsx`、`SubtitleCueTrack.tsx`、`BgmTrack.tsx`、`TimelineTracks.tsx`、`MediaPoolPanel.tsx`。
- `VgTimelineEditorPage.tsx`(重写)。
- 复用:`VgTimeline.tsx`(P3,作 video 轨)、`buildTimeline.ts`、`timelineEdit.ts`。

> **关键布局决策(scroll 同步):** TimeRuler 与所有轨道 lane 放进**同一个**横向滚动容器(ruler sticky top),天然共享 `scrollLeft`,免去手动同步。轨道头(TrackHeader)是滚动容器**左侧外**的固定列。Playhead 是滚动内容内的绝对定位竖线(`left = msToPx(playheadMs)`)。

---

## Task 1: 后端 media_probe — 波形下采样 + 抽帧(纯工具 + ffmpeg)

**Files:**
- Create: `libs/chayuan-server/chayuan/server/video_generation/steps/media_probe.py`
- Test: `libs/chayuan-server/tests/unit_tests/test_vg_media_probe.py`

- [ ] **Step 1: 写失败测试**

`libs/chayuan-server/tests/unit_tests/test_vg_media_probe.py`:
```python
import numpy as np
import pytest

from chayuan.server.video_generation.steps.media_probe import (
    downsample_peaks,
    build_thumbnail_cmd,
)


def test_downsample_peaks_fixed_length():
    # 1 秒 8kHz 正弦,峰值应接近 1.0,长度恒为 n
    sr = 8000
    samples = np.sin(np.linspace(0, 2 * np.pi * 5, sr)).astype(np.float32)
    peaks = downsample_peaks(samples, 100)
    assert len(peaks) == 100
    assert max(peaks) <= 1.0 and max(peaks) > 0.8
    assert all(0.0 <= p <= 1.0 for p in peaks)


def test_downsample_peaks_empty_returns_zeros():
    peaks = downsample_peaks(np.array([], dtype=np.float32), 50)
    assert peaks == [0.0] * 50


def test_downsample_peaks_shorter_than_n():
    # 样本数 < n 时仍返回 n 个值(不报错)
    peaks = downsample_peaks(np.array([0.5, -0.9, 0.3], dtype=np.float32), 10)
    assert len(peaks) == 10
    assert max(peaks) == pytest.approx(0.9, abs=1e-6)


def test_build_thumbnail_cmd_shape():
    cmd = build_thumbnail_cmd("/x/ffmpeg", "/v/in.mp4", "/v/out.jpg", 1.5)
    assert cmd[0] == "/x/ffmpeg"
    assert "-ss" in cmd and "1.5" in cmd
    assert cmd[-1] == "/v/out.jpg"
    assert "-frames:v" in cmd and "1" in cmd
    assert any("scale=160" in c for c in cmd)
```

- [ ] **Step 2: 跑 → FAIL**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_media_probe.py`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 media_probe.py**

`libs/chayuan-server/chayuan/server/video_generation/steps/media_probe.py`:
```python
"""时间轴可视化媒体探测工具:旁白波形下采样 + 视频抽帧缩略图。

只读,不改动素材。ffmpeg 二进制走 imageio_ffmpeg(与 compose 一致)。
波形:ffmpeg 解码为单声道 8kHz s16le PCM → numpy → 分桶取峰值。
缩略图:ffmpeg 抽指定时刻一帧,缩到宽 160,落盘缓存。
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from typing import List

import numpy as np

logger = logging.getLogger(__name__)

PEAK_SAMPLE_RATE = 8000


def _ffmpeg_bin() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def downsample_peaks(samples: "np.ndarray", n: int) -> List[float]:
    """把 [-1,1] 浮点样本数组分成 n 桶,每桶取 max(abs) 归一峰值。

    纯函数:空数组返回 n 个 0;样本少于 n 也返回 n 个值。
    """
    n = max(1, int(n))
    if samples.size == 0:
        return [0.0] * n
    buckets = np.array_split(np.abs(samples), n)
    return [float(b.max()) if b.size else 0.0 for b in buckets]


def extract_peaks(audio_path: str, n: int = 600) -> dict:
    """解码 audio_path 为 PCM,返回 {peaks:[n], duration_ms}。失败返回全 0。"""
    cmd = [
        _ffmpeg_bin(), "-v", "error", "-i", audio_path,
        "-ac", "1", "-ar", str(PEAK_SAMPLE_RATE), "-f", "s16le", "-",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, check=True)
    except Exception as e:  # noqa: BLE001
        logger.warning("[media_probe] 波形解码失败 %s: %r", audio_path, e)
        return {"peaks": [0.0] * n, "duration_ms": 0}
    samples = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    duration_ms = int(samples.size / PEAK_SAMPLE_RATE * 1000)
    return {"peaks": downsample_peaks(samples, n), "duration_ms": duration_ms}


def build_thumbnail_cmd(ffmpeg: str, video_path: str, out_path: str, t: float) -> List[str]:
    """构造抽帧命令(纯函数,便于单测)。-ss 放 -i 前(快速 seek)。"""
    return [
        ffmpeg, "-v", "error", "-ss", str(t), "-i", video_path,
        "-frames:v", "1", "-vf", "scale=160:-1", "-y", out_path,
    ]


def extract_thumbnail(video_path: str, out_path: str, t: float = 0.0) -> str:
    """抽 video_path 第 t 秒一帧到 out_path(已存在则直接返回)。失败返回空串。"""
    if os.path.isfile(out_path) and os.path.getsize(out_path) > 0:
        return out_path
    cmd = build_thumbnail_cmd(_ffmpeg_bin(), video_path, out_path, t)
    try:
        subprocess.run(cmd, capture_output=True, check=True)
    except Exception as e:  # noqa: BLE001
        logger.warning("[media_probe] 抽帧失败 %s@%s: %r", video_path, t, e)
        return ""
    return out_path if os.path.isfile(out_path) else ""


def cached_peaks(audio_path: str, cache_dir: str, n: int = 600) -> dict:
    """带磁盘缓存的 extract_peaks:cache_dir/peaks_{n}.json。"""
    cache_file = os.path.join(cache_dir, f"peaks_{n}.json")
    if os.path.isfile(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:  # noqa: BLE001
            pass
    result = extract_peaks(audio_path, n)
    try:
        os.makedirs(cache_dir, exist_ok=True)
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(result, f)
    except Exception as e:  # noqa: BLE001
        logger.warning("[media_probe] 写 peaks 缓存失败: %r", e)
    return result
```

- [ ] **Step 4: 跑 → PASS**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_media_probe.py`
Expected: 4 passed。

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/media_probe.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_media_probe.py
git commit -m "feat(vg): media_probe — 旁白波形下采样 + 视频抽帧缩略图(纯工具+ffmpeg)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 2: 后端 finalize — 草稿只跑 compose(复用 audio/subtitle,不重跑 TTS)

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/video_generation/runner.py`
- Modify: `libs/chayuan-server/chayuan/server/video_generation/service.py`
- Test: `libs/chayuan-server/tests/unit_tests/test_vg_finalize.py`

参考(已有,勿改):`runner.enqueue`(line 77)、`runner._compose_via_edl`(line 586)、`runner._persist_vg_videos`、`runner._is_canceled`/`_mark_failed`/`_mark_canceled`/`_mark_complete`、`runner._active_futures`、`runner._get_executor`;`service.retry_task`(模板)、`tasks_store.update_progress`、`tasks_store.get_task`(返回含 `result` dict,键有 `audio_file`/`subtitle_path`/`materials`)。

- [ ] **Step 1: 写失败测试**

`libs/chayuan-server/tests/unit_tests/test_vg_finalize.py`:
```python
from unittest import mock

import pytest

from chayuan.server.video_generation import service, runner
from chayuan.server.video_generation.schemas import VideoParams


def _draft_row():
    return {
        "task_id": "draft-1",
        "owner_id": 1,
        "state": "complete",
        "stop_at": "materials",
        "params": VideoParams(video_subject="t", video_script="hi").model_dump(mode="json"),
        "result": {
            "audio_file": "/d/a.mp3",
            "subtitle_path": "/d/s.srt",
            "materials": ["/d/m0.mp4"],
        },
    }


def test_finalize_task_enqueues_compose_only(monkeypatch):
    monkeypatch.setattr(service.tasks_store, "get_task", lambda *a, **k: _draft_row())
    upd = mock.Mock(return_value=True)
    monkeypatch.setattr(service.tasks_store, "update_progress", upd)
    enq = mock.Mock()
    monkeypatch.setattr(service.runner, "enqueue_finalize", enq)

    ok = service.finalize_task("draft-1", {"version": 1, "duration_ms": 0, "tracks": []}, owner_id=1)
    assert ok is True
    # 入队的是 finalize(compose-only),不是从头 enqueue
    enq.assert_called_once()
    args, kwargs = enq.call_args
    assert args[0] == "draft-1"
    assert kwargs["audio_file"] == "/d/a.mp3"
    assert kwargs["subtitle_path"] == "/d/s.srt"
    # 传入的 params.timeline 被设上
    assert args[1].timeline is not None


def test_finalize_task_missing_draft_returns_false(monkeypatch):
    monkeypatch.setattr(service.tasks_store, "get_task", lambda *a, **k: None)
    assert service.finalize_task("nope", {"version": 1, "tracks": []}, owner_id=1) is False


def test_finalize_task_no_audio_returns_false(monkeypatch):
    row = _draft_row()
    row["result"] = {"materials": ["/d/m0.mp4"]}  # 缺 audio_file
    monkeypatch.setattr(service.tasks_store, "get_task", lambda *a, **k: row)
    assert service.finalize_task("draft-1", {"version": 1, "tracks": []}, owner_id=1) is False


def test_run_finalize_does_not_call_tts(monkeypatch):
    # _run_finalize 只调 _compose_via_edl,不碰 tts/subtitle/materials
    monkeypatch.setattr(runner, "_is_canceled", lambda _t: False)
    monkeypatch.setattr(runner.tasks_store, "update_progress", lambda *a, **k: True)
    composed = mock.Mock(return_value="/d/final-0.mp4")
    monkeypatch.setattr(runner, "_compose_via_edl", composed)
    monkeypatch.setattr(runner, "_persist_vg_videos", mock.Mock())
    monkeypatch.setattr(runner, "_mark_complete", mock.Mock())
    params = VideoParams(video_subject="t", video_script="hi")
    runner._run_finalize("draft-1", params, audio_file="/d/a.mp3", subtitle_path="/d/s.srt")
    composed.assert_called_once()
```

- [ ] **Step 2: 跑 → FAIL**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_finalize.py`
Expected: FAIL(`finalize_task` / `enqueue_finalize` / `_run_finalize` 不存在)。

- [ ] **Step 3: runner 加 enqueue_finalize + _run_finalize**

在 `runner.py` 的 `_compose_via_edl` 定义之后(line ~613 之后)加:
```python
def enqueue_finalize(task_id: str, params, *, audio_file: str, subtitle_path: str) -> "Future":
    """把草稿任务的 compose-only 收尾入队(复用已生成 audio/subtitle/materials)。"""
    _canceled.discard(task_id)  # 清旧取消标记(与 enqueue 一致)
    future = _get_executor().submit(
        _run_finalize, task_id, params, audio_file, subtitle_path,
    )
    _active_futures[task_id] = future
    future.add_done_callback(lambda _f: _active_futures.pop(task_id, None))
    return future


def _run_finalize(task_id: str, params, audio_file: str, subtitle_path: str) -> None:
    """只跑 compose(EDL):用草稿已生成的 audio/subtitle + 编辑后的 params.timeline。"""
    try:
        if _is_canceled(task_id):
            return _mark_canceled(task_id)
        tasks_store.update_progress(
            task_id, state=VgTaskState.processing.value, progress=75,
            result_patch={"stage": "compose", "stage_hint": "正在合成视频(CPU 渲染,可能需要 1-3 分钟)"},
        )
        final_path = _compose_via_edl(task_id, params, audio_file, subtitle_path)
        if not final_path:
            return _mark_failed(task_id, "moviepy 合成失败 — 详见日志")
        if _is_canceled(task_id):
            return _mark_canceled(task_id)
        _persist_vg_videos(task_id, params, [final_path])
        _mark_complete(task_id, progress=100)
        logger.info("[runner] finalize 完成 task=%s", task_id)
    except Exception as e:  # noqa: BLE001
        logger.exception("[runner] finalize 异常 task=%s", task_id)
        _mark_failed(task_id, f"{type(e).__name__}: {e}")
```
> 确认文件顶部已 `from .store import tasks as tasks_store`、`from .schemas import ... VgTaskState`、`from concurrent.futures import Future`。若 `Future` 未直接 import,用字符串注解(如上)即可,无需新增 import。`_canceled` 是模块级集合(enqueue 里 `.discard` 用法以现有代码为准:若现有是别的名字如 `_canceled_ids`,按现有改)。

- [ ] **Step 4: service 加 finalize_task**

在 `service.py` 的 `retry_task` 之后加:
```python
def finalize_task(
    task_id: str, timeline: Dict[str, Any], *, owner_id: Optional[int] = None,
) -> bool:
    """草稿收尾:校验草稿持有 audio/subtitle/materials,设 timeline,只跑 compose。"""
    row = tasks_store.get_task(task_id, owner_id=owner_id)
    if not row:
        return False
    result = row.get("result") or {}
    audio_file = result.get("audio_file")
    subtitle_path = result.get("subtitle_path")
    if not audio_file or not subtitle_path or not result.get("materials"):
        logger.warning("[service] finalize_task %s 草稿缺 audio/subtitle/materials", task_id)
        return False
    try:
        params = VideoParams.model_validate(row.get("params") or {})
        from .schemas import Timeline
        params.timeline = Timeline.model_validate(timeline)
    except Exception as e:  # noqa: BLE001
        logger.warning("[service] finalize_task %s params/timeline 解析失败: %r", task_id, e)
        return False
    tasks_store.update_progress(task_id, state=VgTaskState.pending.value, progress=70)
    runner.enqueue_finalize(task_id, params, audio_file=audio_file, subtitle_path=subtitle_path)
    logger.info("[service] finalize_task %s 入队 compose-only", task_id)
    return True
```
> 确认 `service.py` 顶部已 `from typing import Any, Dict, Optional`、`from .schemas import VideoParams, VgTaskState`、`from . import runner`、`from .store import tasks as tasks_store`。缺哪个补哪个(按现有 import 风格)。

- [ ] **Step 5: 跑 → PASS**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_finalize.py`
Expected: 4 passed。若 `_canceled` 名字/`Future` import 报错,按文件现状微调后重跑。

- [ ] **Step 6: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/runner.py chayuan-server/libs/chayuan-server/chayuan/server/video_generation/service.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_finalize.py
git commit -m "feat(vg): finalize 草稿 — 只跑 compose 复用 audio/subtitle(不重跑 TTS)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 3: 后端路由 — finalize / audio-peaks / thumb

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py`

参考(已有):`serve_task_file`(line ~1333,含 `_owner_id_of(user)` + `vg_service.get_task` 归属校验 + `task_dir` + `resolve_path_within_directory`)、`preview_edl`(line ~1382)、`require_auth_enabled`、`Body`、`Query`、`FPath`、`HTTPException`、`FileResponse`、`JSONResponse`。

- [ ] **Step 1: 加三个路由**

在 `preview_edl` 路由之后追加:
```python
@video_generation_router.post(
    "/tasks/{task_id}/finalize", summary="草稿收尾:用编辑后的时间轴只跑 compose",
)
def finalize_task(
    task_id: str = FPath(...),
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> JSONResponse:
    timeline = body.get("timeline")
    if not isinstance(timeline, dict):
        raise HTTPException(422, "body.timeline 必填(Timeline 对象)")
    ok = vg_service.finalize_task(task_id, timeline, owner_id=_owner_id_of(user))
    if not ok:
        raise HTTPException(400, "finalize 失败:草稿不存在或缺 audio/subtitle/materials")
    row = vg_service.get_task(task_id, owner_id=_owner_id_of(user))
    return JSONResponse(row or {"task_id": task_id})


@video_generation_router.get(
    "/files/{task_id}/audio-peaks", summary="旁白音频波形峰值(时间轴音频轨)",
)
def task_audio_peaks(
    task_id: str = FPath(...),
    n: int = Query(600, ge=16, le=4000),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> JSONResponse:
    from chayuan.server.video_generation._helpers import task_dir
    from chayuan.server.video_generation.steps import media_probe

    row = vg_service.get_task(task_id, owner_id=_owner_id_of(user))
    if not row:
        raise HTTPException(404, "task not found")
    audio_file = (row.get("result") or {}).get("audio_file")
    if not audio_file or not os.path.isfile(audio_file):
        raise HTTPException(404, "audio not ready")
    data = media_probe.cached_peaks(audio_file, task_dir(task_id, create=True), n=n)
    return JSONResponse(data)


@video_generation_router.get(
    "/files/{task_id}/thumb", summary="素材首帧缩略图(时间轴视频轨)",
)
def task_thumbnail(
    task_id: str = FPath(...),
    src: int = Query(0, ge=0, description="materials 下标"),
    t: float = Query(0.0, ge=0.0, description="抽帧秒"),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> FileResponse:
    from chayuan.server.video_generation._helpers import task_dir
    from chayuan.server.video_generation.steps import media_probe

    row = vg_service.get_task(task_id, owner_id=_owner_id_of(user))
    if not row:
        raise HTTPException(404, "task not found")
    mats = (row.get("result") or {}).get("materials") or []
    if src >= len(mats):
        raise HTTPException(404, "material index out of range")
    out = os.path.join(task_dir(task_id, create=True), f"thumb_{src}_{int(t)}.jpg")
    got = media_probe.extract_thumbnail(mats[src], out, t)
    if not got:
        raise HTTPException(502, "thumbnail extract failed")
    return FileResponse(got, media_type="image/jpeg")
```
> 确认文件顶部已 `import os`、`from fastapi import Body, Query, Depends`、`from fastapi import Path as FPath`、`from fastapi.responses import FileResponse, JSONResponse`。`_owner_id_of`、`vg_service`、`require_auth_enabled` 在本文件已用(serve_task_file 同款)。

- [ ] **Step 2: py_compile + import 冒烟**

Run:
```bash
cd /work/chayuan-desktop/chayuan-server
PYTHONPATH="libs/chayuan-server" python -m py_compile libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py
PYTHONPATH="libs/chayuan-server" python -c "import chayuan.server.api_server.video_generation_routes as m; print('routes import OK', hasattr(m,'finalize_task'))"
```
Expected: `routes import OK True`。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py
git commit -m "feat(vg): 路由 finalize / audio-peaks / thumb

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 4: API 客户端 — finalizeDraft / fetchAudioPeaks / thumbUrl

**Files:**
- Modify: `packages/api/src/videoGeneration.ts`

参考(已有):`vgSubmitTask`(POST `/tasks`)、`vgGetTask`、`vgTaskFileUrl`(line 744,拼 `/files/{id}/{name}` URL)、`getClientConfig`、`request`、`videoGeneration` 聚合(line 781)、类型 `VgTask`/`VgTimeline`。

- [ ] **Step 1: 加函数 + 类型**

先给 `VgTask` 接口(line ~135)补一个可选 `result` 字段(后端 task 行返回 `result` dict,Task 14 要读 `audio_file`/`subtitle_path`/`materials`):
```ts
  // 在 VgTask 接口内追加:
  result?: Record<string, unknown> | null;
```

在 `vgTaskFileUrl` 附近加:
```ts
export interface VgAudioPeaks {
  peaks: number[];
  duration_ms: number;
}

/** 草稿收尾:用编辑后的时间轴只跑 compose,返回更新后的 task。 */
export async function vgFinalizeDraft(taskId: string, timeline: VgTimeline): Promise<VgTask> {
  return rd<VgTask>(`/api/v1/video-generation/tasks/${encodeURIComponent(taskId)}/finalize`, {
    method: 'POST',
    body: { timeline },
  });
}

/** 旁白波形峰值(音频轨)。 */
export async function vgFetchAudioPeaks(taskId: string, n = 600): Promise<VgAudioPeaks> {
  return rd<VgAudioPeaks>(
    `/api/v1/video-generation/files/${encodeURIComponent(taskId)}/audio-peaks`,
    { query: { n } },
  );
}

/** 素材首帧缩略图 URL(<img src>)。 */
export function vgThumbUrl(taskId: string, src: number, t = 0): string {
  const cfg = getClientConfig();
  const base = (cfg.baseURL || '').replace(/\/+$/, '');
  return `${base}/api/v1/video-generation/files/${encodeURIComponent(taskId)}/thumb?src=${src}&t=${t}`;
}
```
> `rd` 是本文件内部的请求辅助(同 `vgSubmitTask` 用的那个)。若本文件请求辅助叫别的名(如直接用 `request`),按 `vgSubmitTask`/`vgGetTask` 的现有写法照抄。

- [ ] **Step 2: 挂进聚合对象**

在 `export const videoGeneration = {` 内 `downloadTaskFile: vgDownloadTaskFile,` 附近加:
```ts
  finalizeDraft: vgFinalizeDraft,
  fetchAudioPeaks: vgFetchAudioPeaks,
  thumbUrl: vgThumbUrl,
```

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/api typecheck`
Expected: 0 错误。

- [ ] **Step 4: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/api/src/videoGeneration.ts
git commit -m "feat(client/vg): api finalizeDraft / fetchAudioPeaks / thumbUrl

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 5: 前端纯工具 timelineScale + 单测

**Files:**
- Create: `packages/app/src/features/video-generation/timeline/timelineScale.ts`
- Test: `packages/app/src/features/video-generation/timeline/timelineScale.test.ts`

- [ ] **Step 1: 写失败测试**

`timelineScale.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { msToPx, pxToMs, clampPxPerSec, fitPxPerSec, totalDurationMs, PPS_MIN, PPS_MAX } from './timelineScale';
import type { VgTimeline } from '@chayuan/api';

const tl = (clips: { id: string; start: number; out: number }[]): VgTimeline => ({
  version: 1, duration_ms: 0,
  tracks: [{ id: 'v', kind: 'video', clips: clips.map((c) => ({ id: c.id, source: { path: `/${c.id}.mp4` }, track_start_ms: c.start, in_ms: 0, out_ms: c.out })) }],
});

it('msToPx / pxToMs round-trip', () => {
  expect(msToPx(5000, 12)).toBe(60);
  expect(pxToMs(60, 12)).toBe(5000);
});

it('clampPxPerSec bounds', () => {
  expect(clampPxPerSec(1)).toBe(PPS_MIN);
  expect(clampPxPerSec(9999)).toBe(PPS_MAX);
  expect(clampPxPerSec(20)).toBe(20);
});

it('fitPxPerSec fills container for total duration', () => {
  // 30s 要 fit 到 600px → 20 px/s
  expect(fitPxPerSec(30000, 600)).toBe(20);
  // 极短时长不会超过 PPS_MAX
  expect(fitPxPerSec(100, 600)).toBe(PPS_MAX);
});

it('totalDurationMs = max(audio, 片段总长)', () => {
  // 片段总长 5000;音频 8000 → 8000
  expect(totalDurationMs(tl([{ id: 'a', start: 0, out: 5000 }]), 8000)).toBe(8000);
  // 片段总长 10000 > 音频 3000 → 10000
  expect(totalDurationMs(tl([{ id: 'a', start: 0, out: 6000 }, { id: 'b', start: 6000, out: 4000 }]), 3000)).toBe(10000);
  // 无音频(0)→ 片段总长
  expect(totalDurationMs(tl([{ id: 'a', start: 0, out: 4000 }]), 0)).toBe(4000);
});
```

- [ ] **Step 2: 跑 → FAIL**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm exec vitest run packages/app/src/features/video-generation/timeline/timelineScale.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 timelineScale.ts**

```typescript
import type { VgTimeline } from '@chayuan/api';
import { clipDurMs } from './timelineEdit';

/** zoom 范围:px/秒。下限保证长视频可见全貌,上限保证可精修。 */
export const PPS_MIN = 4;
export const PPS_MAX = 120;

export const msToPx = (ms: number, pxPerSec: number): number => (ms / 1000) * pxPerSec;
export const pxToMs = (px: number, pxPerSec: number): number => Math.round((px / pxPerSec) * 1000);

export const clampPxPerSec = (pps: number): number => Math.max(PPS_MIN, Math.min(PPS_MAX, pps));

/** 让 totalMs 时长正好填满 containerPx 宽的 px/秒(夹在合法范围)。 */
export function fitPxPerSec(totalMs: number, containerPx: number): number {
  const sec = Math.max(0.001, totalMs / 1000);
  return clampPxPerSec(containerPx / sec);
}

/** 视频轨片段总长(紧贴拼接,用 clipDurMs)。 */
function videoSumMs(t: VgTimeline): number {
  const clips = (t.tracks || []).find((tr) => tr.kind === 'video')?.clips ?? [];
  return clips.reduce((acc, c) => acc + clipDurMs(c), 0);
}

/** 时间轴画布总时长 = max(旁白音频时长, 视频片段总长)。 */
export function totalDurationMs(t: VgTimeline, audioDurationMs: number): number {
  return Math.max(audioDurationMs || 0, videoSumMs(t));
}
```

- [ ] **Step 4: 跑 → PASS**

Run: 同 Step 2 命令。Expected: 全 PASS。

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/timelineScale.ts chayuan-client/packages/app/src/features/video-generation/timeline/timelineScale.test.ts
git commit -m "feat(client/vg): timelineScale 纯工具(px↔ms / zoom clamp / fit / totalDuration)+ 单测

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 6: 前端纯工具 srtParse + 单测

**Files:**
- Create: `packages/app/src/features/video-generation/timeline/srtParse.ts`
- Test: `packages/app/src/features/video-generation/timeline/srtParse.test.ts`

- [ ] **Step 1: 写失败测试**

`srtParse.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseSrt } from './srtParse';

const SRT = `1
00:00:00,000 --> 00:00:02,500
你好世界

2
00:00:02,500 --> 00:00:05,000
第二句字幕
`;

it('parses cues with ms timing', () => {
  const cues = parseSrt(SRT);
  expect(cues).toHaveLength(2);
  expect(cues[0]).toEqual({ startMs: 0, endMs: 2500, text: '你好世界' });
  expect(cues[1]!.startMs).toBe(2500);
  expect(cues[1]!.endMs).toBe(5000);
});

it('tolerates blank input', () => {
  expect(parseSrt('')).toEqual([]);
  expect(parseSrt('   \n\n')).toEqual([]);
});

it('joins multi-line cue text', () => {
  const cues = parseSrt('1\n00:00:01,000 --> 00:00:02,000\nline A\nline B\n');
  expect(cues[0]!.text).toBe('line A\nline B');
});
```

- [ ] **Step 2: 跑 → FAIL**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm exec vitest run packages/app/src/features/video-generation/timeline/srtParse.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 srtParse.ts**

```typescript
export interface SrtCue {
  startMs: number;
  endMs: number;
  text: string;
}

const TIME_RE = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

const toMs = (h: string, m: string, s: string, ms: string): number =>
  ((+h * 60 + +m) * 60 + +s) * 1000 + +ms;

/** 解析 SRT 文本为 cue 数组。容错空行/多行文本/逗号或点的毫秒分隔。 */
export function parseSrt(text: string): SrtCue[] {
  const cues: SrtCue[] = [];
  const blocks = (text || '').replace(/\r/g, '').trim().split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const tIdx = lines.findIndex((l) => TIME_RE.test(l));
    if (tIdx < 0) continue;
    const m = lines[tIdx]!.match(TIME_RE)!;
    const startMs = toMs(m[1]!, m[2]!, m[3]!, m[4]!);
    const endMs = toMs(m[5]!, m[6]!, m[7]!, m[8]!);
    const content = lines.slice(tIdx + 1).join('\n').trim();
    if (content) cues.push({ startMs, endMs, text: content });
  }
  return cues;
}
```

- [ ] **Step 4: 跑 → PASS**

Run: 同 Step 2。Expected: 全 PASS。

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/srtParse.ts chayuan-client/packages/app/src/features/video-generation/timeline/srtParse.test.ts
git commit -m "feat(client/vg): srtParse 纯工具(srt→cue 数组)+ 单测

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 7: vgComposer store — 草稿状态 + scriptHash

**Files:**
- Modify: `packages/app/src/features/video-generation/store/vgComposer.ts`

参考(已有):`VgComposerState` 接口(含 `params`/`activeTaskId`/`patchParams`)、`create<VgComposerState>()(persist(...))`、`VgVideoParams`。草稿状态**不进 persist 也不进 params**(它是会话级派生 + 缓存),作为独立 state 字段。

- [ ] **Step 1: 加类型 + 字段 + actions**

在 `vgComposer.ts` 顶部(import 后)加:
```typescript
export interface VgTimelineDraftMaterial {
  idx: number;
  durationMs: number;
}

export interface VgTimelineDraft {
  taskId: string | null;
  scriptHash: string;
  state: 'idle' | 'generating' | 'ready' | 'failed';
  audioFileName: string | null;
  subtitleFileName: string | null;
  audioDurationMs: number;
  materials: VgTimelineDraftMaterial[];
  error?: string;
}

const EMPTY_DRAFT: VgTimelineDraft = {
  taskId: null, scriptHash: '', state: 'idle',
  audioFileName: null, subtitleFileName: null, audioDurationMs: 0, materials: [],
};

/** 草稿失效指纹:仅脚本/语音/BGM/语言/段落 —— 画幅/timeline/素材排列不计入。 */
export function scriptHashOf(p: VgVideoParams): string {
  return JSON.stringify([
    p.video_script, p.voice_provider, p.voice_name, p.voice_rate, p.voice_volume,
    p.bgm_type, p.bgm_file, p.video_language, p.paragraph_number,
  ]);
}
```

在 `VgComposerState` 接口里加:
```typescript
  /** 时间轴预生成草稿(会话级,非 persist) */
  timelineDraft: VgTimelineDraft;
  setDraft(d: VgTimelineDraft): void;
  patchDraft(patch: Partial<VgTimelineDraft>): void;
  resetDraft(): void;
```

在 `create(...)` 的初始 state(`activeTaskId: null,` 附近)加 `timelineDraft: EMPTY_DRAFT,`,并在 actions 区加:
```typescript
      setDraft: (d) => set({ timelineDraft: d }),
      patchDraft: (patch) => set((s) => ({ timelineDraft: { ...s.timelineDraft, ...patch } })),
      resetDraft: () => set({ timelineDraft: EMPTY_DRAFT }),
```

> 若 store 用了 `persist` 的 `partialize` 白名单,**不要**把 `timelineDraft` 加进去(它是会话级)。若无 partialize(整体 persist),`timelineDraft` 会被持久化也无妨(下次进页按 scriptHash 重新校验),但更建议加 partialize 排除它;本 task 不强制改 persist 策略,保持现状即可。

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/store/vgComposer.ts
git commit -m "feat(client/vg): vgComposer 加时间轴草稿状态 + scriptHash 失效指纹

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 8: TimeRuler + Playhead 组件

**Files:**
- Create: `packages/app/src/features/video-generation/timeline/TimeRuler.tsx`
- Create: `packages/app/src/features/video-generation/timeline/Playhead.tsx`

参考:`timelineScale.ts`(msToPx/pxToMs)。两者都是**滚动内容内**的绝对/相对定位元素(由 TimelineTracks 提供同一 px 坐标系)。

- [ ] **Step 1: TimeRuler.tsx**

```tsx
import * as React from 'react';
import { msToPx, pxToMs } from './timelineScale';

/** 顶部时间刻度。宽度 = contentWidthPx(由父级算)。点击 seek。 */
export const TimeRuler: React.FC<{
  durationMs: number;
  pxPerSec: number;
  contentWidthPx: number;
  onSeekMs: (ms: number) => void;
}> = ({ durationMs, pxPerSec, contentWidthPx, onSeekMs }) => {
  // 刻度间隔:px/秒 越小,秒间隔越大(避免标签挤一起)
  const stepSec = pxPerSec >= 40 ? 1 : pxPerSec >= 20 ? 2 : pxPerSec >= 10 ? 5 : 10;
  const totalSec = Math.ceil(durationMs / 1000);
  const ticks: number[] = [];
  for (let s = 0; s <= totalSec; s += stepSec) ticks.push(s);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div
      className="relative h-6 cursor-pointer select-none border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]"
      style={{ width: contentWidthPx }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeekMs(Math.max(0, Math.min(durationMs, pxToMs(e.clientX - rect.left, pxPerSec))));
      }}
    >
      {ticks.map((s) => (
        <div key={s} className="absolute top-0 h-full" style={{ left: msToPx(s * 1000, pxPerSec) }}>
          <div className="h-2 w-px bg-[var(--cy-border-strong)]" />
          <span className="absolute left-1 top-1 text-[9px] text-[var(--cy-text-tertiary)]">{fmt(s)}</span>
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 2: Playhead.tsx**

```tsx
import * as React from 'react';
import { msToPx, pxToMs } from './timelineScale';

/** 播放头竖线(滚动内容内绝对定位)。拖动 / 由 video 联动定位。 */
export const Playhead: React.FC<{
  playheadMs: number;
  pxPerSec: number;
  heightPx: number;
  durationMs: number;
  onSeekMs: (ms: number) => void;
}> = ({ playheadMs, pxPerSec, heightPx, durationMs, onSeekMs }) => {
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const rail = (e.currentTarget.parentElement as HTMLElement) ?? null;
    const railLeft = rail ? rail.getBoundingClientRect().left : 0;
    const move = (ev: PointerEvent) => {
      onSeekMs(Math.max(0, Math.min(durationMs, pxToMs(ev.clientX - railLeft, pxPerSec))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      className="pointer-events-none absolute top-0 z-30"
      style={{ left: msToPx(playheadMs, pxPerSec), height: heightPx }}
    >
      <div className="h-full w-px bg-[var(--cy-brand-600)]" />
      <div
        className="pointer-events-auto absolute -left-1.5 -top-0 h-3 w-3 cursor-ew-resize rounded-sm bg-[var(--cy-brand-600)]"
        onPointerDown={startDrag}
      />
    </div>
  );
};
```

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 4: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/TimeRuler.tsx chayuan-client/packages/app/src/features/video-generation/timeline/Playhead.tsx
git commit -m "feat(client/vg): TimeRuler + Playhead(刻度/seek/拖动播放头)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 9: TransportBar 组件(播放/时间码/zoom)

**Files:**
- Create: `packages/app/src/features/video-generation/timeline/TransportBar.tsx`

参考:`timelineScale.ts`(PPS_MIN/PPS_MAX/clampPxPerSec)。lucide 图标 `Play`/`Pause`/`ZoomIn`/`ZoomOut`。

- [ ] **Step 1: TransportBar.tsx**

```tsx
import * as React from 'react';
import { Play, Pause, ZoomIn, ZoomOut } from 'lucide-react';
import { PPS_MIN, PPS_MAX, clampPxPerSec } from './timelineScale';

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const TransportBar: React.FC<{
  playing: boolean;
  currentMs: number;
  durationMs: number;
  pxPerSec: number;
  onPlayPause: () => void;
  onZoom: (pxPerSec: number) => void;
}> = ({ playing, currentMs, durationMs, pxPerSec, onPlayPause, onZoom }) => (
  <div className="flex items-center gap-3 border-y border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-3 py-1.5">
    <button type="button" onClick={onPlayPause}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--cy-brand-500)] text-white hover:bg-[var(--cy-brand-600)]">
      {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
    </button>
    <span className="font-mono text-xs text-[var(--cy-text-secondary)]">
      {fmt(currentMs)} / {fmt(durationMs)}
    </span>
    <div className="ml-auto flex items-center gap-1.5">
      <button type="button" onClick={() => onZoom(clampPxPerSec(pxPerSec / 1.5))}
        className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]" title="缩小">
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
      <input type="range" min={PPS_MIN} max={PPS_MAX} step={1} value={pxPerSec}
        onChange={(e) => onZoom(clampPxPerSec(Number(e.target.value)))}
        className="h-1 w-28 accent-[var(--cy-brand-500)]" />
      <button type="button" onClick={() => onZoom(clampPxPerSec(pxPerSec * 1.5))}
        className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]" title="放大">
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
);
```

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/TransportBar.tsx
git commit -m "feat(client/vg): TransportBar(播放/时间码/zoom 滑块)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 10: PreviewPlayer 组件(proxy 视频 + 播放头联动)

**Files:**
- Create: `packages/app/src/features/video-generation/timeline/PreviewPlayer.tsx`

参考(已有):`videoGeneration.previewEdl({ timeline, aspect })` 返 `{ blob }`(line 356)。播放器内部管理 proxy blob URL。

- [ ] **Step 1: PreviewPlayer.tsx**

```tsx
import * as React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { videoGeneration, type VgTimeline } from '@chayuan/api';
import { reportError } from '../../../store/errorDialog';

/**
 * proxy 预览播放器:渲染 previewEdl proxy 视频,上报 currentTime,接受外部 seek。
 * 受控字段:
 *  - seekMs:外部(点标尺/拖播放头)请求跳转;变化时 set video.currentTime。
 *  - playing:外部 transport 播放/暂停意图。
 *  - stale:timeline 变了,当前 proxy 过期,显"重新生成预览"。
 */
export const PreviewPlayer: React.FC<{
  timeline: VgTimeline;
  aspect: string;
  seekMs: number;
  playing: boolean;
  stale: boolean;
  onTimeMs: (ms: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onFreshGenerated: () => void;
}> = ({ timeline, aspect, seekMs, playing, stale, onTimeMs, onPlayingChange, onFreshGenerated }) => {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const urlRef = React.useRef<string | null>(null);
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const generate = React.useCallback(async () => {
    if (!timeline.tracks?.some((t) => t.kind === 'video' && (t.clips?.length ?? 0) > 0)) {
      reportError(new Error('先在视频轨加入素材'));
      return;
    }
    setLoading(true);
    try {
      const { blob } = await videoGeneration.previewEdl({ timeline, aspect: aspect as never });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setUrl(urlRef.current);
      onFreshGenerated();
    } catch (e) { reportError(e as Error, '预览渲染失败'); }
    finally { setLoading(false); }
  }, [timeline, aspect, onFreshGenerated]);

  // 外部 seek → set currentTime
  React.useEffect(() => {
    const v = videoRef.current;
    if (v && Number.isFinite(seekMs)) {
      const target = seekMs / 1000;
      if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = target;
    }
  }, [seekMs]);

  // 外部 play/pause 意图
  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing && v.paused) void v.play().catch(() => undefined);
    if (!playing && !v.paused) v.pause();
  }, [playing, url]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl bg-black/90 p-2">
      {url ? (
        <video
          ref={videoRef}
          src={url}
          className="max-h-full max-w-full rounded"
          onTimeUpdate={(e) => onTimeMs(e.currentTarget.currentTime * 1000)}
          onPlay={() => onPlayingChange(true)}
          onPause={() => onPlayingChange(false)}
        />
      ) : (
        <div className="text-xs text-white/60">点「生成预览」查看画面</div>
      )}
      {(stale || !url) && (
        <button type="button" onClick={() => void generate()} disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg bg-[var(--cy-brand-500)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--cy-brand-600)] disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {url ? '重新生成预览' : '生成预览'}
        </button>
      )}
    </div>
  );
};
```
> `reportError` 路径:从 `timeline/` 目录到 `store/errorDialog` 是 `../../../store/errorDialog`(timeline → video-generation → features → src/store)。若 typecheck 报路径错按实际层级修正。

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/PreviewPlayer.tsx
git commit -m "feat(client/vg): PreviewPlayer(proxy 渲染 + currentTime 上报 + 受控 seek/play)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 11: 只读轨道组件 — AudioWaveTrack / SubtitleCueTrack / BgmTrack / TrackHeader

**Files:**
- Create: `packages/app/src/features/video-generation/timeline/AudioWaveTrack.tsx`
- Create: `packages/app/src/features/video-generation/timeline/SubtitleCueTrack.tsx`
- Create: `packages/app/src/features/video-generation/timeline/BgmTrack.tsx`
- Create: `packages/app/src/features/video-generation/timeline/TrackHeader.tsx`

参考:`timelineScale.ts`(msToPx)、`srtParse.ts`(SrtCue)。这些轨道 P4a **只读**,内容宽 = contentWidthPx(由父级算)。

- [ ] **Step 1: TrackHeader.tsx(左侧固定列单元)**

```tsx
import * as React from 'react';

export const TRACK_H = 44; // 每轨高度(px),四轨共用

export const TrackHeader: React.FC<{ label: string; icon?: React.ReactNode }> = ({ label, icon }) => (
  <div
    className="flex items-center gap-1.5 border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)] px-2 text-[11px] text-[var(--cy-text-secondary)]"
    style={{ height: TRACK_H }}
  >
    {icon}
    <span className="truncate">{label}</span>
  </div>
);
```

- [ ] **Step 2: AudioWaveTrack.tsx(旁白波形,只读)**

```tsx
import * as React from 'react';
import { TRACK_H } from './TrackHeader';

/** 旁白波形轨:peaks 是 0~1 数组,按内容宽均匀铺竖条。 */
export const AudioWaveTrack: React.FC<{
  peaks: number[];
  contentWidthPx: number;
  loading?: boolean;
}> = ({ peaks, contentWidthPx, loading }) => (
  <div
    className="relative overflow-hidden border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
    style={{ height: TRACK_H, width: contentWidthPx }}
  >
    {loading && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">生成中…</span>}
    {!loading && peaks.length === 0 && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">旁白(渲染后生成)</span>}
    {!loading && peaks.length > 0 && (
      <div className="flex h-full items-center">
        {peaks.map((p, i) => {
          const w = contentWidthPx / peaks.length;
          return (
            <div key={i} style={{ width: w }} className="flex h-full items-center justify-center">
              <div style={{ height: `${Math.max(6, p * 90)}%`, width: Math.max(1, w - 0.5) }}
                className="rounded-sm bg-[var(--cy-brand-400)]" />
            </div>
          );
        })}
      </div>
    )}
  </div>
);
```

- [ ] **Step 3: SubtitleCueTrack.tsx(字幕 cue,只读)**

```tsx
import * as React from 'react';
import { msToPx } from './timelineScale';
import { TRACK_H } from './TrackHeader';
import type { SrtCue } from './srtParse';

export const SubtitleCueTrack: React.FC<{
  cues: SrtCue[];
  pxPerSec: number;
  contentWidthPx: number;
}> = ({ cues, pxPerSec, contentWidthPx }) => (
  <div className="relative border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
    style={{ height: TRACK_H, width: contentWidthPx }}>
    {cues.length === 0 && <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">字幕(渲染后生成)</span>}
    {cues.map((c, i) => (
      <div key={i}
        style={{ left: msToPx(c.startMs, pxPerSec), width: Math.max(8, msToPx(c.endMs - c.startMs, pxPerSec)) }}
        className="absolute top-1.5 flex h-8 items-center overflow-hidden rounded border border-amber-300 bg-amber-50 px-1 text-[9px] text-amber-800"
        title={c.text}>
        <span className="truncate">{c.text}</span>
      </div>
    ))}
  </div>
);
```

- [ ] **Step 4: BgmTrack.tsx(已选 BGM,只读)**

```tsx
import * as React from 'react';
import { Music } from 'lucide-react';
import { TRACK_H } from './TrackHeader';

export const BgmTrack: React.FC<{
  bgmName: string | null;
  contentWidthPx: number;
}> = ({ bgmName, contentWidthPx }) => (
  <div className="relative border-b border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)]"
    style={{ height: TRACK_H, width: contentWidthPx }}>
    {bgmName ? (
      <div className="absolute inset-x-1 top-1.5 flex h-8 items-center gap-1 overflow-hidden rounded border border-emerald-300 bg-emerald-50 px-2 text-[10px] text-emerald-800">
        <Music className="h-3 w-3 shrink-0" /> <span className="truncate">{bgmName}</span>
      </div>
    ) : (
      <span className="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]">无背景音乐</span>
    )}
  </div>
);
```

- [ ] **Step 5: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 6: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/AudioWaveTrack.tsx chayuan-client/packages/app/src/features/video-generation/timeline/SubtitleCueTrack.tsx chayuan-client/packages/app/src/features/video-generation/timeline/BgmTrack.tsx chayuan-client/packages/app/src/features/video-generation/timeline/TrackHeader.tsx
git commit -m "feat(client/vg): 只读轨道组件 波形/字幕cue/BGM/轨道头

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 12: 视频轨缩略图 — VgTimeline 增 thumbnail 支持

**Files:**
- Modify: `packages/app/src/features/video-generation/timeline/VgTimeline.tsx`

参考(已有 P3):`VgTimeline`(editable/onChange/onClipClick,video clip 块用 clipDurMs 算宽)。本 task 给 video clip 块加可选首帧缩略图背景,并支持外部传入 `pxPerSec` 与缩略图 URL 解析函数,使其能嵌入 P4a 统一坐标系。

- [ ] **Step 1: 给 VgTimeline 增 props**

在 `VgTimeline` props 类型加:
```tsx
  /** 外部统一 px/秒(P4a 多轨共用);不传则用内部默认 PX_PER_SEC。 */
  pxPerSec?: number;
  /** 由 clip 下标取首帧缩略图 URL(P4a 传 videoGeneration.thumbUrl 包装);不传则不显缩略图。 */
  thumbUrlOf?: (clipIndex: number) => string | null;
  /** 只渲染 video 轨(P4a 多轨时音频/字幕轨独立组件;默认 false 维持 P2/P3 三占位轨)。 */
  videoTrackOnly?: boolean;
```

在组件体把 `const PX_PER_SEC = 12;` 的使用处改为 `const pps = pxPerSec ?? 12;`,所有 `PX_PER_SEC` 替换为 `pps`(段宽/leftPx 计算)。

在 video clip 块(P3 的 `<div role="button" ...>`)上,若 `thumbUrlOf` 提供则加背景图:
```tsx
                style={{
                  left: s.leftPx, width: s.widthPx,
                  backgroundImage: thumbUrlOf?.(s.idx) ? `url(${thumbUrlOf(s.idx)})` : undefined,
                  backgroundSize: 'cover', backgroundPosition: 'center',
                }}
```
(把原 `style={{ left: s.leftPx, width: s.widthPx }}` 替换为上面;clip 内文字加 `drop-shadow`/半透明底确保缩略图上可读:给序号 span 包一层 `bg-black/40 text-white rounded px-1`。)

`videoTrackOnly` 为 true 时,只渲染视频轨那一段 `<div className={trackBase}>...</div>`,不渲染音频/字幕占位轨(用 `{!videoTrackOnly && (<>...音频轨...字幕轨...</>)}` 包裹原占位轨)。

- [ ] **Step 2: typecheck + 跑 P3 单测确认没破坏**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client
pnpm --filter @chayuan/app typecheck
pnpm exec vitest run packages/app/src/features/video-generation/timeline/timelineEdit.test.ts
```
Expected: typecheck 0 错误;timelineEdit 6 passed(算子未动)。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/VgTimeline.tsx
git commit -m "feat(client/vg): VgTimeline 支持外部 pxPerSec + clip 缩略图 + videoTrackOnly

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 13: TimelineTracks 装配(单滚动容器 + 轨道头列 + 播放头)

**Files:**
- Create: `packages/app/src/features/video-generation/timeline/TimelineTracks.tsx`

参考:TimeRuler / Playhead / VgTimeline(videoTrackOnly) / AudioWaveTrack / SubtitleCueTrack / BgmTrack / TrackHeader(TRACK_H) / timelineScale(msToPx, totalDurationMs)。

布局:左固定轨道头列(宽 64px,含 ruler 占位空白 + 4 个 TrackHeader)+ 右单横向滚动容器(内含 ruler 顶 + 4 轨 lane + Playhead,统一 `contentWidthPx`)。

- [ ] **Step 1: TimelineTracks.tsx**

```tsx
import * as React from 'react';
import { Film, Mic, Captions, Music } from 'lucide-react';
import type { VgTimeline } from '@chayuan/api';
import type { SrtCue } from './srtParse';
import { msToPx } from './timelineScale';
import { TimeRuler } from './TimeRuler';
import { Playhead } from './Playhead';
import { TrackHeader, TRACK_H } from './TrackHeader';
import { VgTimeline as VideoTrack } from './VgTimeline';
import { AudioWaveTrack } from './AudioWaveTrack';
import { SubtitleCueTrack } from './SubtitleCueTrack';
import { BgmTrack } from './BgmTrack';

const HEADER_W = 64;
const RULER_H = 24;

export const TimelineTracks: React.FC<{
  timeline: VgTimeline;
  durationMs: number;
  pxPerSec: number;
  playheadMs: number;
  peaks: number[];
  peaksLoading?: boolean;
  cues: SrtCue[];
  bgmName: string | null;
  thumbUrlOf?: (clipIndex: number) => string | null;
  onSeekMs: (ms: number) => void;
  onTimelineChange: (t: VgTimeline) => void;
}> = ({ timeline, durationMs, pxPerSec, playheadMs, peaks, peaksLoading, cues, bgmName, thumbUrlOf, onSeekMs, onTimelineChange }) => {
  const contentWidthPx = Math.max(240, msToPx(durationMs, pxPerSec));
  const lanesH = TRACK_H * 4;

  return (
    <div className="flex rounded-xl border border-[var(--cy-border-subtle)] bg-[var(--cy-surface-1)]">
      {/* 左:固定轨道头列 */}
      <div className="shrink-0 border-r border-[var(--cy-border-subtle)]" style={{ width: HEADER_W }}>
        <div style={{ height: RULER_H }} className="border-b border-[var(--cy-border-subtle)]" />
        <TrackHeader label="视频" icon={<Film className="h-3 w-3" />} />
        <TrackHeader label="旁白" icon={<Mic className="h-3 w-3" />} />
        <TrackHeader label="字幕" icon={<Captions className="h-3 w-3" />} />
        <TrackHeader label="音乐" icon={<Music className="h-3 w-3" />} />
      </div>
      {/* 右:单横向滚动容器(ruler + lanes + playhead 共享坐标系) */}
      <div className="relative flex-1 overflow-x-auto cy-hide-scrollbar">
        <div style={{ width: contentWidthPx }}>
          <TimeRuler durationMs={durationMs} pxPerSec={pxPerSec} contentWidthPx={contentWidthPx} onSeekMs={onSeekMs} />
          <div className="relative" style={{ height: lanesH }}>
            {/* 视频轨(可编辑 + 缩略图) */}
            <div style={{ height: TRACK_H }} className="border-b border-[var(--cy-border-subtle)]">
              <VideoTrack timeline={timeline} editable videoTrackOnly pxPerSec={pxPerSec}
                thumbUrlOf={thumbUrlOf} onChange={onTimelineChange} />
            </div>
            <AudioWaveTrack peaks={peaks} contentWidthPx={contentWidthPx} loading={peaksLoading} />
            <SubtitleCueTrack cues={cues} pxPerSec={pxPerSec} contentWidthPx={contentWidthPx} />
            <BgmTrack bgmName={bgmName} contentWidthPx={contentWidthPx} />
            {/* 播放头贯穿四轨 */}
            <Playhead playheadMs={playheadMs} pxPerSec={pxPerSec} heightPx={lanesH} durationMs={durationMs} onSeekMs={onSeekMs} />
          </div>
        </div>
      </div>
    </div>
  );
};
```
> VideoTrack(=P3 VgTimeline)在 `videoTrackOnly` 下自身高度可能与 TRACK_H 不完全一致;P3 组件视频轨块 `top-3 h-8`,放进 TRACK_H=44 的容器视觉 OK。如错位,在 Task 14 联调微调 VgTimeline 视频轨块定位(本 task 不强求像素级对齐)。

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/TimelineTracks.tsx
git commit -m "feat(client/vg): TimelineTracks 装配(单滚动容器+轨道头列+播放头贯穿四轨)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 14: VgTimelineEditorPage 重写(三区布局 + 草稿编排 + finalize)

**Files:**
- Create: `packages/app/src/features/video-generation/timeline/MediaPoolPanel.tsx`
- Modify(重写): `packages/app/src/features/video-generation/VgTimelineEditorPage.tsx`

参考(已有):`useVgComposer`(params/patchParams/timelineDraft/setDraft/patchDraft/scriptHashOf)、`MaterialsStep`、`buildTimelineFromMaterials`、`videoGeneration`(submitTask/getTask/finalizeDraft/fetchAudioPeaks/thumbUrl/taskFileUrl)、`useTabsStore`、`reportError`/`notifySuccess`、`useNavigate`。

- [ ] **Step 1: MediaPoolPanel.tsx(可折叠素材库)**

```tsx
import * as React from 'react';
import { ChevronLeft, ChevronRight, Library } from 'lucide-react';
import { MaterialsStep } from '../steps/MaterialsStep';

export const MediaPoolPanel: React.FC = () => {
  const [open, setOpen] = React.useState(true);
  return (
    <div className={`flex shrink-0 flex-col border-r border-[var(--cy-border-subtle)] transition-all ${open ? 'w-72' : 'w-9'}`}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-1 border-b border-[var(--cy-border-subtle)] px-2 text-xs text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]">
        {open ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Library className="h-3.5 w-3.5" /> {open && <span>素材库</span>}
      </button>
      {open && <div className="min-h-0 flex-1 overflow-y-auto cy-hide-scrollbar p-2"><MaterialsStep /></div>}
    </div>
  );
};
```

- [ ] **Step 2: 重写 VgTimelineEditorPage.tsx**

```tsx
import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Sparkles, Film, AlertTriangle, RefreshCw } from 'lucide-react';
import { videoGeneration, type VgTimeline } from '@chayuan/api';
import { useVgComposer, scriptHashOf } from './store/vgComposer';
import { MediaPoolPanel } from './timeline/MediaPoolPanel';
import { PreviewPlayer } from './timeline/PreviewPlayer';
import { TransportBar } from './timeline/TransportBar';
import { TimelineTracks } from './timeline/TimelineTracks';
import { buildTimelineFromMaterials } from './timeline/buildTimeline';
import { totalDurationMs, fitPxPerSec } from './timeline/timelineScale';
import { parseSrt, type SrtCue } from './timeline/srtParse';
import { reportError, notifySuccess } from '../../store/errorDialog';
import { useTabsStore } from '../../store/tabs';

const POLL_MS = 2500;

export const VgTimelineEditorPage: React.FC = () => {
  const navigate = useNavigate();
  const openTab = useTabsStore((s) => s.open);
  const params = useVgComposer((s) => s.params);
  const patchParams = useVgComposer((s) => s.patchParams);
  const draft = useVgComposer((s) => s.timelineDraft);
  const setDraft = useVgComposer((s) => s.setDraft);
  const patchDraft = useVgComposer((s) => s.patchDraft);

  const [pxPerSec, setPxPerSec] = React.useState(20);
  const [playheadMs, setPlayheadMs] = React.useState(0);
  const [seekMs, setSeekMs] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [proxyStale, setProxyStale] = React.useState(true);
  const [peaks, setPeaks] = React.useState<number[]>([]);
  const [cues, setCues] = React.useState<SrtCue[]>([]);

  const timeline = params.timeline ?? buildTimelineFromMaterials(params.video_materials ?? []);
  const curHash = scriptHashOf(params);

  // ── 草稿编排:进页面 / 脚本变 → 自动生成(stop_at=materials) ──
  React.useEffect(() => {
    const hasScript = (params.video_script || '').trim().length > 0;
    if (!hasScript) return;
    if (draft.state === 'generating') return;
    if (draft.state === 'ready' && draft.scriptHash === curHash) return; // 缓存命中
    let aborted = false;
    (async () => {
      patchDraft({ state: 'generating', scriptHash: curHash, error: undefined });
      try {
        const t = await videoGeneration.submitTask(params, { stop_at: 'materials' });
        if (aborted) return;
        patchDraft({ taskId: t.task_id });
      } catch (e) {
        if (!aborted) patchDraft({ state: 'failed', error: (e as Error).message });
      }
    })();
    return () => { aborted = true; };
    // 仅 curHash 变化触发(脚本/语音/bgm/语言/段落)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curHash]);

  // ── 轮询草稿 task 直到 complete ──
  useQuery({
    queryKey: ['vg.draft', draft.taskId],
    enabled: draft.state === 'generating' && !!draft.taskId,
    refetchInterval: POLL_MS,
    queryFn: async () => {
      const t = await videoGeneration.getTask(draft.taskId!);
      if (t.state === 'complete') {
        const res = t.result ?? {};
        const audioFull = String(res.audio_file ?? '');
        const subFull = String(res.subtitle_path ?? '');
        const mats = (res.materials as string[]) ?? [];
        patchDraft({
          state: 'ready',
          audioFileName: audioFull ? audioFull.split(/[\\/]/).pop()! : null,
          subtitleFileName: subFull ? subFull.split(/[\\/]/).pop()! : null,
          materials: mats.map((_m, i) => ({ idx: i, durationMs: 0 })),
        });
      } else if (t.state === 'failed' || t.state === 'canceled') {
        patchDraft({ state: 'failed', error: t.error ?? '草稿生成失败' });
      }
      return t;
    },
  });

  // ── 草稿 ready → 拉波形 + 字幕,并据已选素材初始化 timeline ──
  React.useEffect(() => {
    if (draft.state !== 'ready' || !draft.taskId) return;
    (async () => {
      try {
        const pk = await videoGeneration.fetchAudioPeaks(draft.taskId!, 600);
        setPeaks(pk.peaks);
        patchDraft({ audioDurationMs: pk.duration_ms });
      } catch { setPeaks([]); }
      if (draft.subtitleFileName) {
        try {
          const { blob } = await videoGeneration.downloadTaskFile(draft.taskId!, draft.subtitleFileName);
          setCues(parseSrt(await blob.text()));
        } catch { setCues([]); }
      }
      // 首次:若没手动编辑过 timeline,用已选素材初始化
      if (!params.timeline) patchParams({ timeline: buildTimelineFromMaterials(params.video_materials ?? []) });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.state, draft.taskId]);

  const durationMs = totalDurationMs(timeline, draft.audioDurationMs);

  // 容器宽变化时 fit 一次(初次)
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (containerRef.current && durationMs > 0) {
      setPxPerSec(fitPxPerSec(durationMs, containerRef.current.clientWidth - 80));
    }
    // 仅 durationMs 首次 >0 时 fit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs > 0]);

  const onTimelineChange = (t: VgTimeline) => { patchParams({ timeline: t }); setProxyStale(true); };
  const thumbUrlOf = (i: number) => (draft.taskId && draft.state === 'ready' ? videoGeneration.thumbUrl(draft.taskId, i, 0) : null);

  // ── 提交:finalize 草稿(复用 audio/subtitle,只 compose) ──
  const [submitting, setSubmitting] = React.useState(false);
  const onSubmit = async () => {
    if (draft.state !== 'ready' || !draft.taskId) { reportError(new Error('草稿尚未就绪,稍候再试')); return; }
    setSubmitting(true);
    try {
      await videoGeneration.finalizeDraft(draft.taskId, timeline);
      notifySuccess('已提交合成', '前往「我的视频」看进度');
      openTab('/video-generation/library', { title: '我的视频', icon: 'video' });
      void navigate({ to: '/video-generation/library' as never });
    } catch (e) { reportError(e as Error, '提交失败'); }
    finally { setSubmitting(false); }
  };

  const bgmName = params.bgm_type === 'random' ? '随机背景音乐' : (params.bgm_file || null);

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col">
      {/* 上半:素材库 + 预览 */}
      <div className="flex min-h-0 flex-1">
        <MediaPoolPanel />
        <div className="min-h-0 flex-1 p-3">
          <PreviewPlayer
            timeline={timeline} aspect={params.video_aspect}
            seekMs={seekMs} playing={playing} stale={proxyStale}
            onTimeMs={(ms) => setPlayheadMs(ms)}
            onPlayingChange={setPlaying}
            onFreshGenerated={() => setProxyStale(false)}
          />
        </div>
      </div>
      {/* transport */}
      <TransportBar playing={playing} currentMs={playheadMs} durationMs={durationMs} pxPerSec={pxPerSec}
        onPlayPause={() => setPlaying((v) => !v)} onZoom={setPxPerSec} />
      {/* 草稿状态条 */}
      {draft.state === 'generating' && (
        <div className="flex items-center gap-2 bg-[var(--cy-surface-1)] px-3 py-1.5 text-xs text-[var(--cy-text-secondary)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在预生成旁白 / 字幕 / 素材…
        </div>
      )}
      {draft.state === 'failed' && (
        <div className="flex items-center gap-2 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
          <AlertTriangle className="h-3.5 w-3.5" /> 草稿生成失败:{draft.error}
          <button type="button" onClick={() => useVgComposer.getState().resetDraft()}
            className="ml-2 inline-flex items-center gap-1 rounded border border-rose-300 px-2 py-0.5 hover:bg-rose-100">
            <RefreshCw className="h-3 w-3" /> 重试
          </button>
        </div>
      )}
      {/* 下半:全宽多轨时间轴 */}
      <div className="border-t border-[var(--cy-border-subtle)] bg-[var(--cy-surface-base)] p-3">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--cy-text-primary)]">
            <Film className="h-4 w-4" /> 时间轴
          </h2>
          <button type="button" onClick={() => void onSubmit()} disabled={submitting || draft.state !== 'ready'}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 text-xs font-medium text-white shadow disabled:opacity-50">
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} 提交合成
          </button>
        </div>
        <TimelineTracks
          timeline={timeline} durationMs={durationMs} pxPerSec={pxPerSec} playheadMs={playheadMs}
          peaks={peaks} peaksLoading={draft.state === 'generating'} cues={cues} bgmName={bgmName}
          thumbUrlOf={thumbUrlOf}
          onSeekMs={(ms) => { setSeekMs(ms); setPlayheadMs(ms); }}
          onTimelineChange={onTimelineChange}
        />
      </div>
    </div>
  );
};

export default VgTimelineEditorPage;
```
> `t.result` 依赖 Task 4 已给 `VgTask` 加的 `result?: Record<string, unknown> | null;`。`res.materials as string[]` 因 result 是 unknown-值字典,断言成 string[] 即可。

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 4: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/MediaPoolPanel.tsx chayuan-client/packages/app/src/features/video-generation/VgTimelineEditorPage.tsx
git commit -m "feat(client/vg): VgTimelineEditorPage 三区重写 + 草稿编排(stop_at=materials) + finalize 提交

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 15: 联调验证

- [ ] **Step 1: 全量 typecheck + 全部单测**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client
pnpm --filter @chayuan/app typecheck && pnpm --filter @chayuan/api typecheck
pnpm exec vitest run packages/app/src/features/video-generation/timeline
cd /work/chayuan-desktop/chayuan-server
PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_media_probe.py libs/chayuan-server/tests/unit_tests/test_vg_finalize.py
```
Expected: typecheck 0 错误;前端 timeline 单测(timelineEdit 6 + timelineScale + srtParse)全 PASS;后端 8 passed。

- [ ] **Step 2: 手动验收清单(重建前端 + 重启 sidecar 后)**

- 从对话/批量带脚本进时间轴编辑器 → 自动显"正在预生成…" → 完成后:视频轨出现 clip(带首帧缩略图)、旁白轨出现波形、字幕轨出现 cue 块、音乐轨显 BGM。
- 时间轴**全宽**、可横向滚动;zoom 滑块 / [-][+] 改 px/秒,标尺 + 四轨 + 播放头同步缩放。
- 点标尺 / 拖播放头 → 播放头移动;点「生成预览」后,播放器播放,播放头随播放走;拖播放头 seek 视频。
- V 轨 P3 编辑(选中/左右移/删除/裁 in/拖时长)仍可用;改动后预览显"重新生成预览"。
- 「提交合成」→ 走 finalize(复用草稿 audio/subtitle,不重跑 TTS)→「我的视频」出片,画幅/字幕/旁白与编辑一致。
- 改脚本(回上一步重新生成脚本)再进编辑器 → 草稿按 scriptHash 重新生成;仅改画幅/排列**不**触发重生成。

- [ ] **Step 3: 最终推送(若联调有微调)**

```bash
cd /work/chayuan-desktop
git add -A && git commit -m "fix(vg): P4a 联调微调" && git push origin main
```

---

## Self-Review

**Spec coverage(对照 design 各节):**
- ① 草稿模型(stop_at=materials + finalize + scriptHash 缓存)→ Task 2(finalize)、Task 7(scriptHash/draft state)、Task 14(编排 + 轮询 + 缓存命中)。✓
- ② 后端 3 接口(finalize / audio-peaks / thumb)→ Task 3。底层工具 Task 1(peaks/thumb)、Task 2(finalize 逻辑)。✓
- ③ 三区布局 + 时间轴拆组件 → Task 8(ruler/playhead)、9(transport)、10(preview)、11(只读轨)、12(视频轨缩略图)、13(装配)、14(页面 + 素材库面板)。zoom/全宽/轨道头/播放头齐备。✓
- ④ 预览联动(proxy + 播放头双向)→ Task 10(PreviewPlayer 受控 seek/onTime)+ Task 14(seekMs/playheadMs 状态)。✓
- ⑤ 错误处理(草稿失败重试 / 接口降级 / finalize 失败 / 无脚本)→ Task 14(状态条 + 重试 + 空态)、Task 11(轨道占位)、Task 1(extract 失败返 0/空)。✓
- ⑥ 测试 → Task 1/2(pytest)、5/6(vitest 纯函数)、15(全量)。✓

**Placeholder scan:** 无 TBD/“类似 Task N”;各步给完整代码。少量"按现有 import 风格补"是真实适配点(import 行因文件而异),非占位。

**Type consistency:** `VgTimelineDraft`(Task7)字段被 Task14 读写一致;`scriptHashOf`(Task7)Task14 用;`vgFinalizeDraft/fetchAudioPeaks/thumbUrl`(Task4)Task14 调一致;`media_probe.cached_peaks/extract_thumbnail`(Task1)Task3 调一致;`enqueue_finalize/_run_finalize/finalize_task`(Task2)Task3 调一致;`TimelineTracks` props(Task13)与 Task14 传参一致;`VgTimeline` 新 props `pxPerSec/thumbUrlOf/videoTrackOnly`(Task12)Task13 用一致。

**依赖顺序:** 后端 1→2→3;客户端类型 4;前端纯工具 5/6;store 7;组件 8→9→10→11→12→13;页面 14;联调 15。无循环依赖。Task14 依赖 4 的 `VgTask.result` 字段建议(给 VgTask 加 `result?`)—— 在 Task 4 落实更干净。
