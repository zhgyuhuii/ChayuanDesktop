# 时间轴编辑器 P5a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把时间轴编辑器从 P4a 的"自动预生成草稿"升级为"手动编辑合成":对话消息卡片新增「去编辑合成」入口、进编辑器只预生成旁白+字幕(`stop_at=subtitle`)、视频轨初始空 + 从素材库拖 video/image 入轨(图像真渲染)、字幕轨移到最下、BGM 轨显已选音乐、finalize 放宽以渲染手拖的 EDL。

**Architecture:** 复用现有 pipeline 与 EDL 渲染。消息卡片「去编辑合成」把脚本写进 vgComposer params + resetDraft + 进时间轴路由。编辑器草稿改 `stop_at='subtitle'`(只 TTS+字幕,不下素材);素材从 MediaPool 拖入视频轨,前端纯算子 `appendClipFromMaterial` 改 `params.timeline`;后端 `render_from_edl` 增图像 `ImageClip` 分支;`finalize_task` 放宽为只要 audio+subtitle+视频轨有 clip。

**Tech Stack:** Python 3.12 / FastAPI / moviepy 2.x(`ImageClip` 已导入)/ ffmpeg;TS / React 19 / Zustand / HTML5 drag-and-drop;vitest + pytest。

**前置:** P1-P3(EDL schema/渲染、交互算子)、P4a(三区布局 + 草稿编排 + 多轨可视化 + finalize + media_probe)已落地。

**收尾:** monorepo `/work/chayuan-desktop`,commit 进 `main`,每 task `git push origin main`。

---

## File Structure

**后端**(`libs/chayuan-server/chayuan/server/video_generation/`):
- `steps/compose.py`(改)— `_build_edl_render_plan` 增 `is_image`;`render_from_edl` 图像 `ImageClip` 分支。
- `service.py`(改)— `finalize_task` 放宽校验。
- `api_server/video_generation_routes.py`(改)— `+GET /materials/{material_id}/thumb`。
- `tests/unit_tests/test_vg_p5a_render.py`(新)、`test_vg_finalize.py`(补放宽用例)。

**API 客户端**(`packages/api/src/videoGeneration.ts`,改):`+vgMaterialThumbUrl`。

**前端**(`packages/app/src/features/video-generation/`):
- `timeline/timelineEdit.ts`(改)— `+DraggedMaterial` 类型、`+VG_MATERIAL_DND_MIME` 常量、`+appendClipFromMaterial` 纯算子(+`timelineEdit.test.ts` 补用例)。
- `VgMessageExtras.tsx`(改)— 重命名「自动生成视频」+ 新增「去编辑合成」+ `onGoEdit` prop。
- `VgChatPage.tsx`(改)— 传 `onGoEdit`(写 script + resetDraft + goTimeline)。
- `steps/MaterialsStep.tsx`(改)— 素材卡片 `draggable` + onDragStart 塞 dataTransfer。
- `VgTimelineEditorPage.tsx`(改)— 草稿 `stop_at='subtitle'`;`onDropMaterial` + `thumbUrlOf`(素材级)传 TimelineTracks。
- `timeline/TimelineTracks.tsx`(改)— 轨道顺序(字幕下移)+ 视频轨 drop 区。

> 关键约定:拖拽 dataTransfer MIME = `application/x-vg-material`,payload JSON `{ materialId?, url?, kind: 'video'|'image', durationMs? }`(类型 `DraggedMaterial`,定义在 `timelineEdit.ts`,MaterialsStep 写、TimelineTracks 读)。

---

## Task 1: 后端 compose 图像 clip 渲染

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/video_generation/steps/compose.py`
- Test: `libs/chayuan-server/tests/unit_tests/test_vg_p5a_render.py`

参考(已有):`_build_edl_render_plan`(line ~317,返回 list[dict] {clip_id,path,start_s,end_s,target_w,target_h});`render_from_edl`(line ~349,循环 `_open_video_clip_quietly(p["path"])` 裁剪写段);`ImageClip` 已在 line 37 import;`fps=30`、`video_codec="libx264"` 模块常量。

- [ ] **Step 1: 写失败测试**

`libs/chayuan-server/tests/unit_tests/test_vg_p5a_render.py`:
```python
from chayuan.server.video_generation.steps.compose import _build_edl_render_plan
from chayuan.server.video_generation.schemas import Timeline


def _tl(clips):
    return Timeline.model_validate({
        "version": 1, "duration_ms": 0,
        "tracks": [{"id": "v", "kind": "video", "clips": clips}],
    })


