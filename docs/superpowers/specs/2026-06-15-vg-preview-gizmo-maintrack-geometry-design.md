# VG 预览 Gizmo + 主轨几何 — 设计文档

- 日期:2026-06-15
- 范围:`chayuan-client` 视频预览(`LivePreviewCanvas`/`PreviewPlayer`)+ `chayuan-server` 主轨合成(`compose.render_from_edl`)
- 前置:P2 几何(rotation/flip/crop 字段 + PIP `_apply_pip_geometry` + 属性弹层)已发(v2.0.31-34)
- 动因:用户在**视频预览页**找不到几何控件(在时间轴 ⚙ 里、且仅 PIP),预期是「预览里选中画面直接调,且主视频也支持」。本设计把控件搬到预览 gizmo + 主轨打通几何。

## 范围与边界
- 几何作用扩到**所有视频轨(含主轨)**;去掉前端 `isPip` 门控。
- 主轨后端走**路线 A:逐段合成(零回归)**——未变换片段渲染与现状完全一致,仅被变换的段合成到黑底。
- 透明度/旋转/翻转/裁剪 + 位置/缩放,主轨与画中画统一可用。
- 不含关键帧/变速/调色(P3-P5)。

## ① 后端:主轨几何(compose.py,路线 A)
- `_build_edl_render_plan` 每个 plan item 增带:`rotation/flip_h/flip_v/crop/opacity/x/y/scale`(从主轨 clip `getattr` 读,缺省同 schema)。
- 新 `_render_main_segment(src_clip, item, W, H) -> clip`:
  1. `_apply_pip_geometry(src_clip, item)`(crop→flip→rotate,已存在,复用);
  2. 判断是否「自由变换」:`scale<0.999 or x!=0 or y!=0 or opacity<0.999`;
     - 是 → `inner = clip.resized(width=int(W*scale)).with_position((int(x*W), int(y*H)))`;`opacity<0.999` 再 `.with_opacity(op)`;`CompositeVideoClip([ColorClip((W,H),(0,0,0)).with_duration(dur), inner])`;
     - 否 → `clip.resized(new_size=(W,H))`(与现状一致)。
- `render_from_edl` 的图像分支(`ImageClip(...).with_duration(dur).resized(...)`)与视频分支(`subclipped(...).resized(...)`)都改为调 `_render_main_segment`。transition 仍在其后应用,不变。
- 低清代理预览路径(若也渲主轨段)同样接入;PIP 路径不变。

## ② 前端:预览 Gizmo(LivePreviewCanvas / PreviewPlayer)
- **选中模型**:复用全局 `selectedClipId`。`PreviewPlayer` 透传 `selectedClipId` + `onSelectClip` 给 `LivePreviewCanvas`;`VgTimelineEditorPage` 已有该状态,接上。点预览某层 → `onSelectClip(c.id)`。
- **选中层 gizmo**(对所有视频层,含主轨 full 层):
  - 持久包围框(选中显示,非仅 hover)。
  - 四角 = 缩放(复用现有 `drag` corner);拖框体 = 移动(复用现有 `drag` move)。
  - **旋转手柄**:顶部中点上方圆点 + 连线;`dragRotate` 按指针相对层中心的角度算 `rotation`(atan2),写 `patchClip({rotation})`,Shift 吸附 15°(可选)。
  - **浮动工具条**(贴选中层一角):水平翻转 / 垂直翻转 / 裁剪切换 / 透明度(图标→小滑条弹层,复用 `VerticalSliderPopover`)。裁剪走上一轮 `cropEditingClipId` + `dragCrop`。
- 预览图层 style 的 rotate/flip/clip-path 已按 clip 字段应用(P2 已加),主轨层同样生效(`full` 层也读 transform/clipPath)。本设计只新增「选中态 + 旋转手柄 + 工具条 + 选中即显手柄」。
- 主轨层当前 `full`(inset:0);选中后允许调 scale/position → 退出 full、按 x/y/scale 定位(与 PIP 同分支)。即 `full` 仅作「无变换默认满画幅」初始,选中调整后用 x/y/scale。

## ③ 控件双入口(同源 patchClip)
- 预览 gizmo = 主交互(拖拽旋转/缩放/移动 + 翻转/裁剪/透明度)。
- 时间轴片段 ⚙ 弹层(已 portal 化)= 保留作**数值精调**(精确角度/透明度/位置数值);去掉其 `isPip` 门控 → 主轨片段也显示。
- 两入口都走 `patchClip`,实时双向联动。

## ④ 数据层
- 字段已就绪(rotation/flip_h/flip_v/crop),`patchClip` 已 clamp;**本设计无新增字段**。仅:后端主轨把 x/y/scale/opacity 打通进成片(路线 A);前端去 isPip 门控。

## 文件改动清单
- 后端 `steps/compose.py`:`_build_edl_render_plan` 带几何字段;新 `_render_main_segment`;`render_from_edl` 图像/视频分支接入。
- 前端 `timeline/PreviewPlayer.tsx`:透传 `selectedClipId` + `onSelectClip`。
- 前端 `timeline/LivePreviewCanvas.tsx`:选中态 + 旋转手柄(`dragRotate`)+ 浮动工具条(翻转/裁剪/透明度);选中即显手柄;层可点选。
- 前端 `timeline/ClipPropertyPopover.tsx`:去 `isPip` 门控(几何对主轨也显示)。
- 前端 `VgTimelineEditorPage.tsx`:`selectedClipId`/`onSelectClip` 透传给 PreviewPlayer。

## 数据流
```
预览点层 → onSelectClip(clipId)（= 时间轴选中同一状态）
预览 gizmo 拖旋转/缩放/移动/翻转/裁剪/透明度 → patchClip(timeline, clipId, {...}) → onTimelineChange
时间轴 ⚙ 数值精调 → patchClip(...)  // 同源,双向联动
后端:render_from_edl → _render_main_segment（主轨逐段，自由变换则合成黑底）；_build_pip_layers + _apply_pip_geometry（PIP 不变）
```

## 已知差异 / 风险
- 路线 A 仅在片段「自由变换(scale/位置/opacity 非默认)」时合成黑底,否则零变化 → 回归面最小;crop/flip/rotate 总应用(填满画幅,不需黑底)。
- CSS `rotate` 不扩框 vs MoviePy `.rotated` expand:预览与成片旋转角点轻微差异(P2 已注明,工具级可接受)。
- 主轨「自由变换」语义 = 该时间段画面缩小/移位/半透明在黑底上(单段时间范围内),非同时多层;符合主轨是时间序列的本质。
- gizmo 旋转手柄与四角缩放、裁剪框需互斥清晰:裁剪模式(`cropEditingClipId`)下隐藏旋转/缩放手柄,只显裁剪框(沿用 P2)。

## 验证
- 后端:`ast.parse` 语法自检(本机无 py312 依赖,见 [[reference_py312_test_env]]);补 `_render_main_segment` 默认路径不变的回归测试(真跑在构建机)。
- 前端:`packages/app` tsc;vitest(patchClip 已覆盖)。
- 手动(重建 desktop + 重启 sidecar):预览选中主轨/PIP 层 → 旋转手柄拖转、翻转、裁剪、透明度、缩放移动均实时;成片主轨几何生效(允许旋转角点轻微差异);未变换片段成片与旧版一致(零回归确认)。
