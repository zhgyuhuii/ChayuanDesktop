# VG 工具栏精致化 + 几何变换(P2) 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把视频编辑器工具栏 6 组件改成图标优先形态;给画中画层片段加旋转/翻转/裁剪几何变换(前后端穿透 + 预览拖拽裁剪框)。

**Architecture:** 子项 A 纯前端改 `TimelineToolbar.tsx` 样式。子项 B 后端 `TimelineClip` schema 加 `rotation/flip_h/flip_v/crop` + `_apply_pip_geometry` 收敛 MoviePy 变换(两条合成路径共用);前端类型/`patchClip` clamp/属性面板控件/预览 transform+clip-path+裁剪框逐层接入。几何仅作用于 PIP(第 2+ 视频轨)。

**Tech Stack:** React 19 + TS + Tailwind(前端);Python + Pydantic v2 + MoviePy 2.x(后端);vitest(前端单测)+ pytest(后端单测)。

**验证环境:** 前端 `cd chayuan-client/packages/app && npx tsc --noEmit -p tsconfig.json`;vitest 见各任务。后端 `PYTHONPATH=/work/chayuan-desktop/chayuan-server/libs/chayuan-server python -m pytest <file> -q`(本机 root conda py312,见 memory reference_py312_test_env)。仓库 root 所有:改文件用 sudo,提交按 commit-procedure-chayuan-desktop(sudo + bump-version + 只 stage 改动文件)。

---

## 子项 A:TimelineToolbar 精致化

### Task A1:6 组件改图标优先

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/timeline/TimelineToolbar.tsx`

- [ ] **Step 1: 改 import 与样式常量**

把 import 行的图标补上 `Wand2`(生成脚本用,避开右侧提交合成的 `Sparkles`),删掉不再用的 `FileText` 保留(编辑脚本仍用)。新增统一的 icon-only 样式:

```tsx
import { Film, ChevronUp, ChevronDown, Sparkles, Wand2, FileText, Captions, Volume2, Type, Music, Loader2 } from 'lucide-react';

// icon-only ghost:动作类(无选中态)
const iconBtn =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)] transition-colors';
// icon-only 开关:设置类(单选,选中=brand-50)
const iconToggle = (active: boolean) =>
  'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ' +
  (active
    ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-600)]'
    : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)] hover:text-[var(--cy-text-primary)]');
```

- [ ] **Step 2: 动作类三按钮改 icon-only**

替换 生成脚本/编辑脚本/编辑字幕 三个 `editBtn` 按钮(原 50–58 行)为:

```tsx
<button type="button" onClick={onScriptGen} className={iconBtn} title="生成脚本" aria-label="生成脚本">
  <Wand2 className="h-4 w-4" />
</button>
<button type="button" onClick={onScriptEdit} className={iconBtn} title="编辑脚本" aria-label="编辑脚本">
  <FileText className="h-4 w-4" />
</button>
<button type="button" onClick={onSubtitleEdit} className={iconBtn} title="编辑字幕" aria-label="编辑字幕">
  <Captions className="h-4 w-4" />
</button>
```

- [ ] **Step 3: 设置开关类改 icon-only(保留单选语义)**

把 `SETTINGS.map(...)` 渲染体改为图标按钮(标签移到 title/aria-label):

```tsx
{SETTINGS.map(([k, label, Icon]) => {
  const active = settingsPanel === k;
  return (
    <button key={k} type="button"
      onClick={() => onSettingsPanel(active ? null : k)}
      aria-pressed={active} title={`${label}设置`} aria-label={`${label}设置`}
      className={iconToggle(active)}>
      <Icon className="h-4 w-4" />
    </button>
  );
})}
```

`SETTINGS` 常量、props、`editBtn` 之外的结构都不动;`editBtn` 常量删除(已无引用)。「提交合成」按钮、「时间轴」标题、展开/折叠 toggle 不改。

- [ ] **Step 4: typecheck**

Run: `cd chayuan-client/packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0(无 TimelineToolbar 报错;`editBtn` 删除后无 "unused" 因 tsc 不报未用 const,但确认无 "Cannot find name Wand2" 等)

- [ ] **Step 5: 手动核对(dev HMR)**

工具栏 6 个图标:hover 出中文 tooltip;语音/字幕/背景音乐单选(选中 brand-50、再点收起、互斥);生成/编辑脚本、编辑字幕点击开各自弹窗;提交合成不变。

