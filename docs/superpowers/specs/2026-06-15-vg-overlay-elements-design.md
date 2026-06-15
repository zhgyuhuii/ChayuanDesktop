# VG 叠加元素(文字/图形/贴纸/马赛克)— 设计文档(A 期:基建 + 文字)

- 日期:2026-06-15
- 范围:`chayuan-client`(数据模型/竖向工具条/叠加轨 lane/预览渲染)+ `chayuan-server`(compose 文字叠加)
- 总目标:视频预览上叠加文字/图形/贴纸/马赛克元素,竖向工具条(预览最左),叠加轨带时间段。
- **分期**:A 基建+文字(本文档) / B 图形(矩形/椭圆/直线/箭头) / C 贴纸·图片 / D 马赛克。A 打通整条管线,B-D 复用增量加 type。

## A 期范围
overlay 数据模型 + 时间轴叠加轨(拖位置/拉时长) + 竖向工具条(选择/文字,其余 type 占位灰显) + 预览渲染&几何手柄(复用 gizmo) + 后端 `TextClip` 合成。仅 `text` 元素端到端;`rect/ellipse/line/arrow/image/mosaic` 数据模型预留、UI 占位,渲染留 B-D。

## ① 数据模型
**后端** `schemas.py` 新增:
```python
class VgOverlay(BaseModel):
    id: str
    type: str = "text"          # text/rect/ellipse/line/arrow/image/mosaic(A 期只渲染 text)
    track_start_ms: int = 0
    duration_ms: int = 3000
    x: float = 0.1; y: float = 0.1; w: float = 0.5; h: float = 0.2   # 归一(0-1)
    rotation: float = 0.0
    opacity: float = 1.0
    z: int = 0
    # 文字样式(复用字幕同款字段语义)
    text: str = ""
    font_name: str = ""         # 空=用默认字体
    font_size: int = 48
    text_color: str = "#ffffff"
    stroke_color: str = "#000000"
    stroke_width: float = 1.5
    bg: Optional[str] = None     # 文字底色;None=透明
    align: str = "center"        # left/center/right
```
`Timeline` 加 `overlays: List[VgOverlay] = Field(default_factory=list)`。

**前端** `@chayuan/api` `VgTimeline` 加 `overlays?: VgOverlay[]`;`VgOverlay` 类型同上(可选字段)。

**前端编辑** 新 `timeline/overlayEdit.ts`:`addOverlay(t, type, atMs)` / `patchOverlay(t, id, patch)`(带 clamp,x/y∈[0,1]、w/h∈[0.02,1]、opacity∈[0,1]、rotation∈[-180,180]、duration≥200ms) / `deleteOverlay(t, id)` / `moveOverlay(t, id, startMs)` / `resizeOverlay(t, id, durMs)`。

## ② 竖向工具条(预览最左)
新 `timeline/OverlayToolbar.tsx`:竖排图标 rail(`w-9`,圆角 ghost,hover/选中高亮),贴预览左缘绝对定位。项:选择(默认,Move 图标)、文字(Type)、矩形/椭圆/直线/箭头/贴纸/马赛克(B-D 期占位:灰 disabled + tooltip「即将上线」)。点「文字」→ `addOverlay(timeline,'text', playheadMs)`(画面中心默认框、时长 3s)→ 自动 `setSelectedOverlayId`。挂在 `PreviewPlayer`/`LivePreviewCanvas` 容器左缘。

## ③ 预览渲染 + 手柄(LivePreviewCanvas)
- 新 props:`overlays`、`selectedOverlayId`、`onSelectOverlay`、`onOverlayTransform`(写 patchOverlay)。
- 渲染:`overlays.filter(playhead∈[start,start+dur))`,每个按 `x/y/w/h` 定位的 div;`text` 渲染文字(font/size/color/stroke via text-shadow/-webkit-text-stroke、bg、align、rotate、opacity)。
- 选中:复用几何手柄(移动/四角缩放/旋转手柄,与片段 gizmo 同款),写 `onOverlayTransform`。双击文字 → 内联 `contentEditable`/输入改 `text`。
- 与片段选择互斥:`selectedOverlayId` 与 `selectedClipId` 二选一(选叠加元素时清片段选中,反之)。

## ④ 时间轴叠加轨(TimelineTracks)
- 在字幕轨附近加一条「叠加」lane:每个 overlay 一个**可拖位置 + 拉两端改时长**的条(复用现有 lane/clip 拖拽范式;条上显 type 图标 + 文字首few字)。点条 = 选中(联动预览 `selectedOverlayId`)。
- 写入走 `moveOverlay`/`resizeOverlay`/`deleteOverlay`(右键或选中删)。

## ⑤ 后端合成(compose.py)
- 新 `_render_overlays(base_clip, overlays, W, H, fps) -> clip`:遍历 `overlays`,A 期只处理 `type=='text'`:
  - `TextClip(text, font=resolve_font(font_name), font_size, color=text_color, stroke_color, stroke_width, method='caption', size=(int(w*W), None))`;
  - `.with_position((int(x*W), int(y*H)))`、`.with_start(start_s)`、`.with_end(end_s)`、`opacity<1 → with_opacity`、`rotation → rotated`;bg 非空 → 文字底 ColorClip 垫一层。
  - `CompositeVideoClip([base, *overlay_clips])`。其它 type 跳过(B-D)。
- 接入:在 EDL 合成最终成片、叠加字幕之前/之后的合适处调用(文字叠加在画面之上、字幕层级附近);失败只 warning 返回 base(不破坏正片)。
- 字体解析复用现有字幕字体定位(`resolve_font`/fonts 目录)。

## ⑥ 复用与边界
- 几何手柄复用预览 gizmo;叠加轨拖条复用 lane 范式;文字样式字段对齐字幕(字体/色/描边/底)。
- 叠加元素**不付费锁**(仅片头/片尾锁)。
- 预览实时显示;成片走后端(需重建 sidecar)。
- B/C/D 的 type 在 A 期:数据模型已含、工具条占位灰显、后端 `_render_overlays` 跳过未实现 type。

## ⑦ 文件改动(A 期)
- 后端:`schemas.py`(VgOverlay + Timeline.overlays)、`steps/compose.py`(`_render_overlays` + 接入)。
- 前端:`@chayuan/api`(VgOverlay + overlays)、新 `timeline/overlayEdit.ts`、新 `timeline/OverlayToolbar.tsx`、`timeline/LivePreviewCanvas.tsx`(渲染+手柄)、`timeline/PreviewPlayer.tsx`(透传)、`timeline/TimelineTracks.tsx`(叠加 lane)、`VgTimelineEditorPage.tsx`(selectedOverlayId 状态 + 透传 + onOverlay*)。

## ⑧ 验证
- 后端:`_render_overlays` 文字 clip 构造单测(本机 ast 自检,真跑构建机);hex/字体回退。
- 前端:`overlayEdit` clamp vitest;app/api tsc。
- 手动(重建+重启 sidecar):点文字工具→画面出可拖文字框、双击改字、叠加轨拖条改时间;成片在时间段内显示文字、样式/位置一致。

## ⑨ 风险
- 多层传播(overlay 字段穿 schema/api/edit/preview/timeline/compose);A 期清单已列。
- TextClip 字体/换行(method='caption' + size 宽度)在 frozen 环境字体定位:复用字幕已验证的 `resolve_font`。
- CSS 文字描边(`-webkit-text-stroke`)与 MoviePy stroke 视觉略差异,工具级可接受(注明)。
- 选中互斥(overlay vs clip)状态要清晰,避免两个手柄同时出现。
