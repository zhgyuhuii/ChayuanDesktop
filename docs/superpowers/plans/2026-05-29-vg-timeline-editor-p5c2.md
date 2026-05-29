# 时间轴编辑器 P5c-2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给时间轴编辑器加入轨道管理(动态加/删视频·音频轨、整条选中)与多视频层画中画 PIP(第 2+ 视频轨 clip 在预览区拖拽移动/缩放、compose 分层渲染)。

**Architecture:** EDL `TimelineClip` 加 `x/y/scale/z`(0-1 归一),`TimelineTrack` 加 `removable`。前端 `TimelineTracks` 改为按 `timeline.tracks` 动态渲染多视频/音频 lane(旁白/音乐/字幕仍派生单例);预览区叠 `PipOverlay` 浮层框拖拽改 transform;后端 `render_from_edl`/`render_proxy_from_timeline` 用 `_build_pip_layers` + `CompositeVideoClip` 把第 2+ 视频轨按 z 叠在主轨之上。

**Tech Stack:** Python 3.12 / FastAPI / moviepy 2.x(`CompositeVideoClip`/`with_position` 已用);TS / React 19 / Zustand;vitest + pytest(compose 测试 stub moviepy,见 test_vg_p5a_render.py)。

**前置:** P1-P5c-1 已落地。

**收尾:** monorepo `/work/chayuan-desktop`,commit 进 `main`,每 task `git push origin main`。

---

## File Structure

后端(`libs/chayuan-server/chayuan/server/video_generation/`):
- `schemas.py`(改)— TimelineClip +x/y/scale/z;TimelineTrack +removable/label。
- `steps/compose.py`(改)— `_build_pip_layers` 纯函数;render_from_edl/render_proxy_from_timeline 合 PIP。
- `tests/unit_tests/test_vg_p5c2_pip.py`(新)。

API:`packages/api/src/videoGeneration.ts`(改)— VgTimelineClip +x/y/scale/z;VgTimelineTrack +removable/label。

前端:
- `timeline/timelineTracks.ts`(新)— addTrack/removeTrack/setClipTransform(+`.test.ts`)。
- `timeline/TimelineTracks.tsx`(改)— 动态多 video/audio lane + 选中 + trackId 透传。
- `timeline/TrackContextMenu.tsx`(改)— 加轨/删轨项。
- `timeline/PipOverlay.tsx`(新)— 预览浮层拖拽缩放。
- `timeline/PreviewPlayer.tsx`(改)— 容器内叠 PipOverlay slot。
- `VgTimelineEditorPage.tsx`(改)— 接线(加/删轨/transform/选中/overlay)。

---

## Task 1: EDL schema 扩展(后端 + API 类型)

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/video_generation/schemas.py`
- Modify: `packages/api/src/videoGeneration.ts`
- Test: `libs/chayuan-server/tests/unit_tests/test_vg_p5c2_pip.py`(建文件 + schema 用例)

- [ ] **Step 1: 写失败测试(schema 接受新字段)**

`test_vg_p5c2_pip.py`:
```python
import sys, types
try:  # pragma: no cover
    import moviepy  # noqa: F401
except ModuleNotFoundError:  # pragma: no cover
    _mp = types.ModuleType("moviepy"); _mp.__getattr__ = lambda _n: object
    sys.modules["moviepy"] = _mp
    _sub = types.ModuleType("moviepy.video.tools.subtitles"); _sub.SubtitlesClip = object
    sys.modules["moviepy.video"] = types.ModuleType("moviepy.video")
    sys.modules["moviepy.video.tools"] = types.ModuleType("moviepy.video.tools")
    sys.modules["moviepy.video.tools.subtitles"] = _sub

from chayuan.server.video_generation.schemas import Timeline


def test_clip_accepts_pip_fields_and_track_removable():
    tl = Timeline.model_validate({
        "version": 1, "tracks": [
            {"id": "v", "kind": "video", "clips": [{"id": "a", "source": {"path": "/a.mp4"}, "track_start_ms": 0}]},
            {"id": "v2", "kind": "video", "removable": True, "clips": [
                {"id": "p", "source": {"path": "/p.mp4"}, "track_start_ms": 0, "x": 0.6, "y": 0.05, "scale": 0.35, "z": 2},
            ]},
        ],
    })
    pip = tl.tracks[1].clips[0]
    assert (pip.x, pip.y, pip.scale, pip.z) == (0.6, 0.05, 0.35, 2)
    assert tl.tracks[1].removable is True
    assert tl.tracks[0].removable is False  # 默认不可删