- [ ] **Step 6: Commit**

```bash
sudo python3.11 scripts/bump-version.py
sudo git add -- VERSION chayuan-client/apps/desktop/src-tauri/tauri.conf.json chayuan-client/apps/installer/src-tauri/tauri.conf.json chayuan-client/apps/publisher/src-tauri/tauri.conf.json chayuan-server/libs/chayuan-server/pyproject.toml chayuan-client/packages/app/src/features/video-generation/timeline/TimelineToolbar.tsx
sudo git commit -m "feat(vg): TimelineToolbar 6 组件改图标优先(icon-only + tooltip)"
sudo git push origin main
```

---

## 子项 B:几何变换(PIP 层)

### Task B1:后端 schema 加 CropRect + 4 字段

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/schemas.py:131-147`(TimelineClip)
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_timeline_clip_geometry.py`(新建)

- [ ] **Step 1: 写失败测试**

```python
# tests/unit_tests/test_timeline_clip_geometry.py
from chayuan.server.video_generation.schemas import TimelineClip, CropRect

def test_clip_geometry_defaults():
    c = TimelineClip(id="x", source={}, track_start_ms=0)
    assert c.rotation == 0.0
    assert c.flip_h is False and c.flip_v is False
    assert c.crop is None

def test_clip_geometry_set():
    c = TimelineClip(id="x", source={}, track_start_ms=0,
                     rotation=90.0, flip_h=True,
                     crop={"x": 0.1, "y": 0.2, "w": 0.5, "h": 0.5})
    assert c.rotation == 90.0 and c.flip_h is True
    assert isinstance(c.crop, CropRect) and c.crop.w == 0.5
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH=/work/chayuan-desktop/chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_timeline_clip_geometry.py -q`
Expected: FAIL(`ImportError: cannot import name 'CropRect'`)

- [ ] **Step 3: 加 schema**

在 `schemas.py` `TimelineClip` 之前加 `CropRect`,并在 `TimelineClip` 类体(opacity 字段后)加 4 个字段:

```python
class CropRect(BaseModel):
    x: float = 0.0   # 保留区左上角(归一 0-1)
    y: float = 0.0
    w: float = 1.0   # 保留区尺寸(归一 0-1)
    h: float = 1.0

# —— TimelineClip 类体内,opacity 后追加 ——
    rotation: float = 0.0            # 顺时针角度 -180..180(PIP 层)
    flip_h: bool = False             # 水平镜像
    flip_v: bool = False             # 垂直镜像
    crop: CropRect | None = None     # 归一保留区;None=全幅
```

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2
Expected: PASS(2 passed)

- [ ] **Step 5: Commit**

```bash
sudo python3.11 scripts/bump-version.py
sudo git add -- VERSION chayuan-client/apps/desktop/src-tauri/tauri.conf.json chayuan-client/apps/installer/src-tauri/tauri.conf.json chayuan-client/apps/publisher/src-tauri/tauri.conf.json chayuan-server/libs/chayuan-server/pyproject.toml chayuan-server/libs/chayuan-server/chayuan/server/video_generation/schemas.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_timeline_clip_geometry.py
sudo git commit -m "feat(vg): TimelineClip 加 rotation/flip_h/flip_v/crop(CropRect)"
sudo git push origin main
```

### Task B2:后端 compose 应用几何(两路径共用)

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/compose.py`(import vfx;`_build_pip_layers` 带字段;新增 `_apply_pip_geometry`;正式合成 ~585-603 与代理预览 ~705+ 两处接入)
- Test: `tests/unit_tests/test_timeline_clip_geometry.py`(追加 _build_pip_layers 字段携带测试)

- [ ] **Step 1: 追加失败测试**

```python
def test_pip_layers_carry_geometry():
    from chayuan.server.video_generation.steps.compose import _build_pip_layers
    from chayuan.server.video_generation.schemas import Timeline, TimelineTrack, TimelineClip
    tl = Timeline(tracks=[
        TimelineTrack(id="main", kind="video", clips=[
            TimelineClip(id="m", source={"path": "/x.mp4"}, track_start_ms=0)]),
        TimelineTrack(id="pip", kind="video", clips=[
            TimelineClip(id="p", source={"path": "/p.mp4"}, track_start_ms=0, out_ms=2000,
                         rotation=45.0, flip_h=True, crop={"x": 0.1, "y": 0.0, "w": 0.8, "h": 0.9})]),
    ])
    layers = _build_pip_layers(tl, source_resolver=lambda s: s.path)
    assert len(layers) == 1
    ly = layers[0]
    assert ly["rotation"] == 45.0 and ly["flip_h"] is True and ly["flip_v"] is False
    assert ly["crop"] == {"x": 0.1, "y": 0.0, "w": 0.8, "h": 0.9}
