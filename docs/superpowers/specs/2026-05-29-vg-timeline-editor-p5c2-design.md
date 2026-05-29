# 时间轴编辑器 P5c-2 设计 —— 轨道管理 + 多视频层画中画 PIP

> 状态:已用户审过设计(2026-05-29),待写 implementation plan。
> 前置:P1-P5c-1 已落地(三区 NLE、手拖素材成片、图像渲染、编辑字幕/clip、插入音频混音、
> 自包含生成脚本、右键菜单、素材库可调宽/卡片列表、合成时长含旁白/插入音频)。

## 背景与目标

"全真多轨 NLE" 的**最后一个子阶段**。交付:① 轨道整条选中态;② 添加/删除视频/音频轨道
(动态轨道列表,默认轨不可删、用户加的可删);③ 多视频层画中画 PIP —— 第 2+ 视频轨 clip
叠在主视频上,在预览区可拖拽移动 + 拖角缩放 + 设层级;compose 用 `CompositeVideoClip` 分层渲染。

## 选定决策(brainstorming 结论)

| 维度 | 选择 |
|---|---|
| PIP 编辑方式 | A. 预览区浮层框拖拽移动 + 拖角缩放 |
| PIP 坐标系 | 0-1 归一(画幅无关),存 EDL clip `x/y/scale` |
| ②③ 关系 | 一个阶段做(第 2 视频轨只有 PIP 渲染就绪才有意义) |
| 动态轨道范围 | 视频/插入音频动态多 lane;旁白/音乐(BGM)/字幕保持派生单例固定 |
| 浮层底图 | 主轨 proxy 视频;PIP 框显 clip 首帧缩略图;「生成预览」时 compose 真分层合成 |

## 现状(已确认)

- 后端 `TimelineClip`(schemas.py):`id/source/track_start_ms/in_ms/out_ms/transition/volume`,无 x/y/scale/z。
  `Timeline.tracks: List[TimelineTrack]`;`TimelineTrack: {id, kind, clips, cues}`,无 removable/label。
- `render_from_edl`(compose.py):只取第一条 `kind=='video'` 轨拼接 → `generate_video`(底层单视频 + 旁白/BGM/插入音频/字幕)。`_build_edl_render_plan` 取 `video_tracks[0]`。`render_proxy_from_timeline` 同理单视频轨。
- 前端 `TimelineTracks`:写死 5 lane(视频/旁白/音频/音乐/字幕),视频轨 = `<VgTimeline videoTrackOnly>`,插入音频 = `<AudioInsertTrack>`(单条),其余派生单例。
- `PreviewPlayer`:容器内 `<video>` 播 `previewEdl` proxy(主轨)。
- 前端 timelineEdit 算子:appendClipFromMaterial/appendAudioClip/replaceClipSource/deleteAnyClip/reorder/setClipDuration/setClipIn/clipDurMs。
- `VgTimelineClip`(api types):`source/track_start_ms/in_ms/out_ms/transition?/volume?/duration_ms?`。

## ① 数据模型(EDL 扩展)

文件:`schemas.py`(后端 TimelineClip/TimelineTrack)、`packages/api/src/videoGeneration.ts`(VgTimelineClip/VgTimelineTrack)。

- `TimelineClip` 加可选(前后端一致):
  - `x?: float`(0-1,clip 左上角相对画幅宽/高的归一位置,默认 0)
  - `y?: float`(0-1,默认 0)
  - `scale?: float`(0-1,相对画幅**宽**的缩放;默认主轨视 1=铺满,PIP 默认 0.4)
  - `z?: int`(层级,大在上;默认按轨道顺序)
- `TimelineTrack` 加可选:`removable?: bool`(默认 False;用户加的轨 True)、`label?: str`。
- 后端 schema 默认值不破坏现有(主轨 clip 不填这些 = 铺满底层,行为同今)。

## ② 动态轨道列表重构(TimelineTracks)

文件:`timeline/TimelineTracks.tsx`、新 `timeline/timelineTracks.ts`(纯算子 addTrack/removeTrack/setClipTransform + 测)。

- 纯算子:
  ```ts
  addTrack(t: VgTimeline, kind: 'video' | 'audio'): VgTimeline   // 追加 {id, kind, clips:[], removable:true}
  removeTrack(t: VgTimeline, trackId: string): VgTimeline        // 仅 removable 轨可删;否则原样返回
  setClipTransform(t: VgTimeline, clipId: string, tf: { x?: number; y?: number; scale?: number; z?: number }): VgTimeline
  ```
- TimelineTracks 渲染顺序改为(动态):
  - **视频轨们**:`tracks.filter(kind==='video')` 每条一 lane(`VgTimeline videoTrackOnly`)。第一条 = 主轨(铺满),其余 = PIP 层。
  - **旁白**(派生单例,波形)
  - **插入音频轨们**:`tracks.filter(kind==='audio')` 每条一 lane(`AudioInsertTrack`)
  - **音乐 BGM**(派生单例)
  - **字幕**(派生单例)
- 轨道头列同步:每条视频/音频轨一个 TrackHeader(附加轨显「视频 2」「音频 2」+ 可删标记)。
- `lanesH` 由动态轨数算。

## ③ 轨道选中 + 加/删轨

文件:`TimelineTracks.tsx`、`VgTimelineEditorPage.tsx`、`TrackContextMenu.tsx`。