```

- [ ] **Step 2: 跑 → FAIL**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_p5c2_pip.py`
Expected: FAIL(字段不存在 / 默认 removable 缺)。

- [ ] **Step 3: 改 schema**

`TimelineClip` 加(在 `volume` 后):
```python
    # 画中画(P5c-2):0-1 归一坐标/缩放 + 层级。主轨 clip 不填 = 铺满底层。
    x: float = 0.0
    y: float = 0.0
    scale: float = 1.0
    z: int = 0
```
`TimelineTrack` 加(在 `cues` 后):
```python
    removable: bool = False    # 用户添加的轨可删;默认轨 False
    label: str = ""
```

- [ ] **Step 4: 跑 → PASS**

Run: 同 Step 2。Expected: 1 passed。

- [ ] **Step 5: API 类型同步**

`packages/api/src/videoGeneration.ts`:`VgTimelineClip` 加 `x?: number; y?: number; scale?: number; z?: number;`;`VgTimelineTrack` 加 `removable?: boolean; label?: string;`。
Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/api typecheck`(0 错误)。

- [ ] **Step 6: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/schemas.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_p5c2_pip.py chayuan-client/packages/api/src/videoGeneration.ts
git commit -m "feat(vg): EDL clip 加 x/y/scale/z + track removable/label(PIP 数据模型)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 2: 后端 _build_pip_layers + compose 分层渲染

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/video_generation/steps/compose.py`
- Test: `libs/chayuan-server/tests/unit_tests/test_vg_p5c2_pip.py`(补)

参考(已有):`_build_edl_render_plan`(取 `video_tracks[0]`);`render_from_edl`(line 406,主轨 concat → `combined_path` → `generate_video`);`render_proxy_from_timeline`(主轨 concat → out);`CompositeVideoClip`/`ImageClip`/`VideoFileClip`/`with_position` 已 import;`fps`/`video_codec`。

- [ ] **Step 1: 补失败测试(_build_pip_layers)**

在 `test_vg_p5c2_pip.py` 加:
```python
from chayuan.server.video_generation.steps.compose import _build_pip_layers


def _tl_pip(pip_clips):
    tracks = [{"id": "v", "kind": "video", "clips": [{"id": "base", "source": {"path": "/base.mp4"}, "track_start_ms": 0}]}]
    tracks.append({"id": "v2", "kind": "video", "removable": True, "clips": pip_clips})
    return Timeline.model_validate({"version": 1, "tracks": tracks})


def test_build_pip_layers_takes_extra_video_tracks_sorted_by_z():
    tl = _tl_pip([
        {"id": "p1", "source": {"path": "/p1.png"}, "track_start_ms": 1000, "out_ms": 3000, "x": 0.6, "y": 0.1, "scale": 0.3, "z": 5},
        {"id": "p2", "source": {"path": "/p2.mp4"}, "track_start_ms": 0, "out_ms": 0, "x": 0.0, "y": 0.0, "scale": 0.4, "z": 1},
    ])
    layers = _build_pip_layers(tl, source_resolver=lambda s: s.get("path", ""))
    # 按 z 升序(底先合):p2(z1) 在前,p1(z5) 在后
    assert [ly["path"] for ly in layers] == ["/p2.mp4", "/p1.png"]
    p1 = layers[1]
    assert (p1["x"], p1["y"], p1["scale"]) == (0.6, 0.1, 0.3)
    assert p1["is_image"] is True
    assert p1["start_s"] == 1.0 and p1["dur"] == 3.0


def test_build_pip_layers_ignores_main_track_and_unresolved():
    tl = _tl_pip([{"id": "p", "source": {"material_id": "gone"}, "track_start_ms": 0}])
    assert _build_pip_layers(tl, source_resolver=lambda _s: "") == []  # 解析空跳过
    # 只有主轨时无 PIP
    only_main = Timeline.model_validate({"version": 1, "tracks": [{"id": "v", "kind": "video", "clips": [{"id": "b", "source": {"path": "/b.mp4"}, "track_start_ms": 0}]}]})
    assert _build_pip_layers(only_main, source_resolver=lambda s: s.get("path", "")) == []
```