def test_plan_marks_image_by_extension():
    tl = _tl([
        {"id": "a", "source": {"path": "/m/a.mp4"}, "track_start_ms": 0, "in_ms": 0, "out_ms": 0},
        {"id": "b", "source": {"path": "/m/b.jpg"}, "track_start_ms": 5000, "in_ms": 0, "out_ms": 3000},
    ])
    plan = _build_edl_render_plan(tl, "9:16", source_resolver=lambda s: s.get("path", ""))
    assert plan[0]["is_image"] is False
    assert plan[1]["is_image"] is True
    # 图像 clip:out_ms>0 → end_s=3.0;视频整段 out_ms=0 → end_s=None
    assert plan[1]["end_s"] == 3.0
    assert plan[0]["end_s"] is None


def test_plan_image_default_duration_when_no_out():
    tl = _tl([{"id": "c", "source": {"path": "/m/c.png"}, "track_start_ms": 0, "in_ms": 0, "out_ms": 0}])
    plan = _build_edl_render_plan(tl, "9:16", source_resolver=lambda s: s.get("path", ""))
    assert plan[0]["is_image"] is True
    assert plan[0]["end_s"] == 3.0  # 图像无 out 时默认 3s
```

- [ ] **Step 2: 跑 → FAIL**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_p5a_render.py`
Expected: FAIL(plan 无 `is_image` 键 / end_s 行为不符)。

- [ ] **Step 3: `_build_edl_render_plan` 增 is_image + 图像 end_s**

在 `_build_edl_render_plan` 里(plan.append 处)加图像判断。把现有:
```python
        plan.append({
            "clip_id": c.id,
            "path": path,
            "start_s": max(0.0, c.in_ms / 1000.0),
            "end_s": (c.out_ms / 1000.0) if c.out_ms and c.out_ms > c.in_ms else None,
            "target_w": target_w,
            "target_h": target_h,
        })
```
改为:
```python
        is_image = path.lower().rsplit(".", 1)[-1] in ("jpg", "jpeg", "png", "webp", "bmp", "gif")
        if is_image:
            # 图像无"素材末尾",out_ms>0 用其作时长,否则默认 3s
            end_s = (c.out_ms / 1000.0) if c.out_ms and c.out_ms > 0 else 3.0
        else:
            end_s = (c.out_ms / 1000.0) if c.out_ms and c.out_ms > c.in_ms else None
        plan.append({
            "clip_id": c.id,
            "path": path,
            "start_s": max(0.0, c.in_ms / 1000.0),
            "end_s": end_s,
            "is_image": is_image,
            "target_w": target_w,
            "target_h": target_h,
        })
```

- [ ] **Step 4: `render_from_edl` 图像分支**

在 `render_from_edl` 的 `for i, p in enumerate(plan):` 循环体最前面(`clip = _open_video_clip_quietly(...)` 之前)加图像短路:
```python
        if p.get("is_image"):
            dur = p["end_s"] if p["end_s"] is not None else 3.0
            seg_path = os.path.join(output_dir, f"edl-seg-{i}.mp4")
            try:
                img = ImageClip(p["path"]).with_duration(dur).resized(new_size=(video_width, video_height))
                img.write_videofile(seg_path, logger=None, fps=fps, codec=video_codec)
                close_clip(img)
                clip_files.append(seg_path)
                total += dur
            except Exception as exc:  # noqa: BLE001
                logger.warning("[edl] 图像 clip 渲染失败,跳过 %s: %s", p["path"], exc)
            continue
```
(其余视频分支不变。)

- [ ] **Step 5: 跑 → PASS**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_p5a_render.py`
Expected: 2 passed。

- [ ] **Step 6: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/compose.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_p5a_render.py
git commit -m "feat(vg): EDL 渲染支持图像 clip(ImageClip 真渲染)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 2: 后端 finalize 放宽(素材来自 EDL,不再要求草稿 materials)

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/video_generation/service.py`
- Test: `libs/chayuan-server/tests/unit_tests/test_vg_finalize.py`(补)

参考(已有,P4a):`finalize_task`(校验 `audio_file && subtitle_path && result.materials`)。

- [ ] **Step 1: 补失败测试**

在 `test_vg_finalize.py` 末尾追加:
```python
def test_finalize_relaxed_no_materials_but_timeline_has_clip(monkeypatch):
    row = _draft_row()
    row["result"] = {"audio_file": "/d/a.mp3", "subtitle_path": "/d/s.srt"}  # 无 materials
    monkeypatch.setattr(service.tasks_store, "get_task", lambda *a, **k: row)
    monkeypatch.setattr(service.tasks_store, "update_progress", lambda *a, **k: True)
    monkeypatch.setattr(service.runner, "enqueue_finalize", lambda *a, **k: None)
    tl = {"version": 1, "tracks": [{"id": "v", "kind": "video", "clips": [
        {"id": "x", "source": {"url": "http://e/x.mp4"}, "track_start_ms": 0, "in_ms": 0, "out_ms": 0},
    ]}]}
    assert service.finalize_task("draft-1", tl, owner_id=1) is True


def test_finalize_rejects_empty_video_track(monkeypatch):
    row = _draft_row()
    row["result"] = {"audio_file": "/d/a.mp3", "subtitle_path": "/d/s.srt"}
    monkeypatch.setattr(service.tasks_store, "get_task", lambda *a, **k: row)
    tl = {"version": 1, "tracks": [{"id": "v", "kind": "video", "clips": []}]}
    assert service.finalize_task("draft-1", tl, owner_id=1) is False
```

