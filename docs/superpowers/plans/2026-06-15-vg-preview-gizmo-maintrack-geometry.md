# VG 预览 Gizmo + 主轨几何 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 几何控件搬到视频预览(选中画面直接拖旋转/缩放/移动 + 翻转/裁剪/透明度工具条),并打通主轨几何(零回归路线 A)。

**Architecture:** 后端 `_render_main_segment` 主轨逐段(未变换照旧 resize,自由变换才合成黑底);前端 `LivePreviewCanvas` 复用 `selectedClipId` 做选中 gizmo;几何去 `isPip` 门控。字段(rotation/flip/crop)已就绪。

**Tech Stack:** React+TS+Tailwind;Python+MoviePy 2.x;后端本机无 py312(ast 语法自检 + 构建机真跑),前端 tsc+vitest。

**验证/提交:** 前端 `cd chayuan-client/packages/app && npx tsc --noEmit -p tsconfig.json`;后端 `/usr/bin/python3.11 -c "import ast;ast.parse(open(f).read(),f)"`。root 仓:sudo 改文件,提交走 bump-version + 只 stage 改动文件 + push main。

---

### Task 1:后端主轨几何(路线 A,零回归)

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/compose.py`
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_timeline_clip_geometry.py`(追加)

- [ ] **Step 1: `_build_edl_render_plan` 带几何字段**

在 plan.append({...}) 的 `"transition": ...` 后加:
```python
            "rotation": float(getattr(c, "rotation", 0.0) or 0.0),
            "flip_h": bool(getattr(c, "flip_h", False)),
            "flip_v": bool(getattr(c, "flip_v", False)),
            "crop": (c.crop.model_dump() if getattr(c, "crop", None) else None),
            "opacity": float(getattr(c, "opacity", 1.0) or 1.0),
            "x": float(getattr(c, "x", 0.0) or 0.0),
            "y": float(getattr(c, "y", 0.0) or 0.0),
            "scale": float(getattr(c, "scale", 1.0) or 1.0),
```

- [ ] **Step 2: 新增 `_render_main_segment`(放在 `_apply_pip_geometry` 之后)**

```python
def _render_main_segment(clip, item, W, H):
    """主轨单段渲染:crop/flip/rotate 总应用;有自由变换(scale/位置/opacity)则合成黑底,否则 resize 填满。"""
    clip = _apply_pip_geometry(clip, item)
    scale = float(item.get("scale", 1.0) or 1.0)
    x = float(item.get("x", 0.0) or 0.0)
    y = float(item.get("y", 0.0) or 0.0)
    op = float(item.get("opacity", 1.0) or 1.0)
    free = scale < 0.999 or abs(x) > 1e-3 or abs(y) > 1e-3 or op < 0.999
    if not free:
        return clip.resized(new_size=(W, H))
    inner = clip.resized(width=max(2, int(W * max(0.05, min(1.0, scale)))))
    inner = inner.with_position((int(x * W), int(y * H)))
    if op < 0.999 and hasattr(inner, "with_opacity"):
        try: inner = inner.with_opacity(op)
        except Exception: pass  # noqa: BLE001
    base = ColorClip(size=(W, H), color=(0, 0, 0)).with_duration(clip.duration)
    return CompositeVideoClip([base, inner])
```

- [ ] **Step 3: render_from_edl 图像/视频分支接入**

图像分支:`img = ImageClip(p["path"]).with_duration(dur).resized(new_size=(video_width, video_height))` 改为
```python
                img = _render_main_segment(ImageClip(p["path"]).with_duration(dur), p, video_width, video_height)
```
视频分支:找到 `seg = clip.subclipped(start_s, end_s).resized(new_size=(video_width, video_height))`(约 550 行)改为
```python
                seg = _render_main_segment(clip.subclipped(start_s, end_s), p, video_width, video_height)
```
(若视频分支已先 subclipped 再 resized 分两行,合并为先 subclipped 后交给 `_render_main_segment`。)

- [ ] **Step 4: 追加测试(plan 字段携带)**

`test_timeline_clip_geometry.py` 追加:
```python
def test_edl_plan_carries_geometry():
    from chayuan.server.video_generation.steps.compose import _build_edl_render_plan
    tl = Timeline(tracks=[TimelineTrack(id="main", kind="video", clips=[
        TimelineClip(id="m", source={"path": "/x.mp4"}, track_start_ms=0, out_ms=3000,
                     rotation=90.0, scale=0.5, x=0.2, opacity=0.8,
                     crop={"x": 0, "y": 0, "w": 0.5, "h": 1})])])
    plan = _build_edl_render_plan(tl, "9:16", source_resolver=lambda s: s.get("path", ""))
    assert plan and plan[0]["rotation"] == 90.0 and plan[0]["scale"] == 0.5
    assert plan[0]["opacity"] == 0.8 and plan[0]["crop"] == {"x":0,"y":0,"w":0.5,"h":1}
```

