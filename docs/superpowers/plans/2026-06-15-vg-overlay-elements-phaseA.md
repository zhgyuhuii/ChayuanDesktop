# VG 叠加元素 A 期(基建 + 文字) 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 视频预览叠加文字元素端到端:竖向工具条 + 叠加轨(时间段)+ 预览渲染&几何手柄 + 后端 TextClip 合成;其余 type 数据预留、UI 占位。

**Architecture:** `Timeline.overlays: VgOverlay[]` 扁平列表(一条叠加 lane 呈现);前端 `overlayEdit` 编辑、`OverlayToolbar` 竖向工具条、`LivePreviewCanvas` 渲染+复用 gizmo、`TimelineTracks` 叠加 lane;后端 `_render_overlays`(text)在 `generate_video` 字幕合成后注入,overlays 经 `render_from_edl` 从 timeline 传入。

**Tech Stack:** React+TS(前端,vitest/tsc);Python+MoviePy(后端,ast 自检+构建机真跑)。root 仓:sudo 改 + bump-version + 只 stage 改动 + push main。

---

### Task 1:后端 schema(VgOverlay + Timeline.overlays)

**Files:** Modify `schemas.py`;Test `tests/unit_tests/test_vg_overlay.py`

- [ ] **Step 1: 加 schema** —— 在 `Timeline` 之前加 `VgOverlay`,`Timeline` 加 `overlays`:
```python
class VgOverlay(BaseModel):
    id: str
    type: str = "text"
    track_start_ms: int = 0
    duration_ms: int = 3000
    x: float = 0.1
    y: float = 0.1
    w: float = 0.5
    h: float = 0.2
    rotation: float = 0.0
    opacity: float = 1.0
    z: int = 0
    text: str = ""
    font_name: str = ""
    font_size: int = 48
    text_color: str = "#ffffff"
    stroke_color: str = "#000000"
    stroke_width: float = 1.5
    bg: Optional[str] = None
    align: str = "center"
```
`Timeline` 类体加 `overlays: List[VgOverlay] = Field(default_factory=list)`。
- [ ] **Step 2: 测试**
```python
# tests/unit_tests/test_vg_overlay.py
from chayuan.server.video_generation.schemas import VgOverlay, Timeline
def test_overlay_defaults():
    o = VgOverlay(id="o1")
    assert o.type == "text" and o.duration_ms == 3000 and o.font_size == 48
def test_timeline_overlays():
    t = Timeline(overlays=[{"id": "o1", "text": "hi"}])
    assert len(t.overlays) == 1 and t.overlays[0].text == "hi"
```
- [ ] **Step 3: ast 自检** `/usr/bin/python3.11 -c "import ast; [ast.parse(open(f).read(),f) for f in ['chayuan/server/video_generation/schemas.py','tests/unit_tests/test_vg_overlay.py']]; print('OK')"`(真 pytest 构建机)。
- [ ] **Step 4: Commit**。

### Task 2:后端 _render_overlays(text)+ 注入

**Files:** Modify `steps/compose.py`(新 `_render_overlays` + `generate_video` 注入 + `render_from_edl` 传 overlays)

- [ ] **Step 1: 加 `_render_overlays`(放 generate_video 之前)**
```python
def _render_overlays(video_clip, overlays, W, H, font_path):
    """A 期只渲染 type=='text' 的叠加元素;其它 type 跳过(B-D 期)。失败跳过单个。"""
    if not overlays:
        return video_clip
    clips = []
    for ov in overlays:
        try:
            if getattr(ov, "type", "text") != "text":
                continue
            txt = (getattr(ov, "text", "") or "").strip()
            if not txt:
                continue
            start_s = max(0.0, (getattr(ov, "track_start_ms", 0) or 0) / 1000.0)
            dur = max(0.2, (getattr(ov, "duration_ms", 3000) or 3000) / 1000.0)
            w_px = max(2, int((getattr(ov, "w", 0.5) or 0.5) * W))
            ov_font = getattr(ov, "font_name", "") or ""
            if ov_font and not os.path.isfile(ov_font):
                cand = os.path.join(utils.font_dir(), ov_font)
                ov_font = cand if os.path.isfile(cand) else font_path
            tc = TextClip(
                text=txt, font=(ov_font or font_path),
                font_size=int(getattr(ov, "font_size", 48) or 48),
                color=getattr(ov, "text_color", "#ffffff") or "#ffffff",
                stroke_color=getattr(ov, "stroke_color", "#000000") or "#000000",
                stroke_width=float(getattr(ov, "stroke_width", 1.5) or 0),
                bg_color=(getattr(ov, "bg", None) or None),
                method="caption", size=(w_px, None),
                text_align=getattr(ov, "align", "center") or "center",
            )
            tc = tc.with_start(start_s).with_end(start_s + dur)
            tc = tc.with_position((int((getattr(ov, "x", 0.1) or 0) * W), int((getattr(ov, "y", 0.1) or 0) * H)))
            rot = float(getattr(ov, "rotation", 0.0) or 0.0)
            if abs(rot) > 0.01:
                tc = tc.rotated(rot)
            op = float(getattr(ov, "opacity", 1.0) or 1.0)
            if op < 0.999 and hasattr(tc, "with_opacity"):
                tc = tc.with_opacity(op)
            clips.append(tc)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[overlay] 跳过一个叠加元素: %s", exc)
    return CompositeVideoClip([video_clip, *clips]) if clips else video_clip
```
- [ ] **Step 2: generate_video 注入** —— `generate_video(...)` 签名加 `overlays=None`;在字幕合成块(`video_clip = CompositeVideoClip([video_clip, *text_clips])` 那段)**之后**插:
```python
    try:
        video_clip = _render_overlays(video_clip, overlays or [], video_width, video_height, font_path)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[overlay] 渲染叠加失败,跳过: %s", exc)
```
- [ ] **Step 3: render_from_edl 传 overlays** —— `render_from_edl` 调 `generate_video(...)` 处加 `overlays=getattr(timeline, "overlays", None)`(两处调用都加;非 timeline 的调用传 None)。
- [ ] **Step 4: ast 自检 + Commit**。

