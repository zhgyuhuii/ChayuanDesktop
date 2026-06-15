# VG 叠加元素 C 期(贴纸/图片) 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / subagent-driven-development. Steps use `- [ ]`.

**Goal:** 叠加管线加「图片/贴纸」元素:用户上传 PNG/图片→放预览→拖拽/时间段→后端 ImageClip 合成。复用 A/B 的轨/手柄/样式条 + intro-outro 上传范式。

**Architecture:** VgOverlay 加 `src`(图片文件名);新 overlay-asset 上传/列举/流式端点(仿 intro-outro,存 `overlay_assets_dir`);`_render_overlays` 加 image 分支(ImageClip);前端工具条「图片」→ 文件选择上传 → addOverlay(src);预览 `<img>`。

**Tech Stack:** Python+MoviePy(后端,ast+构建机);React+TS。root 仓:sudo+bump+只stage改动+push main。

---

### Task C1:后端 图片叠加 + 上传端点

**Files:** Modify `schemas.py`(VgOverlay 加 src)、`video_generation/_helpers.py`(overlay_assets_dir)、`api_server/video_generation_routes.py`(3 端点)、`steps/compose.py`(_render_overlays image 分支)

- [ ] **Step 1: schema** —— VgOverlay 加 `src: Optional[str] = None`(图片文件名/路径)。
- [ ] **Step 2: _helpers** —— 仿 `intro_outro_dir` 加 `def overlay_assets_dir() -> str:`(`<root>/video_generation/overlay_assets`,mkdir)。
- [ ] **Step 3: 端点(仿 /intro-outro)** —— `POST /overlay-asset`(图片 ext: jpg/jpeg/png/webp/gif/bmp,存 overlay_assets_dir)、`GET /overlay-asset`(列)、`GET /overlay-asset/{name}/file`(流式)。
- [ ] **Step 4: _render_overlays image 分支** —— text/shape if-elif 加:
```python
            elif ovtype == "image":
                src = getattr(ov, "src", None)
                if not src:
                    continue
                from .._helpers import overlay_assets_dir
                sp = src if (os.path.isabs(src) and os.path.isfile(src)) else os.path.join(overlay_assets_dir(), os.path.basename(src))
                if not os.path.isfile(sp):
                    continue
                tc = ImageClip(sp).resized(width=max(2, int((getattr(ov, "w", 0.3) or 0.3) * W)))
```
（放在 shape 分支后、`else: continue` 前；共用 with_start/end/位置/旋转/透明度尾。）
- [ ] **Step 5: ast 自检 + Commit**。

### Task C2:前端 图片叠加

**Files:** Modify `packages/api/src/videoGeneration.ts`(VgOverlay src + 端点)、`timeline/overlayEdit.ts`(image 默认)、`timeline/OverlayToolbar.tsx`(启用 image)、`timeline/LivePreviewCanvas.tsx`(img 渲染)、`VgTimelineEditorPage.tsx`(image 上传流程)

- [ ] **Step 1: API** —— VgOverlay 加 `src?: string`;加 `vgUploadOverlayImage(file)`/`vgListOverlayImages()`/`vgOverlayImageFileUrl(name)` + 聚合 `uploadOverlayImage/overlayImageFileUrl`。
- [ ] **Step 2: overlayEdit** —— addOverlay 支持 image:`type==='image'` → `{ w: 0.3, h: 0.3, stroke_width: 0 }`(无描边)。可选第 4 参 `src`:`addOverlay(t, type, atMs, src?)`,image 把 src 写进元素。
- [ ] **Step 3: OverlayToolbar** —— 'image' 项 `enabled: true`,label「图片/贴纸」。
- [ ] **Step 4: 编辑器上传流程** —— `onAddOverlay('image')` 改为:开隐藏 `<input type=file accept=image/*>` → 选图 → `videoGeneration.uploadOverlayImage(file)` → `addOverlay(timeline,'image',playheadMs, r.name)` → 选中。(其它 type 仍直接 addOverlay。)
- [ ] **Step 5: 预览渲染** —— LivePreviewCanvas image 分支:`<img src={videoGeneration.overlayImageFileUrl(ov.src)} className="pointer-events-none h-full w-full object-contain" draggable={false} />`(ov.src 存在时)。
- [ ] **Step 6: api/app tsc + 手动(重建+重启 sidecar)** —— 点图片→选图→预览出可拖图片;成片含图片。Commit。

## 自审
- 覆盖:image 渲染(C1 后端+C2 预览)、上传端点(C1)、工具条(C2)。
- 复用:轨/手柄/样式(透明度)/选中互斥 A/B 已有;上传仿 intro-outro。
- src 解析:绝对路径或 overlay_assets_dir/basename。
- ⚠ 后端 pytest 本机跑不了;真机成片待重建。D 马赛克仍占位。
