# 时间轴编辑器 P1(EDL 模型 + 后端 EDL 渲染)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 runner 能按用户给的 EDL(Timeline)精确渲染视频(裁剪/排序/叠音轨/烧字幕),`timeline` 缺省时零回归走现有自动路径。

**Architecture:** 新增 Pydantic `Timeline` 模型挂到 `VideoParams.timeline`(可选)。渲染拆成纯函数 `_build_edl_render_plan`(把 EDL 解析成有序 clip 计划,可单测)+ `render_from_edl`(用 moviepy/ffmpeg 执行计划,复用现有 `SubClippedVideoClip`/`concat_video_clips_with_ffmpeg`/`generate_video`)。runner 按 `params.timeline` 是否存在分流。前端加对应 TS 类型。

**Tech Stack:** Python / Pydantic v2 / moviepy / ffmpeg / pytest;TypeScript。

**Spec:** `docs/superpowers/specs/2026-05-29-vg-timeline-editor-design.md`(仅 P1)

**收尾:** monorepo `/work/chayuan-desktop`,commit 进 `main`,每个 task 完成后 `git push origin main`。

---

## File Structure

- `libs/chayuan-server/chayuan/server/video_generation/schemas.py` — 加 `TimelineClip`/`TimelineTrack`/`Timeline` + `VideoParams.timeline`。
- `libs/chayuan-server/chayuan/server/video_generation/steps/compose.py` — 加 `_build_edl_render_plan`(纯)+ `render_from_edl`(执行)。
- `libs/chayuan-server/chayuan/server/video_generation/runner.py` — 渲染段按 `timeline` 分流。
- `libs/chayuan-server/tests/unit_tests/test_vg_timeline.py` — schema + edl_render_plan + backward_compat 单测。
- `chayuan-client/packages/api/src/videoGeneration.ts` — `VgTimeline*` 类型 + `VgVideoParams.timeline`。

---

## Task 1: EDL Schema(后端)

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/video_generation/schemas.py`
- Test: `libs/chayuan-server/tests/unit_tests/test_vg_timeline.py`

- [ ] **Step 1: Write the failing test**

Create `libs/chayuan-server/tests/unit_tests/test_vg_timeline.py`:

```python
from chayuan.server.video_generation.schemas import (
    Timeline, TimelineTrack, TimelineClip, VideoParams,
)


def test_timeline_clip_defaults():
    c = TimelineClip(id="c1", source={"path": "/tmp/a.mp4"}, track_start_ms=0, out_ms=5000)
    assert c.in_ms == 0
    assert c.out_ms == 5000
    assert c.transition == "none"


def test_timeline_parse_full():
    tl = Timeline(
        duration_ms=8000,
        tracks=[
            TimelineTrack(id="v", kind="video", clips=[
                TimelineClip(id="c1", source={"material_id": "m1"}, track_start_ms=0, in_ms=0, out_ms=3000),
                TimelineClip(id="c2", source={"path": "/x/b.mp4"}, track_start_ms=3000, in_ms=1000, out_ms=6000),
            ]),
        ],
    )
    assert tl.tracks[0].kind == "video"
    assert len(tl.tracks[0].clips) == 2
    assert tl.tracks[0].clips[1].in_ms == 1000


def test_videoparams_timeline_optional():
    p = VideoParams(video_subject="x")
    assert p.timeline is None  # 缺省不破现有 VideoParams
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH=libs/chayuan-server pytest libs/chayuan-server/tests/unit_tests/test_vg_timeline.py -v`
Expected: FAIL — `ImportError: cannot import name 'Timeline'`

- [ ] **Step 3: Add models to `schemas.py`**

在 `schemas.py` 顶部确认已 `from typing import Dict, List, Optional, Union` 与 `from pydantic import BaseModel, Field`(缺则补 Dict)。在 `VideoParams` 定义**之前**加:

```python
class TimelineClip(BaseModel):
    """时间轴上的一段素材引用(EDL clip)。"""
    id: str
    # source 三选一:material_id(库)/ path(本地)/ url(在线),按此优先级解析
    source: Dict[str, str] = Field(default_factory=dict)
    track_start_ms: int = Field(default=0, ge=0)   # 在轨道上的起点
    in_ms: int = Field(default=0, ge=0)             # 源素材裁剪入点
    out_ms: int = Field(default=0, ge=0)            # 源素材裁剪出点(0 表示到素材末尾)
    transition: str = "none"                        # none/fade/slide(P4)
    volume: float = 1.0                             # 音频轨用