> 注:P4a 的 `test_finalize_task_no_audio_returns_false` 用 `row["result"] = {"materials": [...]}`(无 audio)仍应返回 False —— 放宽后校验是 `audio_file and subtitle_path and 有视频 clip`,该用例无 audio,仍 False,不受影响,无需改。

- [ ] **Step 2: 跑 → 新用例 FAIL**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_finalize.py`
Expected: 新增 `test_finalize_relaxed_*` FAIL(当前要求 materials)。

- [ ] **Step 3: 放宽 finalize_task 校验**

把 `finalize_task` 里:
```python
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
```
改为:
```python
    result = row.get("result") or {}
    audio_file = result.get("audio_file")
    subtitle_path = result.get("subtitle_path")
    if not audio_file or not subtitle_path:
        logger.warning("[service] finalize_task %s 草稿缺 audio/subtitle", task_id)
        return False
    # 素材来自用户手拖的 EDL(P5a),不再要求草稿自动下的 materials;
    # 但视频轨必须有 clip,否则没东西可渲染。
    vclips = [
        c for tr in (timeline.get("tracks") or []) if tr.get("kind") == "video"
        for c in (tr.get("clips") or [])
    ]
    if not vclips:
        logger.warning("[service] finalize_task %s 视频轨为空,拒绝", task_id)
        return False
    try:
        params = VideoParams.model_validate(row.get("params") or {})
        from .schemas import Timeline
        params.timeline = Timeline.model_validate(timeline)
    except Exception as e:  # noqa: BLE001
        logger.warning("[service] finalize_task %s params/timeline 解析失败: %r", task_id, e)
        return False
```

- [ ] **Step 4: 跑 → PASS**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_finalize.py`
Expected: 全 passed(P4a 4 条 + 新 2 条 = 6)。

> 若 P4a `test_finalize_task_enqueues_compose_only` 的 `_draft_row()` timeline 入参是空 tracks(`{"tracks": []}`)会因放宽后"视频轨为空"而 False。检查该用例:它传的 timeline 是 `{"version":1,"duration_ms":0,"tracks":[]}` → **会失败**。需把该用例的 timeline 改成含一个视频 clip:
> ```python
>     tl = {"version": 1, "duration_ms": 0, "tracks": [{"id": "v", "kind": "video", "clips": [
>         {"id": "x", "source": {"url": "http://e/x.mp4"}, "track_start_ms": 0, "in_ms": 0, "out_ms": 0}]}]}
>     ok = service.finalize_task("draft-1", tl, owner_id=1)
> ```
> 同步改 `test_finalize_task_missing_draft_returns_false` / `test_finalize_task_no_audio_returns_false` 的 timeline 入参为上述含 clip 版本(它们因 draft 缺失/无 audio 先行 return False,timeline 内容不影响,但为一致性一并改)。

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/service.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_vg_finalize.py
git commit -m "feat(vg): finalize 放宽 — 素材来自手拖 EDL,只要 audio+subtitle+视频轨有 clip

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 3: 后端素材首帧缩略图路由

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py`

参考(已有):`serve_material_file`(line ~1357,`materials_store.get_material(material_id, owner_id=_owner_id_of(user))` → row["path"]/row["mime"]);`media_probe.extract_thumbnail`(P4a);`storage_dir`/`task_dir` helper;`materials_store` 已 import。

- [ ] **Step 1: 加路由**

在 `serve_material_file` 路由之后追加:
```python
@video_generation_router.get(
    "/materials/{material_id}/thumb", summary="素材首帧缩略图(时间轴视频 clip)",
)
def material_thumbnail(
    material_id: str = FPath(...),
    user: Dict[str, Any] = Depends(require_auth_enabled()),
) -> FileResponse:
    from chayuan.server.video_generation._helpers import storage_dir
    from chayuan.server.video_generation.steps import media_probe

    row = materials_store.get_material(material_id, owner_id=_owner_id_of(user))
    if not row:
        raise HTTPException(404, "material not found")
    path = row.get("path") or ""
    if not path or not os.path.isfile(path):
        raise HTTPException(404, "material file missing on disk")
    mime = row.get("mime") or ""
    # 图像素材直接返回原图(它本身就是缩略图来源)
    if mime.startswith("image"):
        return FileResponse(path, media_type=mime)
    cache_dir = storage_dir("thumbs", create=True)
    out = os.path.join(cache_dir, f"mat-{material_id}.jpg")
    got = media_probe.extract_thumbnail(path, out, 0.0)
    if not got:
        raise HTTPException(502, "thumbnail extract failed")
    return FileResponse(got, media_type="image/jpeg")