- [ ] **Step 2: 跑 → FAIL**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_p5c2_pip.py`
Expected: FAIL(`_build_pip_layers` 不存在)。

- [ ] **Step 3: 实现 `_build_pip_layers`**

在 compose.py(`_build_edl_render_plan` 附近)加:
```python
def _build_pip_layers(timeline, *, source_resolver) -> list:
    """第 2+ 条 video 轨的 clips → PIP 层 [{path,x,y,scale,z,start_s,dur,is_image}],按 z 升序。"""
    video_tracks = [t for t in (timeline.tracks or []) if t.kind == "video"]
    layers: list = []
    for tr in video_tracks[1:]:  # 跳过主轨
        for c in tr.clips:
            path = (source_resolver(c.source) or "").strip()
            if not path:
                logger.warning("[pip] clip %s 解析为空,跳过: %r", c.id, c.source)
                continue
            is_image = path.lower().rsplit(".", 1)[-1] in ("jpg", "jpeg", "png", "webp", "bmp", "gif")
            dur = (c.out_ms / 1000.0) if (c.out_ms and c.out_ms > 0) else (3.0 if is_image else None)
            layers.append({
                "path": path,
                "x": float(getattr(c, "x", 0.0) or 0.0),
                "y": float(getattr(c, "y", 0.0) or 0.0),
                "scale": float(getattr(c, "scale", 0.4) or 0.4),
                "z": int(getattr(c, "z", 0) or 0),
                "start_s": max(0.0, c.track_start_ms / 1000.0),
                "dur": dur,
                "is_image": is_image,
            })
    layers.sort(key=lambda ly: ly["z"])
    return layers
```

- [ ] **Step 4: 跑 → PASS**

Run: 同 Step 2。Expected: 全 passed(schema 1 + pip 2)。

- [ ] **Step 5: render_from_edl 合 PIP**

在 `render_from_edl` 拼好主轨 `combined_path` 之后、调 `generate_video` 之前,插入 PIP 合成(若有附加视频轨):
```python
    pip_layers = _build_pip_layers(timeline, source_resolver=source_resolver)
    base_for_compose = combined_path
    if pip_layers:
        try:
            base_clip = _open_video_clip_quietly(combined_path)
            overlays = []
            for ly in pip_layers:
                w = int(video_width * max(0.05, min(1.0, ly["scale"])))
                if ly["is_image"]:
                    oc = ImageClip(ly["path"]).with_duration(ly["dur"] or base_clip.duration)
                else:
                    oc = _open_video_clip_quietly(ly["path"])
                    if ly["dur"]:
                        oc = oc.subclipped(0, min(ly["dur"], oc.duration))
                oc = oc.resized(width=w).with_position((ly["x"], ly["y"]), relative=True).with_start(ly["start_s"])
                overlays.append(oc)
            comp = CompositeVideoClip([base_clip, *overlays])
            pip_path = os.path.join(output_dir, "edl-pip.mp4")
            comp.write_videofile(pip_path, logger=None, fps=fps, codec=video_codec)
            for oc in overlays:
                close_clip(oc)
            close_clip(base_clip); close_clip(comp)
            base_for_compose = pip_path
        except Exception as exc:  # noqa: BLE001
            logger.warning("[pip] 分层合成失败,退回主轨: %s", exc)
    generate_video(
        video_path=base_for_compose,
        audio_path=audio_file,
        subtitle_path=subtitle_path,
        output_file=output_file,
        params=params,
        extra_audios=_build_extra_audios(timeline, source_resolver=source_resolver),
    )
    return output_file