```

- [ ] **Step 2: 跑确认失败**

Run: `PYTHONPATH=/work/chayuan-desktop/chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_timeline_clip_geometry.py::test_pip_layers_carry_geometry -q`
Expected: FAIL(`KeyError: 'rotation'`)

- [ ] **Step 3: import vfx**

`compose.py` 顶部 moviepy import 块把 `afx,` 改成 `afx,` 下一行加 `vfx,`(moviepy 2.x `from moviepy import (... afx, vfx)`)。

- [ ] **Step 4: _build_pip_layers 带几何字段**

在 `layers.append({...})` 字典里 `"opacity": ...` 后追加:

```python
                "rotation": float(getattr(c, "rotation", 0.0) or 0.0),
                "flip_h": bool(getattr(c, "flip_h", False)),
                "flip_v": bool(getattr(c, "flip_v", False)),
                "crop": (c.crop.model_dump() if getattr(c, "crop", None) else None),
```

- [ ] **Step 5: 跑确认通过**

Run: 同 Step 2
Expected: PASS

- [ ] **Step 6: 新增 _apply_pip_geometry 并在两路径接入**

在 `_build_pip_layers` 之后加:

```python
def _apply_pip_geometry(clip, ly):
    """对 PIP clip 按固定顺序应用 crop -> flip -> rotate(在 resize 之前)。"""
    crop = ly.get("crop")
    if crop:
        W, H = clip.w, clip.h
        x1, y1 = int(crop["x"] * W), int(crop["y"] * H)
        x2, y2 = int((crop["x"] + crop["w"]) * W), int((crop["y"] + crop["h"]) * H)
        if x2 > x1 and y2 > y1:
            clip = clip.cropped(x1=x1, y1=y1, x2=x2, y2=y2)
    eff = []
    if ly.get("flip_h"): eff.append(vfx.MirrorX())
    if ly.get("flip_v"): eff.append(vfx.MirrorY())
    if eff: clip = clip.with_effects(eff)
    rot = ly.get("rotation") or 0.0
    if abs(rot) > 0.01: clip = clip.rotated(rot)
    return clip
```

在**正式合成**路径(`oc = ImageClip(...)` / `oc = _open_video_clip_quietly(...)` + 可能的 `subclipped` 之后、`oc = oc.resized(width=w)...` 之前)插入:

```python
                oc = _apply_pip_geometry(oc, ly)
```

在**低清代理预览**路径(约 705+ 行,同样在打开 clip 之后、`resized` 之前)插入相同一行 `oc = _apply_pip_geometry(oc, ly)`。

- [ ] **Step 7: py_compile + 跑全测试文件**

Run: `PYTHONPATH=/work/chayuan-desktop/chayuan-server/libs/chayuan-server python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/compose.py && PYTHONPATH=/work/chayuan-desktop/chayuan-server/libs/chayuan-server python -m pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_timeline_clip_geometry.py -q`
Expected: 编译无错;3 passed

- [ ] **Step 8: Commit**

```bash
sudo python3.11 scripts/bump-version.py
sudo git add -- VERSION chayuan-client/apps/desktop/src-tauri/tauri.conf.json chayuan-client/apps/installer/src-tauri/tauri.conf.json chayuan-client/apps/publisher/src-tauri/tauri.conf.json chayuan-server/libs/chayuan-server/pyproject.toml chayuan-server/libs/chayuan-server/chayuan/server/video_generation/steps/compose.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_timeline_clip_geometry.py
sudo git commit -m "feat(vg): PIP 合成应用 crop/flip/rotate(_apply_pip_geometry,两路径共用)"
sudo git push origin main
```

### Task B3:前端类型 + patchClip clamp

**Files:**
- Modify: `chayuan-client/packages/api/src/videoGeneration.ts:60-76`(VgTimelineClip)
- Modify: `chayuan-client/packages/app/src/features/video-generation/timeline/timelineEdit.ts:276-289`(ClipPatch + patchClip)
- Test: `chayuan-client/packages/app/src/features/video-generation/timeline/timelineEdit.test.ts`(追加)

- [ ] **Step 1: 加前端类型**

`videoGeneration.ts` `VgTimelineClip` 的 `opacity?` 后追加:

```ts
  rotation?: number;          // 顺时针角度 -180..180(PIP)
  flip_h?: boolean;           // 水平镜像
  flip_v?: boolean;           // 垂直镜像
  crop?: { x: number; y: number; w: number; h: number };  // 归一保留区