### Task 3:前端 API 类型 + overlayEdit

**Files:** Modify `packages/api/src/videoGeneration.ts`;Create `packages/app/.../timeline/overlayEdit.ts`;Test `timeline/overlayEdit.test.ts`

- [ ] **Step 1: API 类型** —— 加 `VgOverlay`(字段同后端,均可选除 id/type)+ `VgTimeline.overlays?: VgOverlay[]`。
- [ ] **Step 2: overlayEdit.ts**
```ts
import type { VgTimeline, VgOverlay } from '@chayuan/api';
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
let _seq = 0;
export function addOverlay(t: VgTimeline, type: VgOverlay['type'], atMs: number): { timeline: VgTimeline; id: string } {
  const id = `ov-${atMs}-${_seq++}`;
  const ov: VgOverlay = { id, type, track_start_ms: Math.max(0, Math.round(atMs)), duration_ms: 3000,
    x: 0.25, y: 0.4, w: 0.5, h: 0.2, rotation: 0, opacity: 1, z: 0,
    text: type === 'text' ? '双击编辑文字' : '', font_size: 48, text_color: '#ffffff',
    stroke_color: '#000000', stroke_width: 1.5, align: 'center' };
  return { timeline: { ...t, overlays: [...(t.overlays || []), ov] }, id };
}
export type OverlayPatch = Partial<Omit<VgOverlay, 'id'>>;
export function patchOverlay(t: VgTimeline, id: string, patch: OverlayPatch): VgTimeline {
  return { ...t, overlays: (t.overlays || []).map((o) => {
    if (o.id !== id) return o;
    const n = { ...o, ...patch };
    if (patch.x !== undefined) n.x = clampN(patch.x, 0, 1);
    if (patch.y !== undefined) n.y = clampN(patch.y, 0, 1);
    if (patch.w !== undefined) n.w = clampN(patch.w, 0.02, 1);
    if (patch.h !== undefined) n.h = clampN(patch.h, 0.02, 1);
    if (patch.opacity !== undefined) n.opacity = clampN(patch.opacity, 0, 1);
    if (patch.rotation !== undefined) n.rotation = clampN(patch.rotation, -180, 180);
    if (patch.duration_ms !== undefined) n.duration_ms = Math.max(200, Math.round(patch.duration_ms));
    if (patch.track_start_ms !== undefined) n.track_start_ms = Math.max(0, Math.round(patch.track_start_ms));
    return n;
  }) };
}
export function deleteOverlay(t: VgTimeline, id: string): VgTimeline {
  return { ...t, overlays: (t.overlays || []).filter((o) => o.id !== id) };
}
```
- [ ] **Step 3: vitest**
```ts
import { describe, it, expect } from 'vitest';
import { addOverlay, patchOverlay, deleteOverlay } from './overlayEdit';
const t0 = { version: 1, duration_ms: 0, tracks: [] } as any;
it('addOverlay 加文字默认 3s', () => {
  const { timeline, id } = addOverlay(t0, 'text', 1000);
  expect(timeline.overlays!.length).toBe(1);
  expect(timeline.overlays![0].duration_ms).toBe(3000);
  expect(timeline.overlays![0].track_start_ms).toBe(1000);
  expect(id).toBeTruthy();
});
it('patchOverlay clamp', () => {
  const { timeline, id } = addOverlay(t0, 'text', 0);
  const r = patchOverlay(timeline, id, { x: 2, opacity: -1, w: 0, duration_ms: 50 });
  const o = r.overlays![0];
  expect(o.x).toBe(1); expect(o.opacity).toBe(0); expect(o.w).toBe(0.02); expect(o.duration_ms).toBe(200);
});
it('deleteOverlay', () => {
  const { timeline, id } = addOverlay(t0, 'text', 0);
  expect(deleteOverlay(timeline, id).overlays!.length).toBe(0);
});
```
- [ ] **Step 4: vitest + api/app tsc + Commit**。