```
> 把现有 `generate_video(video_path=combined_path, ...)` 调用整体替换为上面这段(base_for_compose)。

- [ ] **Step 6: render_proxy_from_timeline 合 PIP(低清预览)**

在 `render_proxy_from_timeline` 拼好主轨后(concat 到 out_file 前),同理:若有 pip_layers,把 base + overlays composite 后再作为输出/concat 源。最简实现:proxy 主轨 concat 到 `combined`,若 pip 则 composite 写 out_file;否则 combined 即 out。给出:
```python
    # (主轨 clip_files concat 到 combined_path)
    combined_path = os.path.join(output_dir, "proxy-combined.mp4")
    concat_video_clips_with_ffmpeg(clip_files, combined_path, threads=threads, output_dir=output_dir)
    pip_layers = _build_pip_layers(timeline, source_resolver=source_resolver)
    if not pip_layers:
        # 无 PIP:combined 即结果
        import shutil as _sh; _sh.move(combined_path, output_file); return output_file
    base_clip = _open_video_clip_quietly(combined_path)
    overlays = []
    for ly in pip_layers:
        w = int(pw * max(0.05, min(1.0, ly["scale"])))
        oc = (ImageClip(ly["path"]).with_duration(ly["dur"] or base_clip.duration) if ly["is_image"]
              else _open_video_clip_quietly(ly["path"]))
        if (not ly["is_image"]) and ly["dur"]:
            oc = oc.subclipped(0, min(ly["dur"], oc.duration))
        oc = oc.resized(width=w).with_position((ly["x"], ly["y"]), relative=True).with_start(ly["start_s"])
        overlays.append(oc)
    comp = CompositeVideoClip([base_clip, *overlays])
    comp.write_videofile(output_file, logger=None, fps=15, codec=video_codec)
    for oc in overlays: close_clip(oc)
    close_clip(base_clip); close_clip(comp)
    return output_file
```
> 按 render_proxy 现有变量名(`pw/ph`/`clip_files`/`output_file`/`output_dir`)适配;原先它把 clip_files 直接 concat 到 output_file,这里改为先 concat 到 combined_path 再按 PIP 与否决定。`shutil` 顶部已 import(compose 用过)则用现有。

- [ ] **Step 7: py_compile + 跑 pip 测试**

Run:
```bash
cd /work/chayuan-desktop/chayuan-server
PYTHONPATH="libs/chayuan-server" python -m py_compile libs/chayuan-server/chayuan/server/video_generation/steps/compose.py
PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_p5c2_pip.py
```
Expected: py_compile OK;测试全 passed。

- [ ] **Step 8: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/compose.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_p5c2_pip.py
git commit -m "feat(vg): compose 多视频层 PIP 分层渲染(_build_pip_layers + CompositeVideoClip,render+proxy)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 3: 前端 timelineTracks 算子(addTrack/removeTrack/setClipTransform)

**Files:**
- Create: `packages/app/src/features/video-generation/timeline/timelineTracks.ts`
- Test: `packages/app/src/features/video-generation/timeline/timelineTracks.test.ts`

参考:`VgTimeline`/`VgTimelineTrack`/`VgTimelineClip` 类型(已含 x/y/scale/z/removable,Task1)。

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest';
import { addTrack, removeTrack, setClipTransform } from './timelineTracks';

const tl = () => ({ version: 1, duration_ms: 0, tracks: [
  { id: 'v', kind: 'video' as const, clips: [{ id: 'a', source: { path: '/a.mp4' }, track_start_ms: 0, in_ms: 0, out_ms: 0 }] },
] });

it('addTrack appends a removable empty track of given kind', () => {
  const t = addTrack(tl(), 'video');
  const added = t.tracks[t.tracks.length - 1]!;
  expect(added.kind).toBe('video');
  expect(added.clips).toEqual([]);
  expect(added.removable).toBe(true);
});

it('removeTrack removes only removable tracks', () => {
  const t = addTrack(tl(), 'audio');
  const addedId = t.tracks[t.tracks.length - 1]!.id;
  const r = removeTrack(t, addedId);
  expect(r.tracks.some((x) => x.id === addedId)).toBe(false);
  // 默认主轨 removable 非真 → 不删
  const r2 = removeTrack(r, 'v');
  expect(r2.tracks.some((x) => x.id === 'v')).toBe(true);
});

it('setClipTransform clamps x/y in [0,1], scale in [0.05,1]', () => {
  const base = { version: 1, duration_ms: 0, tracks: [
    { id: 'v2', kind: 'video' as const, removable: true, clips: [{ id: 'p', source: { path: '/p.mp4' }, track_start_ms: 0, in_ms: 0, out_ms: 0 }] },
  ] };
  const r = setClipTransform(base, 'p', { x: 1.5, y: -0.2, scale: 2 });
  const c = r.tracks[0]!.clips!.find((x) => x.id === 'p')!;
  expect(c.x).toBe(1); expect(c.y).toBe(0); expect(c.scale).toBe(1);
  const r2 = setClipTransform(base, 'p', { scale: 0.01 });
  expect(r2.tracks[0]!.clips!.find((x) => x.id === 'p')!.scale).toBe(0.05);
});
```