```
> 确认 `storage_dir` 在 `_helpers` 有(preview_edl 已用 `from ...._helpers import storage_dir`)。`media_probe` Task P4a 已建。`FPath`/`Query`/`Depends`/`HTTPException`/`FileResponse`/`os` 顶部已 import。

- [ ] **Step 2: py_compile + import 冒烟**

Run:
```bash
cd /work/chayuan-desktop/chayuan-server
PYTHONPATH="libs/chayuan-server" python -m py_compile libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py
PYTHONPATH="libs/chayuan-server" python -c "import chayuan.server.api_server.video_generation_routes as m; print('OK', hasattr(m,'material_thumbnail'))"
```
Expected: `OK True`。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py
git commit -m "feat(vg): 路由 GET /materials/{id}/thumb(素材首帧/图像缩略图)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 4: API 客户端 vgMaterialThumbUrl

**Files:**
- Modify: `packages/api/src/videoGeneration.ts`

参考:`vgMaterialFileUrl`(line ~751,拼 `/materials/{id}/file` URL);`videoGeneration` 聚合对象。

- [ ] **Step 1: 加函数 + 挂聚合**

在 `vgMaterialFileUrl` 之后加:
```ts
/** 素材首帧缩略图 URL(时间轴视频 clip 背景;图像素材返回原图)。 */
export function vgMaterialThumbUrl(materialId: string): string {
  const cfg = getClientConfig();
  const base = (cfg.baseURL || '').replace(/\/+$/, '');
  return `${base}/api/v1/video-generation/materials/${encodeURIComponent(materialId)}/thumb`;
}
```
在 `videoGeneration` 聚合对象内 `materialFileUrl: vgMaterialFileUrl,` 之后加:
```ts
  materialThumbUrl: vgMaterialThumbUrl,
```

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/api typecheck`
Expected: 0 错误。

- [ ] **Step 3: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/api/src/videoGeneration.ts
git commit -m "feat(client/vg): api vgMaterialThumbUrl

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 5: 前端纯算子 appendClipFromMaterial + DnD 约定

**Files:**
- Modify: `packages/app/src/features/video-generation/timeline/timelineEdit.ts`
- Test: `packages/app/src/features/video-generation/timeline/timelineEdit.test.ts`(补)

参考(已有):`timelineEdit.ts` 的 `recomputeStarts`/`withVideoClips`(内部)/`videoClips`(内部);`VgTimeline`/`VgTimelineClip` 类型。

- [ ] **Step 1: 补失败测试**

在 `timelineEdit.test.ts` 末尾追加:
```typescript
import { appendClipFromMaterial } from './timelineEdit';

it('appendClipFromMaterial: image default 3000ms, video default 5000ms', () => {
  const empty = { version: 1, duration_ms: 0, tracks: [{ id: 'v', kind: 'video' as const, clips: [] }] };
  const t1 = appendClipFromMaterial(empty, { materialId: 'm1', kind: 'image' });
  const c1 = t1.tracks[0]!.clips![0]!;
  expect(c1.source).toEqual({ material_id: 'm1' });
  expect(c1.out_ms).toBe(3000);
  const t2 = appendClipFromMaterial(empty, { url: 'http://e/v.mp4', kind: 'video' });
  const c2 = t2.tracks[0]!.clips![0]!;
  expect(c2.source).toEqual({ url: 'http://e/v.mp4' });
  expect(c2.out_ms).toBe(0); // 视频整段
});

it('appendClipFromMaterial: explicit durationMs wins, appends + recomputes starts', () => {
  const base = { version: 1, duration_ms: 0, tracks: [{ id: 'v', kind: 'video' as const, clips: [
    { id: 'a', source: { path: '/a.mp4' }, track_start_ms: 0, in_ms: 0, out_ms: 4000 },
  ] }] };
  const t = appendClipFromMaterial(base, { materialId: 'm2', kind: 'image', durationMs: 2000 });
  const clips = t.tracks[0]!.clips!;
  expect(clips).toHaveLength(2);
  expect(clips[1]!.out_ms).toBe(2000);
  expect(clips[1]!.track_start_ms).toBe(4000); // 接在第一段后
});

it('appendClipFromMaterial: atIndex inserts', () => {
  const base = { version: 1, duration_ms: 0, tracks: [{ id: 'v', kind: 'video' as const, clips: [
    { id: 'a', source: { path: '/a.mp4' }, track_start_ms: 0, in_ms: 0, out_ms: 4000 },
  ] }] };
  const t = appendClipFromMaterial(base, { url: 'http://e/x.mp4', kind: 'video' }, 0);
  expect(t.tracks[0]!.clips!.map((c) => c.source)).toEqual([{ url: 'http://e/x.mp4' }, { path: '/a.mp4' }]);
});
```

