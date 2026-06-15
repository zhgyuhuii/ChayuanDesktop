# VG P5 关键帧(切片:叠加元素位置关键帧/运动路径)— 设计文档

- 日期:2026-06-15。范围:叠加元素(overlay)位置随时间在关键帧间插值(运动路径)。
- 切片理由:MoviePy `with_position` 可传 t 的函数(干净);opacity/rotation/scale 随时间变需逐帧合成(重)→ **本切片只做位置关键帧**,其余关键帧留后续。

## 数据模型
- `VgOverlay.keyframes?: { t: number; x: number; y: number }[]`(t=相对该元素时长 0-1;x/y 归一位置)。≥2 个时位置按 t 插值;否则用静态 x/y。后端 `VgOverlay.keyframes: List[Kf]=[]`(Kf{t,x,y})。

## 后端(_render_overlays)
- 若 `len(keyframes)>=2`:`tc.with_position(posfn)`,posfn(time):`rel=clamp(time/dur,0,1)`;在排序后的 kfs 间线性插值 x,y → 返回 `(x*W, y*H)`。覆盖静态 with_position。
- 失败回退静态位置。

## 前端
- 预览:有关键帧时,按 playhead 的 rel 插值出当前 x/y 用于渲染(元素沿路径走);拖动元素 = 更新"当前最近关键帧"或记录新值(简化:见 UI)。
- 样式条加运动组(selOverlay):**记录关键帧**(在 playhead 处加 {t,x,y}=当前)/**清除关键帧** 两个按钮 + 关键帧数显示。多个关键帧 → 运动路径。
- overlayEdit:`addKeyframe(t,id)`(用元素当前 x/y 加 kf)/`clearKeyframes(id)`;插值 helper `overlayPosAt(ov, playheadMs)`(供预览)。

## 文件
- 后端 `schemas.py`(Kf + keyframes)、`steps/compose.py`(_render_overlays posfn)。
- 前端 `@chayuan/api`(keyframes)、`timeline/overlayEdit.ts`(addKeyframe/clearKeyframes/overlayPosAt)、`LivePreviewCanvas.tsx`(预览插值位置)、`VgTimelineEditorPage.tsx`(样式条运动按钮)。

## 验证/边界
- 后端 ast;真渲染构建机(with_position fn 运动)。前端 tsc;预览拖 playhead 元素沿路径动。
- 仅位置关键帧;透明度/旋转/缩放/字段关键帧后续切片(需逐帧合成方案)。