```

- [ ] **Step 2: 追加失败测试**

`timelineEdit.test.ts` 末尾追加:

```ts
it('patchClip clamp rotation[-180,180] + flip 布尔 + crop 约束', () => {
  const a = patchClip(tlPip(), 'b', { rotation: 200 }).tracks[1]!.clips![0]!;
  expect(a.rotation).toBe(180);
  const b = patchClip(tlPip(), 'b', { rotation: -999, flip_h: true }).tracks[1]!.clips![0]!;
  expect(b.rotation).toBe(-180);
  expect(b.flip_h).toBe(true);
  // crop 越界收缩:x=0.8,w 上限 = 1-0.8 = 0.2;h 下限 0.05
  const c = patchClip(tlPip(), 'b', { crop: { x: 0.8, y: 0.5, w: 0.9, h: 0.01 } }).tracks[1]!.clips![0]!.crop!;
  expect(c.x).toBe(0.8);
  expect(c.w).toBeCloseTo(0.2);
  expect(c.h).toBe(0.05);
});
```

- [ ] **Step 3: 跑确认失败**

Run: `cd chayuan-client && npx vitest run packages/app/src/features/video-generation/timeline/timelineEdit.test.ts`
Expected: FAIL(rotation undefined / 类型不含 rotation)

- [ ] **Step 4: 扩 ClipPatch + clamp**

`timelineEdit.ts`:

```ts
export type ClipPatch = Partial<Pick<VgTimelineClip, 'opacity' | 'volume' | 'muted' | 'x' | 'y' | 'scale' | 'z' | 'rotation' | 'flip_h' | 'flip_v' | 'crop'>>;
```

在 `patchClip` 的 `apply` 里 `z` 之后追加:

```ts
    if (patch.rotation !== undefined) n.rotation = clampN(patch.rotation, -180, 180);
    if (patch.flip_h !== undefined) n.flip_h = patch.flip_h;
    if (patch.flip_v !== undefined) n.flip_v = patch.flip_v;
    if (patch.crop !== undefined) {
      const x = clampN(patch.crop.x, 0, 0.95);
      const y = clampN(patch.crop.y, 0, 0.95);
      const w = clampN(patch.crop.w, 0.05, 1 - x);
      const h = clampN(patch.crop.h, 0.05, 1 - y);
      n.crop = { x, y, w, h };
    }
```

并把 276 行注释补上 rotation/crop 说明。

- [ ] **Step 5: 跑确认通过 + typecheck**

Run: `cd chayuan-client && npx vitest run packages/app/src/features/video-generation/timeline/timelineEdit.test.ts && npx tsc --noEmit -p packages/api/tsconfig.json && cd packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: vitest 全绿;两个 tsc exit 0

- [ ] **Step 6: Commit**

```bash
sudo python3.11 scripts/bump-version.py
sudo git add -- VERSION chayuan-client/apps/desktop/src-tauri/tauri.conf.json chayuan-client/apps/installer/src-tauri/tauri.conf.json chayuan-client/apps/publisher/src-tauri/tauri.conf.json chayuan-server/libs/chayuan-server/pyproject.toml chayuan-client/packages/api/src/videoGeneration.ts chayuan-client/packages/app/src/features/video-generation/timeline/timelineEdit.ts chayuan-client/packages/app/src/features/video-generation/timeline/timelineEdit.test.ts
sudo git commit -m "feat(vg): VgTimelineClip 几何字段 + patchClip clamp(rotation/flip/crop)"
sudo git push origin main
```