- [ ] **Step 2: 跑 → FAIL**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm exec vitest run packages/app/src/features/video-generation/timeline/timelineEdit.test.ts`
Expected: FAIL(`appendClipFromMaterial` 不存在)。

- [ ] **Step 3: 实现**

在 `timelineEdit.ts` 末尾加:
```typescript
/** 拖拽 dataTransfer 的 MIME 与 payload 类型(MaterialsStep 写 / TimelineTracks 读)。 */
export const VG_MATERIAL_DND_MIME = 'application/x-vg-material';

export interface DraggedMaterial {
  materialId?: string;
  url?: string;
  kind: 'video' | 'image';
  durationMs?: number;
}

/** 从拖入素材生成一个视频轨 clip,插入到 atIndex(默认末尾),重算 starts。 */
export function appendClipFromMaterial(
  t: VgTimeline,
  m: DraggedMaterial,
  atIndex?: number,
): VgTimeline {
  const clips = [...videoClips(t)];
  const dur = m.durationMs && m.durationMs > 0
    ? Math.round(m.durationMs)
    : (m.kind === 'image' ? 3000 : 0); // 图像默认 3s;视频 0=整段
  const clip: VgTimelineClip = {
    id: `c${Date.now()}${Math.floor(Math.random() * 1000)}`,
    source: m.materialId ? { material_id: m.materialId } : { url: m.url ?? '' },
    track_start_ms: 0,
    in_ms: 0,
    out_ms: dur,
    duration_ms: m.kind === 'image' ? (dur || 3000) : (m.durationMs || 0),
  } as VgTimelineClip & { duration_ms: number };
  const at = atIndex == null ? clips.length : Math.max(0, Math.min(atIndex, clips.length));
  clips.splice(at, 0, clip);
  return recomputeStarts(withVideoClips(t, clips));
}
```
> `videoClips`/`withVideoClips`/`recomputeStarts` 是 `timelineEdit.ts` 内已有函数。`source.material_id`/`source.url` 字段名以 `VgTimelineClip['source']` 类型为准(P1 schema:`{ material_id?, url?, path? }`)。`duration_ms` 是 P3 给 `VgTimelineClip` 加的可选展示字段。

- [ ] **Step 4: 跑 → PASS**

Run: 同 Step 2。Expected: 全 PASS(P3 原 6 + 新 3 = 9)。

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/timelineEdit.ts chayuan-client/packages/app/src/features/video-generation/timeline/timelineEdit.test.ts
git commit -m "feat(client/vg): appendClipFromMaterial 纯算子 + 拖拽 DnD 约定 + 单测

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 6: 消息卡片两按钮(自动生成视频 / 去编辑合成)

**Files:**
- Modify: `packages/app/src/features/video-generation/VgMessageExtras.tsx`
- Modify: `packages/app/src/features/video-generation/VgChatPage.tsx`

参考(已有):`VgMessageExtrasProps`(message/onMetaChange/onSubmit/onRegenerate);「去生成视频」按钮(line ~182);VgChatPage `goTimeline`(line 69)、extraSlot 注入(line ~306)、`useVgComposer`。

- [ ] **Step 1: VgMessageExtras 加 onGoEdit prop + 重命名 + 新按钮**

props 接口加:
```typescript
  /** 去编辑合成:把本条脚本带进时间轴编辑器(父级 VgChatPage 实现)。 */
  onGoEdit?: (script: string) => void;
```
解构加 `onGoEdit`:
```typescript
}) => {
```
→
```typescript
export const VgMessageExtras: React.FC<VgMessageExtrasProps> = ({
  message, onMetaChange, onSubmit, onRegenerate, onGoEdit,
}) => {
```
把「去生成视频」按钮块:
```tsx
      {/* 去生成视频 */}
      <button type="button" onClick={() => setDrawerOpen(true)}
        className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 text-xs font-medium text-white shadow">
        <Sparkles className="h-3.5 w-3.5" /> 去生成视频
      </button>
```
改为:
```tsx
      {/* 自动生成视频(全自动 submitTask) */}
      <button type="button" onClick={() => setDrawerOpen(true)}
        className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--cy-brand-500)] to-[var(--cy-brand-700)] px-3 text-xs font-medium text-white shadow">
        <Sparkles className="h-3.5 w-3.5" /> 自动生成视频
      </button>
      {/* 去编辑合成(进时间轴手动编辑) */}
      {onGoEdit && (
        <button type="button" onClick={() => onGoEdit(message.content || '')}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--cy-border-strong)] bg-[var(--cy-surface-base)] px-3 text-xs font-medium text-[var(--cy-text-primary)] hover:bg-[var(--cy-surface-2)]">
          <Film className="h-3.5 w-3.5" /> 去编辑合成
        </button>
      )}
