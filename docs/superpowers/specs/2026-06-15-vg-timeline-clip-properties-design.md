# 时间轴片段属性面板 + 轨道音量重设计 — 设计文档

- 日期:2026-06-15
- 范围:**第 1 期(共 5 期)**,纯前端,后端已就绪、零后端改动
- 涉及:`chayuan-client` 视频生成时间轴编辑器(`packages/app/src/features/video-generation/`)

## 背景

用户在时间轴左侧轨道头的音量控件是**内联横向滑条**,占地方;希望改成「图标 → 点开竖向滑条」的紧凑形态,并补齐专业 NLE 的片段控制能力(透明度等)。

经探索确认:
- 轨道音量控件在 `timeline/TrackHeader` 的 `action`(`TimelineTracks.tsx` 内构造),= 静音按钮 + 不静音时的横向 `<input type="range">`(`w-10`),走 `timelineEdit.setTrackAudio`(整轨)。
- 后端 `TimelineClip.opacity`(`schemas.py`)早已存在,`compose._build_pip_layers` 已对 PIP 层 `with_opacity`;但**前端 `VgTimelineClip` 类型、UI、预览全缺** opacity。
- 位置/缩放(x/y/scale)目前**只能在预览里拖**(`LivePreviewCanvas` drag → `trackOps.setClipTransform`),无数值控件。
- 可复用浮层范式:`VgAspectPicker`(按钮→`open` 态→absolute 浮层→`mousedown` 外部 + `Esc` 关闭)。

## 总体分期路线(本次只做第 1 期)

| 期 | 内容 | 后端 |
|---|---|---|
| **1** | 片段属性面板基建 + 轨道音量重设计 + 透明度(PIP) + 逐片段音量 + 数值化位置/缩放/层级 | 无(已就绪) |
| 2 | 几何变换:旋转、水平/垂直翻转(镜像)、裁剪 crop | 改 moviepy compose |
| 3 | 变速 retiming(时长/音频变调/字幕同步) | 改 compose |
| 4 | 调色:亮度/对比度/饱和度(或预设滤镜) | 改 compose |
| 5 | 关键帧动画(属性→关键帧轨,数据模型大改 + 时间轴关键帧 UI) | 改 compose |

第 1 期建立「片段属性面板 + 属性前后端映射约定」的地基,2–5 期复用该面板增量加控件;关键帧依赖先有静态属性,压轴。

## 第 1 期设计

### 1. 行为与范围

两个控制面,全部前端,后端已就绪:

- **A · 轨道音量(整轨,左侧 TrackHeader)**:静音图标 +(仅不静音时)音量图标;点音量图标 → 弹出**竖向滑条**浮层。移除现有内联横滑条。值作用于整轨,沿用 `setTrackAudio`,竖滑条初值 = 该轨首个 clip 的 `volume`。
- **B · 逐片段属性(选中视频片段,工具栏「属性」⚙ 图标 → 浮层面板)**:
  - **透明度**滑条 —— **仅 PIP / 附加视频轨片段显示**(主轨片段不显;主轨"淡到黑"由现有淡入淡出转场负责)。
  - **逐片段音量**滑条(现仅整轨)。
  - **位置 X / Y、缩放、层级 z** —— 数值输入(带步进);**预览拖拽保留**,与面板数值双向联动。
  - 选中工具栏的**逐片段静音按钮保留**(高频快捷);面板音量行再带一个静音切换(两者改同一 `muted` 字段)。

### 2. 数据层

- 前端 `packages/api/src/videoGeneration.ts` 的 `VgTimelineClip` 补:
  ```ts
  opacity?: number; // 画中画层不透明度 0-1(1=不透明);后端 schema 早有,前端类型补齐
  ```
- `timeline/timelineEdit.ts` 新增通用 helper:
  ```ts
  // patch 取 opacity|volume|muted|x|y|scale|z 的子集,内置 clamp(opacity/scale∈[0,1] 等)
  export function patchClip(t: VgTimeline, clipId: string, patch: Partial<...>): VgTimeline
  ```
  现有 `setClipMuted` 收敛为 `patchClip(t, id, { muted })` 的薄封装(或保留并改为内部调用),`trackOps.setClipTransform` 的 x/y/scale/z clamp 逻辑并入或被 `patchClip` 复用,避免两套 clamp。
- `timeline/LivePreviewCanvas.tsx`:PIP 图层 `style` 加 `opacity: c.opacity ?? 1`,与后端 `with_opacity` 对齐 → 预览实时反映透明度。