### Task B4:ClipPropertyPopover 几何控件

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/timeline/ClipPropertyPopover.tsx`

接收新 prop:`cropEditing: boolean`、`onToggleCrop: () => void`(裁剪模式由父级 VgTimelineEditorPage 管,见 B5)。

- [ ] **Step 1: 加 props + 图标 import**

```tsx
import { Volume2, VolumeX, RotateCw, FlipHorizontal2, FlipVertical2, Crop } from 'lucide-react';
// props 接口加:
  cropEditing: boolean;
  onToggleCrop: () => void;
```

- [ ] **Step 2: 在 isPip 区块加几何控件**

在现有 `isPip &&` 的位置/缩放网格附近、透明度行之后,加一段(仅 `isPip` 渲染):

```tsx
{isPip && (
  <>
    <label className="mb-1 flex items-center gap-2">
      <RotateCw className="h-3.5 w-3.5 shrink-0 text-[var(--cy-text-tertiary)]" />
      <input type="range" min={-180} max={180} step={1} value={clip.rotation ?? 0}
        onChange={(e) => set({ rotation: Number(e.target.value) })}
        className="flex-1 accent-[var(--cy-brand-500)]" />
      <span className="w-9 shrink-0 text-right tabular-nums">{Math.round(clip.rotation ?? 0)}°</span>
    </label>
    <div className="mb-1 flex items-center gap-1">
      <button type="button" title="水平翻转" aria-pressed={!!clip.flip_h}
        onClick={() => set({ flip_h: !clip.flip_h })}
        className={'inline-flex h-7 w-7 items-center justify-center rounded ' + (clip.flip_h ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-600)]' : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]')}>
        <FlipHorizontal2 className="h-3.5 w-3.5" />
      </button>
      <button type="button" title="垂直翻转" aria-pressed={!!clip.flip_v}
        onClick={() => set({ flip_v: !clip.flip_v })}
        className={'inline-flex h-7 w-7 items-center justify-center rounded ' + (clip.flip_v ? 'bg-[var(--cy-brand-50)] text-[var(--cy-brand-600)]' : 'text-[var(--cy-text-tertiary)] hover:bg-[var(--cy-surface-2)]')}>
        <FlipVertical2 className="h-3.5 w-3.5" />
      </button>
      <button type="button" title={cropEditing ? '完成裁剪' : '裁剪(在预览里拖框)'} aria-pressed={cropEditing}
        onClick={onToggleCrop}
        className={'ml-auto inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] ' + (cropEditing ? 'bg-[var(--cy-brand-500)] text-white' : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]')}>
        <Crop className="h-3.5 w-3.5" /> {cropEditing ? '完成裁剪' : '裁剪'}
      </button>
    </div>
  </>
)}
```

- [ ] **Step 3: typecheck**

Run: `cd chayuan-client/packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0(VgTimeline.tsx 调用处 B5 会补 props;若此时报 "缺少 cropEditing"，B5 一并解决——按顺序先做 B5 的父级接线或同 commit）

注:B4 与 B5 互相依赖(props 双向),作为**同一个 commit** 一起完成更稳;下面 B5 完成后统一 typecheck + commit。

### Task B5:LivePreviewCanvas transform + clip-path + 裁剪框 + 父级状态

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/timeline/VgTimelineEditorPage.tsx`(`cropEditingClipId` 状态 + 透传 ClipPropertyPopover via VgTimeline + LivePreviewCanvas)
- Modify: `chayuan-client/packages/app/src/features/video-generation/timeline/VgTimeline.tsx`(把 cropEditing/onToggleCrop 透传给 ClipPropertyPopover)
- Modify: `chayuan-client/packages/app/src/features/video-generation/timeline/LivePreviewCanvas.tsx`(图层 transform + clip-path;裁剪模式叠裁剪框)

- [ ] **Step 1: 父级状态贯通**

`VgTimelineEditorPage.tsx` 加 `const [cropEditingClipId, setCropEditingClipId] = React.useState<string | null>(null);`,Esc 时清空;把 `cropEditingClipId` + `setCropEditingClipId` 透传给 `VgTimeline`(用于 ClipPropertyPopover 的 cropEditing/onToggleCrop)与 `LivePreviewCanvas`(用于显示裁剪框)。`VgTimeline` 把 `cropEditing={cropEditingClipId === clip.id}` 与 `onToggleCrop={() => setCropEditingClipId(id => id === clipId ? null : clipId)}` 传给 `ClipPropertyPopover`。

- [ ] **Step 2: LivePreviewCanvas 图层叠 transform + clip-path**

`LivePreviewCanvas.tsx` 图层 style(现有 `opacity: c.opacity ?? 1` 那处)加:

```tsx
              transform: `rotate(${c.rotation ?? 0}deg) scaleX(${c.flip_h ? -1 : 1}) scaleY(${c.flip_v ? -1 : 1})`,
              // 非裁剪编辑态才套 clip-path 显示保留区;编辑态显示完整源便于拖框
              clipPath: (c.crop && cropEditingClipId !== c.id)
                ? `inset(${c.crop.y * 100}% ${(1 - (c.crop.x + c.crop.w)) * 100}% ${(1 - (c.crop.y + c.crop.h)) * 100}% ${c.crop.x * 100}%)`
                : undefined,
```

组件 props 加 `cropEditingClipId: string | null`、`onCrop: (clipId: string, crop: {x:number;y:number;w:number;h:number}) => void`。

- [ ] **Step 3: 裁剪框 overlay(复用 drag 基建)**

当 `cropEditingClipId === c.id`:该图层隐藏现有 move/scale 手柄,叠一个裁剪矩形(初值 = `c.crop ?? {x:0,y:0,w:1,h:1}`),矩形可拖移(改 x/y)+ 四角缩放(改 w/h),归一到图层框,实时 `onCrop(c.id, {x,y,w,h})`。复用文件内现有 `drag()` 思路新增 `dragCrop()`(move 改 x/y,corner 改 w/h,clamp 同 patchClip:x,y∈[0,0.95]、w≤1-x、h≤1-y、w/h≥0.05)。`onCrop` 在父级走 `onTimelineChange(patchClip(timeline, clipId, { crop }))`。

- [ ] **Step 4: typecheck(含 B4)**

Run: `cd chayuan-client/packages/app && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0(ClipPropertyPopover/VgTimeline/LivePreviewCanvas/VgTimelineEditorPage 全链路 props 对齐)

- [ ] **Step 5: 手动核对(用户重建 desktop + 重启 sidecar)**

选中 PIP 片段 → 属性面板:旋转滑条 → 预览实时转;水平/垂直翻转 → 预览镜像;点「裁剪」→ 预览显示完整源 + 裁剪框,拖框/缩角 → clip-path 实时反映,「完成裁剪」退出;提交合成后成片几何与预览一致(允许旋转角点轻微差异);主轨片段不显几何控件。

- [ ] **Step 6: Commit(B4+B5 合并)**

```bash
sudo python3.11 scripts/bump-version.py
sudo git add -- VERSION chayuan-client/apps/desktop/src-tauri/tauri.conf.json chayuan-client/apps/installer/src-tauri/tauri.conf.json chayuan-client/apps/publisher/src-tauri/tauri.conf.json chayuan-server/libs/chayuan-server/pyproject.toml chayuan-client/packages/app/src/features/video-generation/timeline/ClipPropertyPopover.tsx chayuan-client/packages/app/src/features/video-generation/timeline/VgTimeline.tsx chayuan-client/packages/app/src/features/video-generation/timeline/LivePreviewCanvas.tsx chayuan-client/packages/app/src/features/video-generation/timeline/VgTimelineEditorPage.tsx
sudo git commit -m "feat(vg): PIP 片段几何 UI(旋转/翻转控件 + 预览 transform/clip-path + 拖拽裁剪框)"
sudo git push origin main
```

---

## 自审备注
- 子项 B 字段穿透 6 处:schema(B1)、compose(B2)、API 类型(B3)、patchClip(B3)、ClipPropertyPopover(B4)、LivePreviewCanvas+父级(B5),全覆盖。
- 顺序固定 crop→flip→rotate→resize→pos→opacity,后端(B2)与预览(B5)同序;已知 CSS rotate 不扩框 vs MoviePy expand 的角点差异,spec 已注明、工具级可接受。
- crop 归一基准:编辑态显示完整源,故裁剪框坐标 = 源归一坐标 = 后端 cropped 基准。
- B4/B5 props 双向依赖 → 合并为一个 commit,统一 typecheck。