```
确认顶部 lucide import 含 `Film`(没有则加:`import { ..., Film } from 'lucide-react';`)。

- [ ] **Step 2: VgChatPage 传 onGoEdit**

在 extraSlot 的 `<VgMessageExtras ... onRegenerate={...} />` 加:
```tsx
                onGoEdit={(script) => {
                  const st = useVgComposer.getState();
                  st.setScriptSlot('manual', script);
                  st.setScriptSource('manual');
                  st.resetDraft();
                  goTimeline();
                }}
```
> `setScriptSlot('manual', script)` 写 manual slot 并 mirror 到 `params.video_script`(store 现有逻辑);`setScriptSource('manual')` 锁定来源;`resetDraft()` 清旧草稿(P4a/Task7 已加)。`useVgComposer` 已 import(VgChatPage 用到 params)。

- [ ] **Step 3: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 4: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/VgMessageExtras.tsx chayuan-client/packages/app/src/features/video-generation/VgChatPage.tsx
git commit -m "feat(client/vg): 消息卡片「自动生成视频」+「去编辑合成」入口

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 7: 素材库卡片可拖拽(drag source)

**Files:**
- Modify: `packages/app/src/features/video-generation/steps/MaterialsStep.tsx`

参考(已有):MineTab 卡片 `<li key={m.material_id}>`(material_id + mime + duration_ms);OnlineTab 卡片 `<li key={...}>`(item.url + item.duration + item.provider)。`VG_MATERIAL_DND_MIME`/`DraggedMaterial`(Task 5)。

- [ ] **Step 1: import DnD 约定 + 拖拽辅助**

文件顶部加:
```tsx
import { VG_MATERIAL_DND_MIME, type DraggedMaterial } from '../timeline/timelineEdit';
```
在 MaterialsStep 模块内加一个辅助:
```tsx
function setDragData(e: React.DragEvent, m: DraggedMaterial) {
  e.dataTransfer.setData(VG_MATERIAL_DND_MIME, JSON.stringify(m));
  e.dataTransfer.effectAllowed = 'copy';
}
```

- [ ] **Step 2: MineTab 卡片 draggable**

MineTab 渲染卡片的 `<li key={m.material_id} ...>` 加 `draggable` + `onDragStart`:
```tsx
            <li key={m.material_id}
              draggable
              onDragStart={(e) => setDragData(e, {
                materialId: m.material_id,
                kind: isImg(m) ? 'image' : 'video',
                durationMs: m.duration_ms || undefined,
              })}
```
(保留原有 className/其它属性。)

- [ ] **Step 3: OnlineTab 卡片 draggable**

OnlineTab 渲染结果的 `<li key={`${item.url}-${i}`} ...>` 加:
```tsx
            <li key={`${item.url}-${i}`}
              draggable
              onDragStart={(e) => setDragData(e, {
                url: item.url,
                kind: /\.(jpg|jpeg|png|webp|bmp|gif)(\?|$)/i.test(item.url) ? 'image' : 'video',
                durationMs: item.duration ? item.duration * 1000 : undefined,
              })}
```

- [ ] **Step 4: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/steps/MaterialsStep.tsx
git commit -m "feat(client/vg): 素材库卡片可拖拽(写 DnD payload)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 8: TimelineTracks 视频轨 drop 区 + 字幕轨下移

**Files:**
- Modify: `packages/app/src/features/video-generation/timeline/TimelineTracks.tsx`

参考(已有,P4a):TimelineTracks(轨道顺序 视频/旁白/字幕/音乐;props 含 timeline/pxPerSec/onTimelineChange/...);`VG_MATERIAL_DND_MIME`/`DraggedMaterial`/`appendClipFromMaterial`(Task5);`pxToMs`(timelineScale)。

- [ ] **Step 1: 加 onDropMaterial prop + import**

import 加:
```tsx
import { VG_MATERIAL_DND_MIME, type DraggedMaterial } from './timelineEdit';
```
props 类型加:
```tsx
  onDropMaterial: (m: DraggedMaterial) => void;
```

- [ ] **Step 2: 视频轨 lane 作 drop 区**

把视频轨那段:
```tsx
            {/* 视频轨(可编辑 + 缩略图) */}
            <div style={{ height: TRACK_H }} className="border-b border-[var(--cy-border-subtle)]">
              <VideoTrack timeline={timeline} editable videoTrackOnly pxPerSec={pxPerSec}
                thumbUrlOf={thumbUrlOf} onChange={onTimelineChange} />
            </div>