- [ ] **Step 2: 跑 → FAIL**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm exec vitest run packages/app/src/features/video-generation/timeline/timelineTracks.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`timelineTracks.ts`:
```typescript
import type { VgTimeline, VgTimelineTrack } from '@chayuan/api';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 追加一条可删空轨(video/audio)。 */
export function addTrack(t: VgTimeline, kind: 'video' | 'audio'): VgTimeline {
  const n = (t.tracks || []).filter((x) => x.kind === kind).length;
  const track: VgTimelineTrack = { id: `${kind}-${Date.now()}${Math.floor(Math.random() * 1000)}`, kind, clips: [], removable: true, label: `${kind === 'video' ? '视频' : '音频'} ${n + 1}` };
  return { ...t, tracks: [...(t.tracks || []), track] };
}

/** 删除轨:仅 removable 轨可删,否则原样返回。 */
export function removeTrack(t: VgTimeline, trackId: string): VgTimeline {
  const tr = (t.tracks || []).find((x) => x.id === trackId);
  if (!tr || !tr.removable) return t;
  return { ...t, tracks: (t.tracks || []).filter((x) => x.id !== trackId) };
}

/** 设 PIP clip 的 transform(夹正 x/y∈[0,1],scale∈[0.05,1])。 */
export function setClipTransform(
  t: VgTimeline,
  clipId: string,
  tf: { x?: number; y?: number; scale?: number; z?: number },
): VgTimeline {
  const tracks = (t.tracks || []).map((tr) => ({
    ...tr,
    clips: (tr.clips || []).map((c) => {
      if (c.id !== clipId) return c;
      return {
        ...c,
        ...(tf.x != null ? { x: clamp(tf.x, 0, 1) } : {}),
        ...(tf.y != null ? { y: clamp(tf.y, 0, 1) } : {}),
        ...(tf.scale != null ? { scale: clamp(tf.scale, 0.05, 1) } : {}),
        ...(tf.z != null ? { z: Math.round(tf.z) } : {}),
      };
    }),
  }));
  return { ...t, tracks };
}
```

- [ ] **Step 4: 跑 → PASS**

Run: 同 Step 2。Expected: 全 PASS。

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/timelineTracks.ts chayuan-client/packages/app/src/features/video-generation/timeline/timelineTracks.test.ts
git commit -m "feat(client/vg): timelineTracks 算子 addTrack/removeTrack/setClipTransform + 单测

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 4: TrackContextMenu 加轨/删轨项

**Files:**
- Modify: `packages/app/src/features/video-generation/timeline/TrackContextMenu.tsx`

参考(已有):`TrackMenuCtx {x,y,track,clipId?}`(P5c-1 含 'subtitle');菜单上传/库/试听/删除项。本 task 给 ctx 加 `trackId?` + `removable?`,菜单加加轨/删轨。

- [ ] **Step 1: 扩 ctx + 菜单项**

`TrackMenuCtx` 加:
```tsx
  trackId?: string;
  removable?: boolean;
```
props 加:
```tsx
  onAddVideoTrack: () => void;
  onAddAudioTrack: () => void;
  onRemoveTrack: (trackId: string) => void;
```
菜单(`track !== 'subtitle'` 区块内,试听后)加:
```tsx
          <div className="my-1 border-t border-[var(--cy-border-subtle)]" />
          <button type="button" className={item} onClick={() => { onAddVideoTrack(); onClose(); }}>
            <Plus className="h-3.5 w-3.5" /> 添加视频轨
          </button>
          <button type="button" className={item} onClick={() => { onAddAudioTrack(); onClose(); }}>
            <Plus className="h-3.5 w-3.5" /> 添加音频轨
          </button>
          {ctx.removable && ctx.trackId && (
            <button type="button" className={`${item} text-rose-600 hover:bg-rose-50`} onClick={() => { onRemoveTrack(ctx.trackId!); onClose(); }}>
              <Trash2 className="h-3.5 w-3.5" /> 删除此轨
            </button>
          )}
```
import lucide 加 `Plus`。

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
> 注:此时编辑器还没传新 props,会 typecheck 报缺 prop。**把新 3 个回调设为可选**(`onAddVideoTrack?` 等)并在调用处 `onAddVideoTrack?.()`,保证本 task 独立 typecheck 绿;Task 6 编辑器再传。
Expected: 0 错误。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/TrackContextMenu.tsx
git commit -m "feat(client/vg): 右键菜单加 添加视频/音频轨 + 删除此轨(removable)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 5: TimelineTracks 动态多轨 + 选中态 + trackId 透传