- [ ] **Step 5: 语法自检(后端 pytest 本机跑不了)**

Run: `/usr/bin/python3.11 -c "import ast; ast.parse(open('chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/compose.py').read(),'x'); ast.parse(open('chayuan-server/libs/chayuan-server/tests/unit_tests/test_timeline_clip_geometry.py').read(),'y'); print('OK')"`
Expected: OK(真 pytest 在构建机 `pytest tests/unit_tests/test_timeline_clip_geometry.py`)

- [ ] **Step 6: Commit**(bump + stage compose.py + test + 5 bump 文件 + push)

---

### Task 2:前端透传 selectedClipId/onSelectClip 到预览

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/timeline/PreviewPlayer.tsx`
- Modify: `chayuan-client/packages/app/src/features/video-generation/VgTimelineEditorPage.tsx`

- [ ] **Step 1: PreviewPlayer 加 props + 转发**

props 类型加(在 onCrop 后):
```tsx
  selectedClipId: string | null;
  onSelectClip: (clipId: string | null) => void;
```
destructure 补 `selectedClipId, onSelectClip`;`<LivePreviewCanvas ... />` 加 `selectedClipId={selectedClipId} onSelectClip={onSelectClip}`。

- [ ] **Step 2: VgTimelineEditorPage 透传给 PreviewPlayer**

`<PreviewPlayer>` 的 `onCrop={onCrop}` 后加:
```tsx
                  selectedClipId={selectedClipId}
                  onSelectClip={setSelectedClipId}
```
(`selectedClipId`/`setSelectedClipId` 已存在。)

- [ ] **Step 3: typecheck**(暂会因 LivePreviewCanvas 未加 props 报错 → Task 3 一并解决;Task2+3 合并为一个 commit)

---

### Task 3:LivePreviewCanvas 预览 Gizmo

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/timeline/LivePreviewCanvas.tsx`

- [ ] **Step 1: props 加 selectedClipId/onSelectClip + import 图标**

props 类型加 `selectedClipId?: string | null; onSelectClip?: (clipId: string | null) => void;`;destructure 补。import 顶部加(从 'lucide-react')`FlipHorizontal2, FlipVertical2, Crop, RotateCw`。

- [ ] **Step 2: 新增 dragRotate**

在 `dragCrop` 之后加:
```tsx
  const dragRotate = (e: React.PointerEvent, clipId: string) => {
    e.preventDefault(); e.stopPropagation();
    const layerEl = (e.currentTarget as HTMLElement).closest('[data-cy-layer]') as HTMLElement | null;
    const r = layerEl?.getBoundingClientRect(); if (!r) return;
    const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
    const move = (ev: PointerEvent) => {
      let deg = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90; // 顶部为 0
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      onTransform(clipId, { rotation: Math.max(-180, Math.min(180, Math.round(deg))) } as { rotation?: number });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
```
注:`onTransform` 类型需支持 rotation/flip/opacity —— Step 3 扩展其签名。

- [ ] **Step 3: 扩展 onTransform 签名容纳几何**

把组件 props 的 `onTransform` 类型改为:
```tsx
  onTransform: (clipId: string, tf: { x?: number; y?: number; scale?: number; rotation?: number; flip_h?: boolean; flip_v?: boolean; opacity?: number }) => void;
```
对应 `VgTimelineEditorPage.onSetTransform` 与 `PreviewPlayer` 透传类型同步放宽(`onSetTransform` 内部已走 `setClipTransform`,需改为走 `patchClip` 以支持新字段:`const onSetTransform = (clipId, tf) => onTimelineChange(patchClip(timeline, clipId, tf));`,`patchClip` 已支持全部字段)。

- [ ] **Step 4: 选中态 + 点选 + gizmo**

