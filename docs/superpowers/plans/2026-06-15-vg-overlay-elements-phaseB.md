# VG 叠加元素 B 期(图形:矩形/椭圆/直线/箭头) 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 A 期叠加管线上加 4 种图形(矩形/椭圆/直线/箭头)+ 选中样式条(填充/描边/颜色/字号),复用叠加轨/几何手柄。

**Architecture:** 后端 PIL 画 RGBA 图形→临时 PNG→ImageClip,扩 `_render_overlays`;前端 VgOverlay 加 fill/corner_radius,预览用 div/SVG 渲染图形,预览头部加选中元素样式条。

**Tech Stack:** Python+PIL/MoviePy(后端,ast 自检+构建机真跑);React+TS(前端,tsc)。root 仓:sudo + bump + 只 stage 改动 + push main。

---

### Task B1:后端图形渲染

**Files:** Modify `schemas.py`(VgOverlay 加 fill/corner_radius)、`steps/compose.py`(`_render_shape_image` + 扩 `_render_overlays`);Test `tests/unit_tests/test_vg_overlay.py`(追加)

- [ ] **Step 1: schema** —— `VgOverlay` 加 `fill: Optional[str] = None`(图形填充;None=无填充)、`corner_radius: float = 0.0`(矩形圆角 px)。
- [ ] **Step 2: compose import** —— `from PIL import Image, ImageFont` 改 `from PIL import Image, ImageDraw, ImageFont`;文件顶部 `import` 区加 `import tempfile`(若无)。
- [ ] **Step 3: `_render_shape_image`(放 `_render_overlays` 之前)**
```python
def _hex_rgba(s, alpha=255):
    v = str(s or "").strip().lstrip("#")
    if len(v) == 6:
        try:
            return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16), alpha)
        except ValueError:
            pass
    return None

def _render_shape_image(ov, W, H):
    """PIL 画 rect/ellipse/line/arrow 到透明 RGBA PNG,返回临时文件路径(失败 None)。"""
    try:
        w = max(2, int((getattr(ov, "w", 0.3) or 0.3) * W))
        h = max(2, int((getattr(ov, "h", 0.2) or 0.2) * H))
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        fill = _hex_rgba(getattr(ov, "fill", None)) if getattr(ov, "fill", None) else None
        sw = max(0, int(round(float(getattr(ov, "stroke_width", 1.5) or 0))))
        stroke = _hex_rgba(getattr(ov, "stroke_color", "#000000")) if sw > 0 else None
        t = getattr(ov, "type", "rect")
        m = sw // 2 + 1
        box = [m, m, w - m - 1, h - m - 1]
        if t == "rect":
            rad = max(0, int(float(getattr(ov, "corner_radius", 0.0) or 0.0)))
            d.rounded_rectangle(box, radius=rad, fill=fill, outline=stroke, width=max(1, sw) if stroke else 0)
        elif t == "ellipse":
            d.ellipse(box, fill=fill, outline=stroke, width=max(1, sw) if stroke else 0)
        elif t in ("line", "arrow"):
            col = stroke or (0, 0, 0, 255)
            y = h // 2
            d.line([(m, y), (w - m - 1, y)], fill=col, width=max(1, sw or 2))
            if t == "arrow":
                a = max(6, (sw or 2) * 3)
                d.polygon([(w - m - 1, y), (w - m - 1 - a, y - a // 2), (w - m - 1 - a, y + a // 2)], fill=col)
        fd, path = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        img.save(path)
        return path
    except Exception as exc:  # noqa: BLE001
        logger.warning("[overlay] 图形渲染失败 %s: %s", getattr(ov, "id", "?"), exc)
        return None
```
- [ ] **Step 4: 扩 `_render_overlays`** —— 在 text 分支后加图形分支(替换原 `if type!='text': continue`):
```python
            ovtype = getattr(ov, "type", "text")
            if ovtype == "text":
                ... # 原文字逻辑不变
            elif ovtype in ("rect", "ellipse", "line", "arrow"):
                sp = _render_shape_image(ov, W, H)
                if not sp:
                    continue
                start_s = max(0.0, (getattr(ov, "track_start_ms", 0) or 0) / 1000.0)
                dur = max(0.2, (getattr(ov, "duration_ms", 3000) or 3000) / 1000.0)
                tc = ImageClip(sp).with_start(start_s).with_end(start_s + dur)
                tc = tc.with_position((int((getattr(ov, "x", 0.1) or 0) * W), int((getattr(ov, "y", 0.1) or 0) * H)))
                rot = float(getattr(ov, "rotation", 0.0) or 0.0)
                if abs(rot) > 0.01:
                    tc = tc.rotated(rot)
                op = float(getattr(ov, "opacity", 1.0) or 1.0)
                if op < 0.999 and hasattr(tc, "with_opacity"):
                    tc = tc.with_opacity(op)
                clips.append(tc)
            else:
                continue
```
(重构:把原 `if type!='text': continue` + text 块改成上面的 if/elif 结构,text 块内容不变。)
- [ ] **Step 5: 追加测试**
```python
def test_shape_image_rect(tmp_path):
    from chayuan.server.video_generation.steps.compose import _render_shape_image
    from chayuan.server.video_generation.schemas import VgOverlay
    ov = VgOverlay(id="s1", type="rect", w=0.5, h=0.3, fill="#ff0000", stroke_color="#000000", stroke_width=2)
    p = _render_shape_image(ov, 1080, 1920)
    assert p and __import__("os").path.isfile(p)
def test_hex_rgba():
    from chayuan.server.video_generation.steps.compose import _hex_rgba
    assert _hex_rgba("#ff0000") == (255, 0, 0, 255)
    assert _hex_rgba("bad") is None
```
- [ ] **Step 6: ast 自检 + Commit**(本机无 PIL? 有则真跑;否则 ast)。