**Files:**
- Modify: `packages/app/src/features/video-generation/timeline/TimelineTracks.tsx`

参考(已有):写死 5 lane(视频/旁白/音频/音乐/字幕);`onLaneContextMenu(e, track, clipId?)`;`TrackHeader`/`TRACK_H`;`VgTimeline videoTrackOnly`/`AudioInsertTrack`。

- [ ] **Step 1: 动态渲染视频/音频多 lane**

计算:
```tsx
const videoTracks = (timeline.tracks || []).filter((t) => t.kind === 'video');
const audioTracks = (timeline.tracks || []).filter((t) => t.kind === 'audio');
const laneCount = videoTracks.length + 1 /*旁白*/ + audioTracks.length + 1 /*音乐*/ + 1 /*字幕*/;
const lanesH = TRACK_H * laneCount;
```
props 扩展:
```tsx
  onLaneContextMenu?: (e: React.MouseEvent, track: 'video' | 'audio' | 'subtitle', clipId?: string, trackId?: string, removable?: boolean) => void;
  selectedTrackId?: string | null;
  onSelectTrack?: (trackId: string) => void;
```
轨道头列:视频轨们(每条 TrackHeader,主轨 label「视频」,附加用 track.label;选中高亮)+ 旁白 + 音频轨们 + 音乐 + 字幕。
lane 区按相同顺序渲染:每条 videoTrack 一个 `<div>`(含 drop + onContextMenu 带 trackId/removable + 点击 onSelectTrack)包 `<VgTimeline videoTrackOnly timeline=该轨切片? >`。
> **关键:** `VgTimeline` 现接收整个 `timeline` 并自取第一条 video 轨。多视频轨要让每个 lane 只渲染**自己那条轨**的 clips。最简:给 `VgTimeline` 加可选 `trackId` prop,内部 `find(t=>t.id===trackId)` 取该轨(不传则沿用第一条 video 轨,兼容)。本 task 一并改 VgTimeline:取轨逻辑 `const videoTrack = trackId ? tracks.find(id===trackId) : tracks.find(kind==='video')`。编辑(onChange/拖拽)作用于该轨。
- 选中态:lane 容器按 `selectedTrackId===track.id` 加 ring;点 lane 空白/轨道头 `onSelectTrack(track.id)`。
- onContextMenu:`onLaneContextMenu(e, 'video', undefined, track.id, !!track.removable)`(空白)或 clip 右键带 clipId。

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
> 新 props 可选;`onLaneContextMenu` 签名扩展是增参,编辑器旧调用仍兼容(少传可选参数)。VgTimeline 加可选 trackId 不破坏现有调用。
Expected: 0 错误。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/TimelineTracks.tsx chayuan-client/packages/app/src/features/video-generation/timeline/VgTimeline.tsx
git commit -m "feat(client/vg): TimelineTracks 动态多视频/音频轨 + 轨道选中态 + trackId 透传

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 6: PipOverlay 预览浮层拖拽缩放

**Files:**
- Create: `packages/app/src/features/video-generation/timeline/PipOverlay.tsx`
- Modify: `packages/app/src/features/video-generation/timeline/PreviewPlayer.tsx`

参考:`VgTimeline`/`clipDurMs`;`setClipTransform`(Task3);`videoGeneration.materialThumbUrl`;PreviewPlayer 容器。

- [ ] **Step 1: PipOverlay.tsx**