class TimelineTrack(BaseModel):
    id: str
    kind: str = "video"                             # video / audio / subtitle
    clips: List[TimelineClip] = Field(default_factory=list)
    cues: List[SrtCue] = Field(default_factory=list)  # subtitle 轨复用 SrtCue


class Timeline(BaseModel):
    """用户编辑的剪辑决策表(EDL)。runner 有它就精确照渲,否则走自动路径。"""
    version: int = 1
    duration_ms: int = Field(default=0, ge=0)
    tracks: List[TimelineTrack] = Field(default_factory=list)
```

`SrtCue` 已在本文件定义(在 `VideoParams` 之前),`TimelineTrack` 引用它需保证 `SrtCue` 定义在前;若顺序冲突,把上面三个类放在 `SrtCue` 之后、`VideoParams` 之前。

在 `VideoParams` 里(紧跟 `model: Optional[str] = None` 之后)加:

```python
    # 时间轴编辑器(EDL);非空时 runner 按它精确渲染,空则自动拟合(向后兼容)。
    timeline: Optional[Timeline] = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH=libs/chayuan-server pytest libs/chayuan-server/tests/unit_tests/test_vg_timeline.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/schemas.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_timeline.py
git commit -m "feat(server/vg): EDL Timeline schema + VideoParams.timeline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 2: `_build_edl_render_plan` 纯函数(可单测的编排逻辑)

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/video_generation/steps/compose.py`
- Test: `libs/chayuan-server/tests/unit_tests/test_vg_timeline.py`(追加)

- [ ] **Step 1: Write the failing test**

在 `test_vg_timeline.py` 追加:

```python
from chayuan.server.video_generation.steps.compose import _build_edl_render_plan
from chayuan.server.video_generation.schemas import VideoAspect


def _src_resolver(source):
    # 测试用解析器:material_id -> 假路径;path 直通
    if source.get("material_id"):
        return f"/lib/{source['material_id']}.mp4"
    return source.get("path") or source.get("url") or ""


def test_edl_render_plan_order_and_subclip():
    tl = Timeline(tracks=[TimelineTrack(id="v", kind="video", clips=[
        TimelineClip(id="c2", source={"path": "/x/b.mp4"}, track_start_ms=3000, in_ms=1000, out_ms=4000),
        TimelineClip(id="c1", source={"material_id": "m1"}, track_start_ms=0, in_ms=0, out_ms=3000),
    ])])
    plan = _build_edl_render_plan(tl, VideoAspect.portrait, source_resolver=_src_resolver)
    # 按 track_start_ms 排序:c1 在前
    assert [p["clip_id"] for p in plan] == ["c1", "c2"]
    assert plan[0]["path"] == "/lib/m1.mp4"
    assert plan[0]["start_s"] == 0.0 and plan[0]["end_s"] == 3.0
    assert plan[1]["path"] == "/x/b.mp4"
    assert plan[1]["start_s"] == 1.0 and plan[1]["end_s"] == 4.0
    # 目标分辨率 = 竖屏 1080x1920
    assert plan[0]["target_w"] == 1080 and plan[0]["target_h"] == 1920