- **选中态**:`selectedTrackId`(TimelineTracks 本地或编辑器);点轨道头/lane 空白处选中,该 lane + 轨道头加高亮 ring。
- 右键 lane 菜单(扩展 TrackContextMenu)新增:
  - 「添加视频轨」「添加音频轨」→ 编辑器 `onTimelineChange(addTrack(timeline, kind))`。
  - 附加轨(removable)多一项「删除此轨」→ `onTimelineChange(removeTrack(timeline, trackId))`。主视频轨/旁白/音乐/字幕不显删轨项。
- `onLaneContextMenu` 需带 `trackId`(用于删轨/选中);现签名 `(e, track, clipId?)` 扩为带 trackId。

## ④ PIP 预览浮层编辑

文件:新 `timeline/PipOverlay.tsx`、`PreviewPlayer.tsx`(容器内叠 overlay)、`VgTimelineEditorPage.tsx`(transform 回写)。

- 预览容器内叠一层 `PipOverlay`:遍历**非主视频轨**(第 2+ video 轨)在当前 `playheadMs` 命中的 clip,
  每个渲染一个绝对定位框(显 clip 首帧缩略图 `materialThumbUrl`/占位),`left=x*W`、`top=y*H`、`width=scale*W`(高按素材比例或同 scale)。
- 交互:框体 pointer 拖动 → 改 `x/y`;右下角把手拖 → 改 `scale`;均按预览容器实际 px 反算回 0-1 归一。
- 回写:`onTransform(clipId, {x,y,scale})` → 编辑器 `setClipTransform` → patch timeline → 置 `proxyStale`。
- z 层级:PIP 框选中时给「上移/下移层级」小按钮 → 改 `z`。
- 编辑时底图 = 已渲染的主轨 proxy(或未生成时纯黑);点「生成预览」→ 后端真分层合成(⑤)。

## ⑤ compose 分层渲染(后端)

文件:`steps/compose.py`(`_build_pip_layers` + render_from_edl + render_proxy_from_timeline)。

- 纯函数 `_build_pip_layers(timeline, *, source_resolver) -> list[dict]`:
  取**第 2+ 条** `kind=='video'` 轨的 clips(第一条是主轨,不算 PIP),resolver 解析路径,产
  `[{path, x, y, scale, z, start_s, dur, is_image}]`,按 z 升序(底先合)。解析空跳过。
- `render_from_edl`:主轨拼接出 base(铺满画幅,现逻辑);PIP 层:
  - image → `ImageClip(path)`;video → `VideoFileClip(path).subclipped(...)`。
  - `.resized(width=video_width*scale)`、`.with_position((x, y), relative=True)`、`.with_start(start_s)`、`.with_duration(dur)`。
  - `final = CompositeVideoClip([base_clip, *pip_layers_sorted_by_z])`(base 先,PIP 按 z 叠上);再叠字幕/音频(沿用 generate_video 流程)。
  - 实现要点:现在 `generate_video` 接收 base 视频路径再合成字幕/音频;PIP 合成需在 base 之上、字幕之前。可在 `render_from_edl` 拼好带 PIP 的中间视频(CompositeVideoClip 写出),再交 `generate_video` 叠字幕/音频;或给 `generate_video` 传 pip_layers 一起合。plan 阶段定具体接法(优先:render_from_edl 内合 PIP→写中间文件→generate_video 叠字幕音频)。
- `render_proxy_from_timeline`(预览):同样分层(低清 + video-only,无需音频/字幕),让「生成预览」显示真实 PIP。
- 单条 PIP clip 渲染失败 → 跳过 + 告警,不整体崩。

## ⑥ 错误处理

- removeTrack 只删 removable;主轨/派生轨菜单无删项(双保险)。
- PIP transform 夹正:x/y ∈ [0,1],scale ∈ [0.05, 1]。
- PIP 源解析失败/渲染失败:该层跳过,base 正常出。
- 预览浮层:无第 2 视频轨时不显任何框。

## ⑦ 测试

- 前端 vitest:`addTrack`(追加 removable 空轨)、`removeTrack`(removable 守卫:非 removable 原样)、`setClipTransform`(夹正)。
- 后端 pytest:`_build_pip_layers`(只取第 2+ 视频轨、按 z 排序、归一坐标透传、解析空跳过;mock moviepy)。
- typecheck + 现有 vitest 不破 + web build。

## 文件清单(plan 阶段细化)

后端:
- `schemas.py` — TimelineClip + x/y/scale/z;TimelineTrack + removable/label。
- `steps/compose.py` — `_build_pip_layers` + render_from_edl/render_proxy 分层。
- `tests/unit_tests/test_vg_p5c2_pip.py`。

前端:
- `packages/api/src/videoGeneration.ts` — VgTimelineClip + x/y/scale/z;VgTimelineTrack + removable/label。
- `timeline/timelineTracks.ts`(新) — addTrack/removeTrack/setClipTransform(+测)。
- `timeline/TimelineTracks.tsx` — 动态多 video/audio lane + 选中态 + 加/删轨右键 + trackId 透传。
- `timeline/TrackContextMenu.tsx` — 加「添加视频/音频轨」「删除此轨」(removable)。
- `timeline/PipOverlay.tsx`(新) — 预览浮层拖拽/缩放。
- `timeline/PreviewPlayer.tsx` — 容器内叠 PipOverlay。
- `VgTimelineEditorPage.tsx` — addTrack/removeTrack/setClipTransform 接线 + selectedTrackId + PipOverlay 接 playheadMs。

## 非目标

- 关键帧动画、旋转、透明度。
- 视频轨之间转场。
- PIP clip 拖到任意时间点精确落点(沿用顺序 append + 把手)。