```tsx
import * as React from 'react';
import type { VgTimeline } from '@chayuan/api';
import { videoGeneration } from '@chayuan/api';
import { clipDurMs } from './timelineEdit';

/** 预览区 PIP 浮层:第 2+ 视频轨当前时刻命中的 clip,显可拖拽移动+拖角缩放的框。
 *  坐标 0-1 归一(相对容器),回写 clip x/y/scale。 */
export const PipOverlay: React.FC<{
  timeline: VgTimeline;
  playheadMs: number;
  onTransform: (clipId: string, tf: { x?: number; y?: number; scale?: number }) => void;
}> = ({ timeline, playheadMs, onTransform }) => {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const videoTracks = (timeline.tracks || []).filter((t) => t.kind === 'video');
  const pipClips = videoTracks.slice(1).flatMap((tr) => tr.clips ?? []);
  const active = pipClips.filter((c) => {
    const s = c.track_start_ms; const e = s + clipDurMs(c);
    return playheadMs >= s && playheadMs < e;
  });

  const drag = (e: React.PointerEvent, clipId: string, mode: 'move' | 'resize', cur: { x: number; y: number; scale: number }) => {
    e.preventDefault(); e.stopPropagation();
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const startX = e.clientX; const startY = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / box.width; const dy = (ev.clientY - startY) / box.height;
      if (mode === 'move') onTransform(clipId, { x: cur.x + dx, y: cur.y + dy });
      else onTransform(clipId, { scale: cur.scale + dx });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-20">
      {active.map((c) => {
        const x = c.x ?? 0; const y = c.y ?? 0; const scale = c.scale ?? 0.4;
        const thumb = c.source.material_id ? videoGeneration.materialThumbUrl(c.source.material_id) : null;
        return (
          <div key={c.id}
            className="pointer-events-auto absolute cursor-move rounded border-2 border-[var(--cy-brand-500)] bg-black/20"
            style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${scale * 100}%` }}
            onPointerDown={(e) => drag(e, c.id, 'move', { x, y, scale })}>
            {thumb && <img src={thumb} alt="" draggable={false} className="pointer-events-none w-full rounded-sm opacity-80" />}
            <span
              onPointerDown={(e) => drag(e, c.id, 'resize', { x, y, scale })}
              className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-white bg-[var(--cy-brand-600)]" />
          </div>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 2: PreviewPlayer 容器叠 overlay slot**

`PreviewPlayer` 加可选 `overlay?: React.ReactNode` prop;在播放器最外层容器内(`<video>` 同级、容器 `relative`)渲染 `{overlay}`。容器已是 flex 居中,改外层加 `relative` 并把 overlay 绝对覆盖在视频区。最简:外层 `<div className="relative flex ...">` 末尾 `{overlay}`。

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 4: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/PipOverlay.tsx chayuan-client/packages/app/src/features/video-generation/timeline/PreviewPlayer.tsx
git commit -m "feat(client/vg): PipOverlay 预览浮层拖拽移动/缩放(0-1 归一回写 transform)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 7: 编辑器接线(加/删轨 + transform + 选中 + overlay)

**Files:**
- Modify: `packages/app/src/features/video-generation/VgTimelineEditorPage.tsx`

参考(已有):menuCtx/TrackContextMenu 渲染;TimelineTracks 用法;PreviewPlayer 用法;`onTimelineChange`。

- [ ] **Step 1: import + 状态 + 回调**

import:`import { addTrack, removeTrack, setClipTransform } from './timeline/timelineTracks';`、`import { PipOverlay } from './timeline/PipOverlay';`
状态:`const [selectedTrackId, setSelectedTrackId] = React.useState<string | null>(null);`
回调:
```tsx
const onSetTransform = (clipId: string, tf: { x?: number; y?: number; scale?: number }) => onTimelineChange(setClipTransform(timeline, clipId, tf));
```

- [ ] **Step 2: TimelineTracks 传新 props + onLaneContextMenu 带 trackId/removable**

把 `onLaneContextMenu` 改为接收 trackId/removable 并存进 menuCtx:
```tsx
const onLaneContextMenu = (e: React.MouseEvent, track: 'video' | 'audio' | 'subtitle', clipId?: string, trackId?: string, removable?: boolean) =>
  setMenuCtx({ x: e.clientX, y: e.clientY, track, clipId, trackId, removable });
```
`<TimelineTracks>` 加:`selectedTrackId={selectedTrackId} onSelectTrack={setSelectedTrackId}`。

- [ ] **Step 3: TrackContextMenu 传加/删轨回调**