def test_edl_render_plan_skips_empty_source_and_zero_out():
    tl = Timeline(tracks=[TimelineTrack(id="v", kind="video", clips=[
        TimelineClip(id="bad", source={}, track_start_ms=0, out_ms=3000),
        TimelineClip(id="ok", source={"path": "/x/c.mp4"}, track_start_ms=0, in_ms=0, out_ms=0),
    ])])
    plan = _build_edl_render_plan(tl, VideoAspect.portrait, source_resolver=_src_resolver)
    # 空 source 跳过;out_ms=0 表示到末尾 -> end_s=None
    assert [p["clip_id"] for p in plan] == ["ok"]
    assert plan[0]["end_s"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH=libs/chayuan-server pytest libs/chayuan-server/tests/unit_tests/test_vg_timeline.py::test_edl_render_plan_order_and_subclip -v`
Expected: FAIL — `ImportError: cannot import name '_build_edl_render_plan'`

- [ ] **Step 3: Add `_build_edl_render_plan` to `compose.py`**

在 `compose.py` 的 `combine_videos` 定义**之前**加(纯逻辑,不碰 moviepy):

```python
def _build_edl_render_plan(timeline, video_aspect, *, source_resolver):
    """把 EDL 的 video 轨解析成有序渲染计划(纯函数,便于单测)。

    返回 list[dict]:{clip_id, path, start_s, end_s(None=到末尾), target_w, target_h}。
    - 取第一条 kind=='video' 的轨(P1 单视频轨)。
    - 按 track_start_ms 升序。
    - source 经 source_resolver(material_id/path/url -> 本地路径);解析空则跳过。
    - in_ms/out_ms -> 秒;out_ms==0 视为"到素材末尾"(end_s=None)。
    """
    aspect = VideoAspect(video_aspect)
    target_w, target_h = aspect.to_resolution()
    video_tracks = [t for t in (timeline.tracks or []) if t.kind == "video"]
    if not video_tracks:
        return []
    clips = sorted(video_tracks[0].clips, key=lambda c: c.track_start_ms)
    plan = []
    for c in clips:
        path = (source_resolver(c.source) or "").strip()
        if not path:
            logger.warning("[edl] clip %s source 解析为空,跳过: %r", c.id, c.source)
            continue
        plan.append({
            "clip_id": c.id,
            "path": path,
            "start_s": max(0.0, c.in_ms / 1000.0),
            "end_s": (c.out_ms / 1000.0) if c.out_ms and c.out_ms > c.in_ms else None,
            "target_w": target_w,
            "target_h": target_h,
        })
    return plan
```

确认 `compose.py` 顶部已 import `VideoAspect`(它已用于 `combine_videos`,无需新增)。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH=libs/chayuan-server pytest libs/chayuan-server/tests/unit_tests/test_vg_timeline.py -v`
Expected: PASS (5 passed:含 Task1 的 3 个)

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/compose.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_timeline.py
git commit -m "feat(server/vg): _build_edl_render_plan 纯函数(EDL->有序渲染计划)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 3: `render_from_edl` 执行(moviepy 裁剪 + ffmpeg 拼接 + 音轨/字幕)

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/video_generation/steps/compose.py`

- [ ] **Step 1: 实现 `render_from_edl`(在 `_build_edl_render_plan` 之后)**

复用现有 `SubClippedVideoClip` / `_open_video_clip_quietly` / `concat_video_clips_with_ffmpeg` / `generate_video` / `close_clip`。逐 clip 裁剪+缩放到目标分辨率写临时文件 → ffmpeg concat → `generate_video` 叠音频+字幕。时长错配=截到音频长、不足末段定格(用 `freeze` 末段补时长)。

```python
def render_from_edl(
    timeline,
    audio_file: str,
    subtitle_path: str,
    output_file: str,
    params,
    *,
    source_resolver,
    threads: int = 2,
) -> str:
    """按 EDL 渲染:裁剪每段 -> 规整到画幅 -> ffmpeg concat -> 叠音频+字幕。

    时长策略:视频总长 > 音频 -> generate_video 用音频长截断(沿用现有行为);
    < 音频 -> 末段定格补足到音频长。
    """
    from moviepy import AudioFileClip  # 与文件内其它 moviepy import 保持一致

    aspect = VideoAspect(params.video_aspect)
    video_width, video_height = aspect.to_resolution()
    output_dir = os.path.dirname(output_file)

    plan = _build_edl_render_plan(timeline, params.video_aspect, source_resolver=source_resolver)
    if not plan:
        raise RuntimeError("EDL 没有可渲染的视频片段(video 轨为空或素材解析失败)")

    # 音频时长(决定末段是否需要定格补足)
    audio_clip = AudioFileClip(audio_file)
    try:
        audio_duration = audio_clip.duration
    finally:
        close_clip(audio_clip)

    clip_files: list[str] = []
    total = 0.0
    for i, p in enumerate(plan):
        clip = _open_video_clip_quietly(p["path"])
        try:
            src_dur = clip.duration
            start_s = min(p["start_s"], max(0.0, src_dur - 0.1))
            end_s = p["end_s"] if p["end_s"] is not None else src_dur
            end_s = min(end_s, src_dur)
            if end_s <= start_s:
                end_s = min(start_s + 1.0, src_dur)
            seg = clip.subclipped(start_s, end_s) if hasattr(clip, "subclipped") else clip.subclip(start_s, end_s)
            seg = seg.resized((video_width, video_height)) if hasattr(seg, "resized") else seg.resize((video_width, video_height))
            seg_path = os.path.join(output_dir, f"edl-seg-{i}.mp4")
            seg.write_videofile(seg_path, fps=30, threads=threads, logger=None)
            clip_files.append(seg_path)
            total += (end_s - start_s)
        finally:
            close_clip(clip)

    # 末段定格补足:总时长 < 音频时,把最后一段再追加定格补差
    if clip_files and total < audio_duration - 0.2:
        last = _open_video_clip_quietly(clip_files[-1])
        try:
            freeze_dur = audio_duration - total
            frame = last.to_ImageClip(t=max(0.0, last.duration - 0.05)).with_duration(freeze_dur) \
                if hasattr(last, "with_duration") else last.to_ImageClip(t=max(0.0, last.duration - 0.05)).set_duration(freeze_dur)
            frame = frame.resized((video_width, video_height)) if hasattr(frame, "resized") else frame.resize((video_width, video_height))
            freeze_path = os.path.join(output_dir, "edl-freeze.mp4")
            frame.write_videofile(freeze_path, fps=30, threads=threads, logger=None)
            clip_files.append(freeze_path)
        finally:
            close_clip(last)

    combined_path = os.path.join(output_dir, "edl-combined.mp4")
    concat_video_clips_with_ffmpeg(clip_files, combined_path, threads=threads, output_dir=output_dir)
    generate_video(
        video_path=combined_path,
        audio_path=audio_file,
        subtitle_path=subtitle_path,
        output_file=output_file,
        params=params,
    )
    return output_file
```

> 注:moviepy 2.x 用 `subclipped`/`resized`/`with_duration`,1.x 用 `subclip`/`resize`/`set_duration` —— 上面用 `hasattr` 兼容两版,照抄文件内既有 moviepy 用法(参考 `combine_videos`/`generate_video` 实际调用的方法名,以仓库实际版本为准,统一成那一套即可)。

- [ ] **Step 2: 编译校验**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && PYTHONPATH=. python -m py_compile chayuan/server/video_generation/steps/compose.py`
Expected: 无输出

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/compose.py
git commit -m "feat(server/vg): render_from_edl — 按 EDL 裁剪/拼接/叠音轨/烧字幕

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 4: runner 分流(有 timeline 走 EDL,否则零回归走自动)

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/video_generation/runner.py`
- Test: `libs/chayuan-server/tests/unit_tests/test_vg_timeline.py`(追加)

- [ ] **Step 1: Write the failing test(向后兼容守卫)**

在 `test_vg_timeline.py` 追加(用一个轻量探针验证:timeline=None 时 runner 选择"自动路径"分支)。runner 的渲染分流抽成一个纯判定函数便于测:

```python
from chayuan.server.video_generation.runner import _use_edl


def test_use_edl_branch():
    assert _use_edl(VideoParams(video_subject="x")) is False  # 无 timeline -> 自动路径
    tl = Timeline(tracks=[TimelineTrack(id="v", kind="video", clips=[
        TimelineClip(id="c1", source={"path": "/a.mp4"}, track_start_ms=0, out_ms=3000),
    ])])
    assert _use_edl(VideoParams(video_subject="x", timeline=tl)) is True
    # 有 timeline 但 video 轨无 clip -> 仍走自动路径(不可渲染)
    empty = Timeline(tracks=[TimelineTrack(id="v", kind="video", clips=[])])
    assert _use_edl(VideoParams(video_subject="x", timeline=empty)) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH=libs/chayuan-server pytest libs/chayuan-server/tests/unit_tests/test_vg_timeline.py::test_use_edl_branch -v`
Expected: FAIL — `ImportError: cannot import name '_use_edl'`

- [ ] **Step 3: 加 `_use_edl` + 渲染段分流**

在 `runner.py` 加判定函数(放在 `_resolve_materials` 附近):

```python
def _use_edl(params) -> bool:
    """有 timeline 且至少一条 video 轨有 clip 才走 EDL 渲染;否则走自动路径。"""
    tl = getattr(params, "timeline", None)
    if tl is None:
        return False
    for t in (tl.tracks or []):
        if t.kind == "video" and t.clips:
            return True
    return False
```

在渲染段(`_compose_videos` 调用处 / section 6)分流。找到调用 `combine_videos` + `generate_video`(或现有 `_compose_videos` 辅助)的位置,改为:

```python
        if _use_edl(params):
            from .steps import compose as compose_step
            from .store import materials as materials_store

            def _resolve(source: dict) -> str:
                mid = source.get("material_id")
                if mid:
                    row = materials_store.get_material(mid)
                    return (row or {}).get("path") or ""
                return source.get("path") or source.get("url") or ""

            final_path = os.path.join(task_dir(task_id), "final-0.mp4")
            compose_step.render_from_edl(
                params.timeline, audio_file, subtitle_path, final_path, params,
                source_resolver=_resolve, threads=max(1, int(params.n_threads)),
            )
            finals = [final_path]
        else:
            finals, _ = _compose_videos(...)  # 现有自动路径,原样不动
```

> 实现时:① 不改自动路径的任何现有代码,只在外面包 `if/else`;② `task_dir` / `materials_store.get_material` 的真实签名以仓库为准(get_material 可能需 owner_id,从 task 倒查或传 None — 参考 `_persist_online_materials` 的 owner 取法);③ 在线 url 源在 EDL 渲染前若是 http(s),先 `materials_step.save_video` 下载成本地路径再 resolve(可在 `_resolve` 里处理)。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH=libs/chayuan-server pytest libs/chayuan-server/tests/unit_tests/test_vg_timeline.py -v`
Expected: PASS(全部:3+2+1=6)
并 `PYTHONPATH=. python -m py_compile chayuan/server/video_generation/runner.py`(无输出)。

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/runner.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_timeline.py
git commit -m "feat(server/vg): runner 按 timeline 分流 EDL 渲染(无则零回归自动路径)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 5: 前端 TS 类型(P2 UI 用,P1 先把类型与提交字段打通)

**Files:**
- Modify: `chayuan-client/packages/api/src/videoGeneration.ts`

- [ ] **Step 1: 加类型 + VgVideoParams.timeline**

在 `VgMaterialInfo` 附近加:

```typescript
export interface VgTimelineClip {
  id: string;
  source: { material_id?: string; path?: string; url?: string };
  track_start_ms: number;
  in_ms?: number;
  out_ms?: number;            // 0 = 到素材末尾
  transition?: 'none' | 'fade' | 'slide';
  volume?: number;
}
export interface VgTimelineTrack {
  id: string;
  kind: 'video' | 'audio' | 'subtitle';
  clips?: VgTimelineClip[];
  cues?: VgSrtCue[];
}
export interface VgTimeline {
  version?: number;
  duration_ms?: number;
  tracks: VgTimelineTrack[];
}
```

在 `VgVideoParams` 里(`model?: string | null;` 之后)加:

```typescript
  /** 时间轴 EDL;非空时后端按它精确渲染(P1 后端已支持)。 */
  timeline?: VgTimeline | null;
```

`VgSrtCue` 已存在于本文件;若名称不同(如 `VgSrtCueItem`),用实际名。`VG_DEFAULT_PARAMS` 加 `timeline: null,`。

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/api typecheck`
Expected: 无错误

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/api/src/videoGeneration.ts
git commit -m "feat(client/api): VgTimeline 类型 + VgVideoParams.timeline(P1 打通提交字段)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Self-Review

**Spec coverage(对 design §4 P1):**
- §4.1 schema(Timeline + VideoParams.timeline)→ Task 1 ✓;前端类型 → Task 5 ✓
- §4.2 EDL 渲染(裁剪/拼接/音轨/字幕 + 时长错配)→ Task 2(编排纯函数)+ Task 3(执行)✓
- §4.2 runner 分流 + 零回归 → Task 4 ✓
- §4.3 单测(schema/edl_render_plan/backward_compat)→ Task 1/2/4 各覆盖 ✓

**Placeholder scan:** 无 TBD/TODO;每步给完整代码。Task 3/4 的 moviepy 方法名 + get_material 签名标注"以仓库实际为准"是真实适配点(已给 hasattr 兼容 + 参考既有用法),非占位。

**Type consistency:** `Timeline/TimelineTrack/TimelineClip` 字段(source/track_start_ms/in_ms/out_ms)在 Task1 定义,Task2 `_build_edl_render_plan` 与 Task4 `_use_edl` 引用一致;`render_from_edl(timeline, audio_file, subtitle_path, output_file, params, *, source_resolver, threads)` 签名在 Task3 定义、Task4 调用一致;前端 `VgTimeline*`(Task5)字段与后端 snake_case 对应。

**依赖顺序:** Task1(schema)→ Task2(纯函数)→ Task3(执行)→ Task4(runner 接线)→ Task5(前端类型)。无循环依赖;P1 不含 UI(P2)。
