# VG 片段属性 P4:调色(亮度/对比度/饱和度 + 预设)— 设计文档

- 日期:2026-06-15
- 范围:`chayuan-server`(compose 调色)+ `chayuan-client`(类型/编辑/UI)
- 前置:P1 属性面板/透明度、P2 几何(rotation/flip/crop)已发;⚙ 面板已删,片段属性 UI 现在在预览头部「片段」条(row2)。
- 分期:本文档 = P4 调色;P5 关键帧另立。变速(P3)用户已弃。

## 决策(已确认)
- 逐片段 亮度/对比度/饱和度(各 1.0 默认)+ 预设滤镜;实现走 MoviePy `image_transform` + numpy(版本无关,默认值跳过零开销);作用于主轨+PIP+图像片段;不动音频。

## ① 数据模型
**后端** `schemas.py`:新 `ClipColor(BaseModel)`:`brightness: float=1.0; contrast: float=1.0; saturation: float=1.0`;`TimelineClip` 加 `color: Optional[ClipColor] = None`。
**前端** `@chayuan/api` `VgTimelineClip` 加 `color?: { brightness: number; contrast: number; saturation: number }`。
**前端** `timelineEdit.patchClip` 的 `ClipPatch` 扩 `color`;写入时若给 color 则整体替换(三值各 clamp 0–3)。

## ② 后端合成(compose.py)
- 新 `_apply_color(clip, color)`:
  - 取 b/c/s(缺省 1)。全为 1(±0.001)→ 直接返回 clip(零开销)。
  - 否则 `clip.image_transform(fn)`,fn(numpy frame uint8 HxWx3):
    `f = frame.astype(float32)`;亮度 `f *= b`;对比度 `f = (f-128)*c + 128`;饱和度 `gray = f@[0.299,0.587,0.114]; f = gray[...,None] + (f - gray[...,None])*s`;`clip(0,255).astype(uint8)`。
  - 失败 try/except 返回原 clip。
- 接入:`_render_main_segment` 内(几何后,resize 前后均可,放几何之后)对主轨段调用;`_apply_pip_geometry` 之后对 PIP clip 调用(从 layer 取 color);图像 clip(ImageClip)同样经 `_render_main_segment` → 自动覆盖。
- `_build_edl_render_plan` 与 `_build_pip_layers` 的 item/layer 带 `color`(c.color.model_dump() 或 None)。

## ③ 预设(前端,预设=填三值的快捷)
- 原图(1/1/1)、黑白(sat 0)、鲜艳(sat 1.4)、暖(b 1.05/c 1.05/s 1.1)、高对比(c 1.3)。选预设 → patchClip({ color })。后续可加更多。

## ④ UI
- 预览头部「片段」条(row2,VgTimelineEditorPage)加调色组:亮度/对比度/饱和度三个 `range`(0–3,step 0.05)+ 预设 `select`;选中片段(selClip)时可用,未选灰禁用(同现有几何条)。改值走 `onSetTransform(selClip.id, { color: {...} })`(onSetTransform 类型扩 color)。

## ⑤ 文件改动
- 后端:`schemas.py`(ClipColor + color)、`steps/compose.py`(`_apply_color` + plan/layer 带 color + 主轨/PIP 接入)。
- 前端:`@chayuan/api`(VgTimelineClip.color)、`timeline/timelineEdit.ts`(ClipPatch + patchClip clamp)、`VgTimelineEditorPage.tsx`(片段条调色 UI + onSetTransform 类型扩 color)。

## ⑥ 验证
- 后端:`_apply_color` numpy 逻辑单测(可不依赖 moviepy:直接测 fn 对小数组的 b/c/s 计算)+ ast;真渲染构建机。
- 前端:patchClip color clamp vitest;app tsc;调色滑条改→预览…(注:**预览不实时反映调色**,A 期文字预览同理——调色只成片体现;预览可后续加 CSS filter 近似,本期先不做)。
- 手动(重建+重启 sidecar):调亮度/对比度/饱和度 + 预设 → 成片对应片段变色;默认值零影响。

## ⑦ 边界/风险
- numpy 逐帧有 CPU 成本;默认值(全 1)跳过,只调过色的片段处理。
- 预览不显调色(本期):需在 LivePreviewCanvas 用 CSS `filter: brightness()/contrast()/saturate()` 近似才实时——列为 P4 可选后续,先不做以控范围。
- 后端 pytest 本机跑不了(numpy fn 可纯测;moviepy 真渲染构建机)。