```tsx
        <TrackContextMenu ctx={menuCtx}
          ...(现有 onUploadLocal/onAddFromLibrary/onPreview/onDeleteClip/onClose)
          onAddVideoTrack={() => onTimelineChange(addTrack(timeline, 'video'))}
          onAddAudioTrack={() => onTimelineChange(addTrack(timeline, 'audio'))}
          onRemoveTrack={(tid) => onTimelineChange(removeTrack(timeline, tid))}
        />
```

- [ ] **Step 4: PreviewPlayer 叠 PipOverlay**

`<PreviewPlayer ... overlay={<PipOverlay timeline={timeline} playheadMs={playheadMs} onTransform={onSetTransform} />} />`(transform 改完置 proxyStale:onSetTransform 里 onTimelineChange 已 setProxyStale)。

- [ ] **Step 5: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 6: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/VgTimelineEditorPage.tsx
git commit -m "feat(client/vg): 编辑器接线 — 加/删轨 + PIP transform + 轨道选中 + 预览浮层

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 8: 联调验证

- [ ] **Step 1: 全量 typecheck + 单测 + 构建**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client
pnpm --filter @chayuan/app typecheck && pnpm --filter @chayuan/api typecheck
pnpm exec vitest run packages/app/src/features/video-generation
cd /work/chayuan-desktop/chayuan-server
PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_p5c2_pip.py
cd /work/chayuan-desktop/chayuan-client && pnpm run build:web 2>&1 | tail -3
```
Expected: typecheck 0;前端 vitest 全 PASS(含 timelineTracks 3 条);后端 pip 3 条 PASS;web build `✓ built`。

- [ ] **Step 2: 手动验收清单(重建前端 + 重启 sidecar 后)**

- 右键轨道 → 「添加视频轨」「添加音频轨」→ 出现新 lane(标「视频 2」/「音频 2」),附加轨右键有「删除此轨」,主轨/旁白/音乐/字幕无删轨项。
- 点轨道 → 整条选中高亮。
- 拖素材到第 2 视频轨 → 预览区出现 PIP 浮层框(显缩略图);拖动移位、拖右下角缩放 → clip x/y/scale 变。
- 「生成预览」→ 画面真分层(主轨铺满 + PIP 按位置/大小叠);「提交合成」成片含 PIP。

- [ ] **Step 3: 最终推送(若联调微调)**

```bash
cd /work/chayuan-desktop
git add -A && git commit -m "fix(vg): P5c-2 联调微调" && git push origin main
```

---

## Self-Review

**Spec coverage:**
- ① EDL 扩展 → Task 1(schema + api x/y/scale/z + removable/label)。✓
- ② 动态轨道列表 → Task 3(addTrack/removeTrack 算子)、Task 5(TimelineTracks 动态多 lane + VgTimeline trackId)。✓
- ③ 选中 + 加/删轨 → Task 4(菜单项)、Task 5(选中态)、Task 7(接线)。✓
- ④ PIP 浮层编辑 → Task 3(setClipTransform)、Task 6(PipOverlay)、Task 7(接 playheadMs/transform)。✓
- ⑤ compose 分层 → Task 2(_build_pip_layers + render_from_edl/proxy CompositeVideoClip)。✓

**Placeholder scan:** 无 TBD。Task 2 Step 6 "按 render_proxy 现有变量名适配" 是真实适配点(给了完整代码骨架)。Task 5 给了动态渲染要点 + VgTimeline trackId 改法。

**Type consistency:** `x/y/scale/z`/`removable`(Task1 schema+api)被 _build_pip_layers(Task2)、setClipTransform(Task3)、PipOverlay(Task6)一致用;`addTrack/removeTrack/setClipTransform`(Task3)被 Task7 调一致;`TrackMenuCtx +trackId/removable` 与 onAddVideoTrack/onAddAudioTrack/onRemoveTrack(Task4)被 Task7 传一致;`onLaneContextMenu` 扩展签名(Task5)与编辑器(Task7)一致;`VgTimeline +trackId`(Task5)用于多视频 lane;`PipOverlay onTransform`(Task6)与编辑器 onSetTransform→setClipTransform 一致;`PreviewPlayer +overlay`(Task6)与 Task7 传一致。

**依赖顺序:** 后端 1(schema)→2(PIP 渲染);api 类型在 1;前端算子 3;UI 4(菜单)/5(动态轨+选中)/6(overlay)各自独立可选 props 保证逐 task typecheck 绿;7(编辑器接线汇总);8 联调。无循环依赖。