### 3. 组件(均复用 `VgAspectPicker` 浮层范式:`open` 态 + 点外部 `mousedown` + `Esc` 关闭)

- **新 `timeline/VerticalSliderPopover.tsx`(通用)**:图标按钮 → absolute 定位的竖向滑条浮层。竖向 range 用标准 `writing-mode: vertical-lr`(现代标准),`transform: rotate(-90deg)` 作兜底;**WebKitGTK 竖向 slider 兼容性需用户重建 desktop 后验证**。接受 `value/min/max/step/onChange/icon/title`。
- **新 `timeline/ClipPropertyPopover.tsx`**:选中片段「属性」面板。含透明度滑条(仅 PIP 片段渲染该行)、音量滑条 + 静音、位置 X/Y、缩放、层级 z 数值输入。面板内有空间,用常规横向滑条/数值即可(不必竖排)。
- **改 `timeline/TimelineTracks.tsx`**:TrackHeader `action` 改为「静音图标 +(不静音)音量图标 → `VerticalSliderPopover`」,删掉内联横滑条。
- **改 `timeline/VgTimeline.tsx`**:选中片段浮动工具栏加「属性」(`SlidersHorizontal` 图标)按钮 → 打开 `ClipPropertyPopover`;保留现有逐片段静音快捷按钮。

### 4. 文件改动清单(零后端)

- `packages/api/src/videoGeneration.ts` — `VgTimelineClip` 加 `opacity`
- `timeline/timelineEdit.ts` — 加 `patchClip`,收敛 `setClipMuted`
- `timeline/trackOps.ts` — `setClipTransform` clamp 复用/收敛到 `patchClip`
- `timeline/LivePreviewCanvas.tsx` — PIP 图层应用 `opacity`
- 新 `timeline/VerticalSliderPopover.tsx`
- 新 `timeline/ClipPropertyPopover.tsx`
- `timeline/TimelineTracks.tsx` — TrackHeader action 换竖滑条
- `timeline/VgTimeline.tsx` — 选中工具栏加「属性」按钮

### 5. 数据流

```
TrackHeader 音量图标 → VerticalSliderPopover.onChange(v)
    → onTimelineChange(setTrackAudio(timeline, trackId, { volume: v }))   // 整轨

片段「属性」面板控件 → onTimelineChange(patchClip(timeline, clipId, { opacity|volume|muted|x|y|scale|z }))

预览拖拽(LivePreviewCanvas)→ onTransform(clipId, {x,y,scale}) → patchClip(...)   // 与面板数值联动
LivePreviewCanvas 渲染 PIP 层:style.opacity = clip.opacity ?? 1
```

所有写入仍经 `VgTimelineEditorPage.onTimelineChange`(内部 `roundTimeline` + `setProxyStale`),后端无需改动:提交/finalize 走原路径,`opacity` 落到后端 `TimelineClip.opacity`,PIP 合成已 `with_opacity`。

### 6. 边界与决策

- 透明度只对 PIP/附加轨片段(后端能力边界);主轨片段属性面板不显透明度行。
- `z` 层级同理只对 PIP 片段有意义(主轨片段隐藏 z);层级也受轨道顺序影响,面板 z 用于同轨多 PIP clip 细调。
- 不引入关键帧/旋转/变速等(属 2–5 期)。
- 不改后端;不改音频轨插入 clip 的现有控件(属性面板服务视频片段)。

### 7. 验证

- `cd chayuan-client && node_modules/.bin/tsc -p packages/api/tsconfig.json --noEmit` 与 `packages/app` 同令(本机 admin 可跑,已多次实测 exit 0;无 pnpm,逐包跑)。
- 手动(用户重建 desktop + 重启 sidecar 后):
  - 轨道音量:点音量图标弹竖滑条、调值生效、点外/Esc 关闭、静音时音量图标隐藏。
  - PIP 片段透明度:面板调 → 预览实时变;提交后成片透明(后端已支持)。
  - 逐片段音量、静音(工具栏与面板一致)。
  - 数值位置/缩放与预览拖拽双向联动。
  - 主轨片段不显透明度 / z。
  - WebKitGTK 竖向滑条显示正常(兼容性确认点)。

## 风险

- WebKitGTK 对竖向 `<input type=range>` 的渲染差异 → 已规划标准 `writing-mode` + rotate 兜底,需真机验证。
- `setClipTransform`/`setClipMuted` 收敛到 `patchClip` 时勿改动既有 clamp 语义(x/y∈[0,1]、scale∈[0.05,1]、z 取整),避免回归 PIP 拖拽。