### Task B2:前端类型 + 工具条启用 + 新建默认

**Files:** Modify `packages/api/src/videoGeneration.ts`、`timeline/overlayEdit.ts`、`timeline/OverlayToolbar.tsx`、`timeline/LivePreviewCanvas.tsx`/`PreviewPlayer.tsx`/`VgTimelineEditorPage.tsx`(onOverlayTransform 类型放宽)

- [ ] **Step 1: API 类型** —— `VgOverlay` 加 `fill?: string | null; corner_radius?: number;`。
- [ ] **Step 2: overlayEdit addOverlay 形状默认** —— `addOverlay` 里按 type 设默认:形状 `{ w: 0.3, h: 0.2, fill: type === 'line' || type === 'arrow' ? null : '#ffffff33', stroke_color: '#ffffff', stroke_width: 3, corner_radius: 0 }`(文字保持原默认)。
- [ ] **Step 3: OverlayToolbar 启用 rect/ellipse/line/arrow** —— 这 4 项 `enabled: true`;贴纸/马赛克仍占位。
- [ ] **Step 4: onOverlayTransform 类型放宽** —— 三处(LivePreviewCanvas props / PreviewPlayer props / 编辑器 handler)把 tf 类型从 `{x,y,w,h,rotation,opacity,text}` 改为 `Partial<VgOverlay>`(import 类型),以容纳 fill/stroke/font 等样式。
- [ ] **Step 5: api/app tsc + Commit**。

### Task B3:预览渲染图形

**Files:** Modify `timeline/LivePreviewCanvas.tsx`(叠加元素渲染分支)

- [ ] **Step 1: 形状渲染** —— 叠加元素 div 内,`ov.type` 分支:
  - text:原逻辑。
  - rect:`<div className="h-full w-full" style={{ background: ov.fill||'transparent', border: (ov.stroke_width??0)>0?`${ov.stroke_width}px solid ${ov.stroke_color}`:'none', borderRadius: ov.corner_radius||0 }} />`。
  - ellipse:同 rect 但 `borderRadius:'50%'`。
  - line/arrow:内联 `<svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1=2 y1=50 x2=98 y2=50 stroke={ov.stroke_color} strokeWidth={ov.stroke_width} />{arrow: <polygon points="98,50 88,44 88,56" fill={ov.stroke_color}/>}</svg>`。
  几何手柄/选中/拖拽复用现有(对所有 type 一致)。
- [ ] **Step 2: app tsc + Commit**。

### Task B4:选中元素样式条(预览头部)

**Files:** Modify `VgTimelineEditorPage.tsx`(预览头部加样式条,基于 selectedOverlay)

- [ ] **Step 1: 取选中 overlay** —— `const selOverlay = selectedOverlayId ? (timeline.overlays||[]).find(o=>o.id===selectedOverlayId) : null;`。
- [ ] **Step 2: 样式条**(在「输出」Popover 那行附近,`selOverlay` 时显示)——
  - 公共:描边色 `<input color>`、描边宽 number、透明度 range。
  - text:字号 number、文字色 color、对齐 select(左/中/右)。
  - rect:填充 color + 「无填充」勾、圆角 number。
  - ellipse:填充 color + 无填充勾。
  - 改值走 `onOverlayTransform(selOverlay.id, { ... })`。
- [ ] **Step 3: app tsc + 手动(重建+重启 sidecar)** —— 点矩形/椭圆/直线/箭头→预览出图形可拖可缩可旋;样式条改填充/描边/圆角实时变;成片图形正确。Commit。

## 自审
- B 期 spec 覆盖:图形 4 种(B1 后端 + B3 预览)、样式 UI(B4)、工具条启用(B2)。
- 类型一致:`_render_shape_image(ov,W,H)`、`_hex_rgba` B1 内自洽;`onOverlayTransform` 放宽为 `Partial<VgOverlay>` 贯穿 B2/B3/B4。
- 复用:叠加轨/几何手柄/选中互斥 A 期已有,图形复用不改。
- ⚠ 后端 PIL 本机可能无 → ast 自检 + 构建机真跑;真机成片待重建。贴纸(C)/马赛克(D)仍占位。