```
改为:
```tsx
            {/* 视频轨(可编辑 + 缩略图 + 拖素材入轨) */}
            <div style={{ height: TRACK_H }}
              className="border-b border-[var(--cy-border-subtle)]"
              onDragOver={(e) => { if (e.dataTransfer.types.includes(VG_MATERIAL_DND_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
              onDrop={(e) => {
                const raw = e.dataTransfer.getData(VG_MATERIAL_DND_MIME);
                if (!raw) return;
                e.preventDefault();
                try { onDropMaterial(JSON.parse(raw) as DraggedMaterial); } catch { /* ignore 非法 */ }
              }}
            >
              <VgTimelineDropHint show={!timeline.tracks?.some((t) => t.kind === 'video' && (t.clips?.length ?? 0) > 0)} />
              <VideoTrack timeline={timeline} editable videoTrackOnly pxPerSec={pxPerSec}
                thumbUrlOf={thumbUrlOf} onChange={onTimelineChange} />
            </div>
```
并在文件内加一个小提示组件:
```tsx
const VgTimelineDropHint: React.FC<{ show: boolean }> = ({ show }) =>
  show ? (
    <div className="pointer-events-none absolute left-16 right-0 z-10 flex items-center justify-center text-[10px] text-[var(--cy-text-tertiary)]" style={{ height: TRACK_H }}>
      从左侧素材库拖 视频 / 图像 到此处
    </div>
  ) : null;
```
> 提示绝对定位在视频轨行;`left-16` 避开轨道头宽(64px)。`pointer-events-none` 不挡拖放。

- [ ] **Step 3: 字幕轨下移(轨道顺序 视频/旁白/音乐/字幕)**

把 lane 区四轨顺序由 `视频→旁白(Audio)→字幕(Subtitle)→音乐(Bgm)` 改为 `视频→旁白→音乐→字幕`:把 `<BgmTrack .../>` 移到 `<SubtitleCueTrack .../>` 之前。同步把**左侧轨道头列**顺序也改为 视频/旁白/音乐/字幕(TrackHeader 的 Music 行移到 Captions 行之前)。

- [ ] **Step 4: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/timeline/TimelineTracks.tsx
git commit -m "feat(client/vg): 视频轨支持拖素材入轨 + 字幕轨下移(视频/旁白/音乐/字幕)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 9: 编辑器接草稿 stop_at=subtitle + drop 回调 + 素材级缩略图

**Files:**
- Modify: `packages/app/src/features/video-generation/VgTimelineEditorPage.tsx`

参考(已有,P4a):草稿编排 `submitTask(params, { stop_at: 'materials' })`;`thumbUrlOf`(用 draft.taskId + 索引);`<TimelineTracks ... thumbUrlOf onTimelineChange .../>`;`appendClipFromMaterial`(Task5);`videoGeneration.materialThumbUrl`(Task4)。

- [ ] **Step 1: 草稿改 stop_at=subtitle**

把:
```tsx
        const t = await videoGeneration.submitTask(params, { stop_at: 'materials' });
```
改为:
```tsx
        const t = await videoGeneration.submitTask(params, { stop_at: 'subtitle' });
```
并把 ready 回填里 `materials` 相关赋值简化(草稿不再有 materials):
```tsx
        patchDraft({
          state: 'ready',
          audioFileName: audioFull ? audioFull.split(/[\\/]/).pop()! : null,
          subtitleFileName: subFull ? subFull.split(/[\\/]/).pop()! : null,
          materials: [],
        });
```

- [ ] **Step 2: thumbUrlOf 改素材级 + drop 回调**

把 P4a 的:
```tsx
  const thumbUrlOf = (i: number) =>
    (draft.taskId && draft.state === 'ready' ? videoGeneration.thumbUrl(draft.taskId, i, 0) : null);
```
改为按 clip 的 source 解析(material_id → 素材缩略图;url → 无):
```tsx
  const videoClips = (timeline.tracks ?? []).find((t) => t.kind === 'video')?.clips ?? [];
  const thumbUrlOf = (i: number) => {
    const src = videoClips[i]?.source as { material_id?: string } | undefined;
    return src?.material_id ? videoGeneration.materialThumbUrl(src.material_id) : null;
  };
```
加 drop 回调:
```tsx
  const onDropMaterial = (m: import('./timeline/timelineEdit').DraggedMaterial) => {
    onTimelineChange(appendClipFromMaterial(timeline, m));
  };
```
(import 顶部加 `import { appendClipFromMaterial } from './timeline/timelineEdit';`。)

- [ ] **Step 3: 传 onDropMaterial 给 TimelineTracks**

`<TimelineTracks ... onTimelineChange={onTimelineChange} />` 加 `onDropMaterial={onDropMaterial}`。

- [ ] **Step 4: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm --filter @chayuan/app typecheck`
Expected: 0 错误。

- [ ] **Step 5: Commit + push**

```bash
cd /work/chayuan-desktop
git add chayuan-client/packages/app/src/features/video-generation/VgTimelineEditorPage.tsx
git commit -m "feat(client/vg): 编辑器草稿 stop_at=subtitle + 拖素材入轨回调 + 素材级缩略图

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
```

---

## Task 10: 联调验证

- [ ] **Step 1: 全量 typecheck + 单测 + 构建**

Run:
```bash
cd /work/chayuan-desktop/chayuan-client
pnpm --filter @chayuan/app typecheck && pnpm --filter @chayuan/api typecheck
pnpm exec vitest run packages/app/src/features/video-generation/timeline
cd /work/chayuan-desktop/chayuan-server
PYTHONPATH="libs/chayuan-server" python -m pytest -q libs/chayuan-server/tests/unit_tests/test_vg_p5a_render.py libs/chayuan-server/tests/unit_tests/test_vg_finalize.py
cd /work/chayuan-desktop/chayuan-client && pnpm run build:web 2>&1 | tail -3
```
Expected: typecheck 0;前端 timeline 单测全 PASS(timelineEdit 9 + scale 4 + srt 3);后端 P5a render 2 + finalize 6;web build `✓ built`。

- [ ] **Step 2: 手动验收清单(重建前端 + 重启 sidecar 后)**

- 对话生成脚本 → 消息卡片下有「自动生成视频」+「去编辑合成」两按钮。
- 点「去编辑合成」→ 进时间轴;旁白轨显"⏳ 正在生成旁白…"→ 完成回填波形;字幕轨回填 cue;BGM 轨显已选音乐;视频轨**空**显"拖素材到此处";字幕轨在**最下**。
- 从左侧素材库**拖** video/image 到视频轨 → 出现 clip(视频带首帧缩略图 / 图像显原图)。
- 拖入后 P3 编辑(排序/裁/删)可用;改动后预览显"重新生成预览"。
- 「提交合成」→ finalize 复用旁白/字幕 + 手拖 EDL(含图像 ImageClip)→「我的视频」出片。
- 「自动生成视频」仍走原全自动弹框路径不受影响。

- [ ] **Step 3: 最终推送(若联调有微调)**

```bash
cd /work/chayuan-desktop
git add -A && git commit -m "fix(vg): P5a 联调微调" && git push origin main
```

---

## Self-Review

**Spec coverage(对照 design):**
- ① 两按钮 + 去编辑合成数据流 → Task 6(VgMessageExtras 重命名+新按钮、VgChatPage 写 script+resetDraft+goTimeline)。✓
- ② stop_at=subtitle + 旁白等待/回填 + finalize 放宽 → Task 9(stop_at=subtitle)、Task 2(finalize 放宽);旁白等待/回填沿用 P4a。✓
- ③ 拖素材入轨 + 图像真渲染 + 素材缩略图 → Task 5(算子+DnD 约定)、Task 7(drag source)、Task 8(drop 区)、Task 1(ImageClip)、Task 3/4/9(素材缩略图)。✓
- ④ 字幕轨下移 + BGM 显示 → Task 8(轨道顺序);BGM 显示沿用 P4a BgmTrack(Task9 仍传 bgmName)。✓
- ⑤ 错误处理 → Task 1(图像渲染失败跳过)、Task 2(空视频轨拒绝)、Task 8(drop 非法忽略)、提交禁用沿用 P4a。✓
- ⑥ 测试 → Task 1/2(pytest)、Task 5(vitest)、Task 10(全量)。✓

**Placeholder scan:** 无 TBD;各步给完整代码。少量"按现有 import 风格补 Film"是真实适配点。

**Type consistency:** `DraggedMaterial`/`VG_MATERIAL_DND_MIME`/`appendClipFromMaterial`(Task5)被 Task7(写)、Task8(读+drop)、Task9(append)一致使用;`onGoEdit`(Task6 VgMessageExtras prop)与 VgChatPage 注入一致;`vgMaterialThumbUrl`(Task4)Task9 调一致;`onDropMaterial`(Task8 props)Task9 传一致;后端 `is_image`(Task1 plan 字段)render 分支一致;`finalize_task` 放宽(Task2)与 P4a 既有调用(routes finalize)签名不变。

**依赖顺序:** 后端 1→2→3;客户端类型 4;前端算子 5;UI 6(入口)/7(drag)/8(drop+顺序)/9(编辑器接线)可在 5 之后并行概念上但按 5→7→8→9 串行实现(8 依赖 5 的 MIME/类型,9 依赖 5/8);10 联调。无循环依赖。