### Task 4:竖向工具条 + 预览渲染&手柄

**Files:** Create `timeline/OverlayToolbar.tsx`;Modify `timeline/LivePreviewCanvas.tsx`、`timeline/PreviewPlayer.tsx`、`VgTimelineEditorPage.tsx`

- [ ] **Step 1: 编辑器状态** —— `VgTimelineEditorPage` 加 `selectedOverlayId` 状态;`onOverlayTransform=(id,tf)=>onTimelineChange(patchOverlay(timeline,id,tf))`;`onAddOverlay=(type)=>{const {timeline:tl,id}=addOverlay(timeline,type,playheadMs); onTimelineChange(tl); setSelectedOverlayId(id); setSelectedClipId(null);}`;选 overlay 时清 `selectedClipId`,反之亦然(互斥)。
- [ ] **Step 2: OverlayToolbar** —— 竖排 rail(选择/文字可用;矩形/椭圆/直线/箭头/贴纸/马赛克 disabled+「即将上线」tooltip),`onAddOverlay('text')`。
- [ ] **Step 3: LivePreviewCanvas 渲染** —— 加 props `overlays/selectedOverlayId/onSelectOverlay/onOverlayTransform`;渲染 `(overlays||[]).filter(o=>playheadMs>=o.track_start_ms && playheadMs<o.track_start_ms+o.duration_ms)`,每个 absolute div(left/top/width/height = x/y/w/h*100%,transform rotate,opacity),text 显文字(color/`-webkit-text-stroke`/text-shadow/bg/align);选中显几何手柄(复用 drag/dragRotate,写 onOverlayTransform)+ 双击 text 进 `contentEditable` 改 `text`(blur 写回)。OverlayToolbar 贴 boxRef 左缘。
- [ ] **Step 4: PreviewPlayer 透传** + 编辑器把 `overlays={timeline.overlays} selectedOverlayId onSelectOverlay onOverlayTransform onAddOverlay` 传下去。
- [ ] **Step 5: app tsc + Commit**。

### Task 5:时间轴叠加 lane

**Files:** Modify `timeline/TimelineTracks.tsx`(叠加 lane)、`VgTimelineEditorPage.tsx`(透传 overlays + 选中 + move/resize/delete)

- [ ] **Step 1: 叠加 lane** —— 在字幕轨附近加一条「叠加」lane:`(overlays||[]).map` 每个一个 absolute 条(left=start*pxPerSec、width=dur*pxPerSec),显 type 图标+文字首几字;点=选中(`onSelectOverlay`);左右把手拖改 `track_start_ms`/`duration_ms`(走 `patchOverlay`,复用现有 clip 拖拽范式);选中 Delete 键删(`deleteOverlay`)。
- [ ] **Step 2: 透传** —— 编辑器把 overlays/selectedOverlayId/onSelectOverlay/onTimelineChange 传 TimelineTracks;TimelineTracks 渲染 lane。
- [ ] **Step 3: app tsc + 手动(重建+重启 sidecar)** —— 点文字工具→预览出文字框、双击改字、拖几何手柄;叠加轨拖条改时间;成片时间段内显文字。Commit。

## 自审
- spec ① 数据模型 → Task1(schema)+Task3(api/edit);② 工具条 → Task4 OverlayToolbar;③ 预览渲染+手柄 → Task4;④ 叠加轨 → Task5;⑤ 后端 → Task2。全覆盖。
- 类型一致:`VgOverlay` 字段后端(Task1)/前端(Task3)同名;`patchOverlay`/`addOverlay`/`deleteOverlay` 签名 Task3 定义、Task4/5 调用一致;`_render_overlays(video_clip,overlays,W,H,font_path)` Task2 内自洽 + generate_video 注入。
- 互斥:selectedOverlayId 与 selectedClipId 二选一(Task4 Step1)。
- ⚠ 后端 pytest 本机跑不了;ast 自检 + 真跑构建机;真机成片待重建。B/C/D type:数据预留、工具条占位、_render_overlays 跳过。