层 div:`onPointerDown` 区分——点击(非拖)选中:加 `onClick={() => onSelectClip?.(c.id)}`。`const sel = selectedClipId === c.id;` 边框/手柄显示条件从 `group-hover` 改为 `sel || hover`(选中持久显示)。在四角手柄那段(`!editing` 分支)末尾追加旋转手柄 + 工具条(仅 `sel && !editing`):
```tsx
{sel && !editing && (
  <>
    {/* 旋转手柄:顶部中点上方 */}
    <span onPointerDown={(e) => dragRotate(e, c.id)}
      className="absolute left-1/2 -top-6 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-white bg-[var(--cy-brand-600)]" title="旋转" />
    <span className="pointer-events-none absolute left-1/2 -top-6 top-0 w-px -translate-x-1/2 bg-[var(--cy-brand-500)]" style={{ height: 24 }} />
    {/* 工具条:翻转/裁剪/透明度 */}
    <div className="absolute -bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded bg-[var(--cy-surface-base)] p-0.5 shadow ring-1 ring-[var(--cy-border-subtle)]"
      onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" title="水平翻转" onClick={() => onTransform(c.id, { flip_h: !c.flip_h })}
        className={'inline-flex h-6 w-6 items-center justify-center rounded ' + (c.flip_h ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-600)]' : 'hover:bg-[var(--cy-surface-2)]')}><FlipHorizontal2 className="h-3.5 w-3.5" /></button>
      <button type="button" title="垂直翻转" onClick={() => onTransform(c.id, { flip_v: !c.flip_v })}
        className={'inline-flex h-6 w-6 items-center justify-center rounded ' + (c.flip_v ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-600)]' : 'hover:bg-[var(--cy-surface-2)]')}><FlipVertical2 className="h-3.5 w-3.5" /></button>
      <button type="button" title="裁剪" onClick={() => onCrop && onSelectClip && (cropEditingClipId === c.id ? onToggleCropFromCanvas?.(null) : onToggleCropFromCanvas?.(c.id))}
        className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--cy-surface-2)]"><Crop className="h-3.5 w-3.5" /></button>
      <span className="px-1 text-[10px] tabular-nums text-[var(--cy-text-secondary)]">{Math.round((c.opacity ?? 1) * 100)}%</span>
      <input type="range" min={0} max={1} step={0.05} value={c.opacity ?? 1}
        onChange={(e) => onTransform(c.id, { opacity: Number(e.target.value) })}
        className="h-1 w-14 accent-[var(--cy-brand-500)]" />
    </div>
  </>
)}
```
裁剪切换:复用现有 `cropEditingClipId`;新增 prop `onToggleCropFromCanvas?: (id: string | null) => void`(= VgTimelineEditorPage 的 `onToggleCropClip` 包装,接受 null)。简化:直接复用 `onToggleCropClip` 语义——在 PreviewPlayer/EditorPage 透传 `onToggleCropClip` 给 canvas,点裁剪调它。

- [ ] **Step 5: typecheck(Task2+3)**

Run: `cd chayuan-client/packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0(PreviewPlayer/LivePreviewCanvas/VgTimelineEditorPage props 全链路对齐;onTransform 放宽后 setClipTransform→patchClip 切换无类型错)

- [ ] **Step 6: Commit**(Task2+3 合并;bump + stage 三文件 + push)

---

### Task 4:几何去 isPip 门控(主轨片段 ⚙ 也显几何)

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/timeline/ClipPropertyPopover.tsx`

- [ ] **Step 1: 去掉几何块的 isPip 门控**

把几何块(旋转/翻转/裁剪)的 `{isPip && (<> ... </>)}` 改为无条件 `<> ... </>`(透明度行仍保留 `isPip` —— 透明度对主轨现也支持了,故透明度也去 isPip)。位置/缩放 grid 同理去 isPip(主轨现支持位置缩放)。即:把 ClipPropertyPopover 内所有 `isPip &&` 门控移除(主轨与 PIP 一致全显)。保留 `isPip` prop 以兼容调用,不再用于门控(或删 prop + 调用处清理)。

- [ ] **Step 2: typecheck + 提交**

Run: `cd chayuan-client/packages/app && npx tsc --noEmit -p tsconfig.json` → exit 0
Commit(bump + stage ClipPropertyPopover + 调用处若改 + push)。

---

## 自审
- 后端路线A:Task1 仅在 free 时合成,默认 resize 不变 → 零回归;crop/flip/rotate 复用 _apply_pip_geometry。
- onTransform 签名放宽 + onSetTransform 改走 patchClip:覆盖 rotation/flip/opacity/位置/缩放统一写入(Task3 Step3)。
- selectedClipId 复用(时间轴与预览同一选中);裁剪模式与旋转/缩放手柄互斥(editing 时不显 gizmo,沿用 P2)。
- 主轨层 full=初始满画幅,选中调 scale/位置后 full=false 走 x/y/scale(已有逻辑)。
