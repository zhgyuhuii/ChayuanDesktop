# 时间轴编辑器 P5a 设计 —— 编辑合成入口 + 手动拖素材成片

> 状态:已用户审过设计(2026-05-29),待写 implementation plan。
> 前置:P1-P3(EDL schema/渲染、只读时间轴、交互编辑算子)、P4a(三区布局 + 预生成草稿 +
> 多轨只读可视化 + proxy 预览联动)已落地。

## 背景与目标

P4a 把时间轴做成三区 NLE 布局 + 自动预生成草稿(`stop_at=materials` 自动下素材)。
用户要求进一步走"手动编辑合成":从对话消息卡片进编辑器、自己从素材库拖素材到轨道、
旁白后台自动生成、字幕在下方、BGM 显示在轨。

**终极目标**是全真多轨 NLE(多视频层 PIP、多音频混音、任意加轨、编辑字幕/clip)。
按阶段交付,本 spec 是第一阶段 **P5a**,后续:
- **P5b**:编辑字幕(拖 cue 改时间+改文字)、编辑/替换 clip 源、额外音频轨 + 多音频混音。
- **P5c**:「添加轨道」任意加轨、多视频层画中画(CompositeVideoClip 分层)。

P5a 交付:消息卡片两按钮(自动生成视频 / 去编辑合成入口)、进编辑器只预生成旁白+字幕
(`stop_at=subtitle`)、视频轨初始空 + 从素材库拖 video/image 入轨(图像真渲染)、字幕轨
移到最下、BGM 轨显示已选背景音乐、finalize 放宽以渲染用户手拖的 EDL。

## 选定决策(brainstorming 结论)

| 维度 | 选择 |
|---|---|
| 多轨渲染目标 | B. 全真多轨 NLE(分阶段;P5a 先单视频轨手拖 + 图像渲染) |
| 编辑合成预生成 | A. 只自动生成旁白+字幕,素材手动拖 |
| 推进方式 | 分阶段,先 P5a |

## ① 消息卡片两按钮 + 去编辑合成数据流

文件:`packages/app/src/features/video-generation/VgMessageExtras.tsx`(改)、`VgChatPage.tsx`
(已有 `goTimeline`,传入 VgMessageExtras)。

- 「去生成视频」→ 改名**「自动生成视频」**。行为不变:打开 `MaterialsBgmOutputDialog`
  → `onConfirm` → `onSubmit(message.id)`(全自动 submitTask,后端自动下素材)。
- 新增**「去编辑合成」**按钮(`Film` 图标)。点击:
  1. `useVgComposer.getState()` 写 `params.video_script = message.content`、`params.script_source = 'manual'`
     (沿用 setScriptSlot/setScriptSource 或 patchParams);
  2. `resetDraft()`(清掉旧草稿,强制按新脚本重生);
  3. `goTimeline()`(`/video-generation/timeline`,已有路由 + openTab)。
- 两按钮并排;`onGoEdit` 由 VgChatPage 通过 props 传入 VgMessageExtras(与现有
  `onSubmit`/`onRegenerate` 同样的注入方式)。

## ② 草稿 `stop_at=subtitle` + 旁白等待/回填 + finalize 放宽

文件:`VgTimelineEditorPage.tsx`(改 P4a 草稿编排)、`service.py finalize_task`(改)。

- **草稿预生成改 `stop_at=subtitle`**:P4a 用 `stop_at='materials'`(自动下素材),P5a 改为
  `stop_at='subtitle'` —— 只跑 script→terms→tts→subtitle,**不下素材**。runner 现有
  `stop_at` 分支已支持(line 242 subtitle 后 return)。草稿 task `result` 含
  `audio_file`+`subtitle_path`,无 `materials`。
- 旁白轨:草稿 generating 时显"⏳ 正在按语音配置生成旁白…",`ready` 后拉 `audio-peaks`
  回填波形(P4a 已有 peaksLoading/回填逻辑,文案精修)。字幕轨拉 srt 回填 cue(P4a 已有)。
- **`finalize_task` 放宽校验**:P4a 要求 `result.audio_file && result.subtitle_path &&
  result.materials`。P5a 改为:要求 `audio_file && subtitle_path`,且**传入 timeline 的
  视频轨有 clip**(`materials` 不再要求 —— 素材来自用户拖入的 EDL,`_compose_via_edl` 的
  resolver 按 material_id/url 解析/下载)。校验逻辑:
  ```python
  vclips = [c for tr in timeline.get("tracks", []) if tr.get("kind") == "video" for c in tr.get("clips", [])]
  if not audio_file or not subtitle_path or not vclips:
      return False
  ```

## ③ 拖素材入轨 + 图像真渲染

文件:`timeline/MediaPoolPanel.tsx`(改:素材项 draggable)、新 `timeline/timelineEdit.ts`
加 `appendClipFromMaterial`(纯算子)、`TimelineTracks.tsx` 视频轨作 drop 区、
`steps/compose.py render_from_edl`(改:图像 clip)、`api_server` 新增素材首帧缩略图。

- **前端拖拽**:
  - MediaPoolPanel 内每个素材项 `draggable`,`onDragStart` 把素材标识塞进
    `dataTransfer`(JSON:`{materialId?, url?, kind: 'video'|'image', durationMs}`)。
  - 视频轨 lane 作 drop 区:`onDragOver` preventDefault、`onDrop` 解析 dataTransfer,
    调纯算子 `appendClipFromMaterial(timeline, material, atIndex)` 产新 timeline →
    `patchParams({ timeline })`。atIndex 由指针 x 落点 / 末尾决定(P5a 先 append 末尾,
    插入位置可后续增强;但 drop 落点计算到最近 clip 边界即可)。
  - 复用 P3 算子做拖入后的排序/裁剪/删除。
- **纯算子 `appendClipFromMaterial`**(timelineEdit.ts):
  ```ts
  export interface DraggedMaterial { materialId?: string; url?: string; kind: 'video' | 'image'; durationMs?: number; }
  export function appendClipFromMaterial(t: VgTimeline, m: DraggedMaterial, atIndex?: number): VgTimeline
  ```
  生成一个 clip:`source = m.materialId ? {material_id} : {url}`;`duration_ms = m.durationMs || (image ? 3000 : 5000)`;
  `out_ms=0`(整段/图像按 duration);插入到 atIndex 或末尾,recomputeStarts。
- **后端图像 clip**:`render_from_edl` / `_build_edl_render_plan` 在解析每个 clip 时按
  source 路径扩展名判断图片(`.jpg/.jpeg/.png/.webp/.bmp/.gif`)。图片用 moviepy
  `ImageClip(path).with_duration(dur)` 并规整到画幅(同视频的 resize/letterbox);视频沿用
  `VideoFileClip`。plan 给出 render plan 增 `is_image` 字段 + 渲染分支。
- **素材缩略图**:图像 clip 缩略图直接用 `videoGeneration.materialFileUrl(material_id)`;
  视频 clip 走新增 `GET /materials/{material_id}/thumb`(ffmpeg 首帧,复用 P4a media_probe
  `extract_thumbnail`,落盘缓存)。VgTimeline 的 `thumbUrlOf` 改为按 clip 的 source 解析:
  material_id → 上述 URL;url(http) → 占位/纯色。

## ④ 字幕轨下移 + BGM 显示

文件:`timeline/TimelineTracks.tsx`(改轨道顺序)。

- 轨道顺序改为:**视频 / 旁白 / 音乐(BGM)/ 字幕**(P4a 是 视频/旁白/字幕/音乐;P5a 把字幕挪到最下、音乐提到字幕之上)。
- BGM 轨显当前已选背景音乐:`bgm_type==='random'` → "随机背景音乐";否则 `bgm_file` 名;空 → "无背景音乐"。P4a 已有 BgmTrack,确认 P5a 始终传入 bgmName。

## ⑤ 错误处理

- 草稿 `stop_at=subtitle` 失败(TTS 失败):旁白轨显失败 + 顶部状态条"重试生成草稿"(P4a 已有)。
- 拖入非法素材(无 url/material_id):忽略 drop,不崩。
- finalize 时视频轨空:按钮禁用 + 提示"先拖素材到视频轨"。
- 图像 clip 渲染失败:该 clip 跳过并日志告警(不整体失败),沿用 render plan resolver 空跳过逻辑。

## ⑥ 测试

- 后端(pytest):
  - `stop_at='subtitle'` 草稿不产 materials(已有 stop_at 测试模式,补一条断言 result 无 materials key 或为空)。
  - `finalize_task` 放宽:给 audio+subtitle+timeline 有 clip → True;timeline 视频轨空 → False;无需 materials。
  - `_build_edl_render_plan` 对图片 source 标记 `is_image=True`、视频 `is_image=False`(纯函数,扩展名判断)。
- 前端(vitest):
  - `appendClipFromMaterial`:image 默认 3000ms / video 5000ms;source 用 material_id 优先;append 末尾 + recomputeStarts 紧贴;atIndex 插入。
  - 现有 timelineEdit / timelineScale / srtParse 单测不破。
- typecheck:`@chayuan/app` + `@chayuan/api`。

## 文件清单(plan 阶段细化)

后端:
- `steps/compose.py` — `_build_edl_render_plan` + `render_from_edl` 图像 clip 分支(+`is_image`)。
- `video_generation/service.py` — `finalize_task` 放宽校验。
- `api_server/video_generation_routes.py` — `+GET /materials/{material_id}/thumb`。
- `tests/unit_tests/test_vg_p5a_render.py` / `test_vg_finalize.py`(补放宽用例)。

前端:
- `packages/api/src/videoGeneration.ts` — `+vgMaterialThumbUrl`。
- `features/video-generation/VgMessageExtras.tsx` — 重命名 + 「去编辑合成」按钮 + `onGoEdit` prop。
- `features/video-generation/VgChatPage.tsx` — 传 `onGoEdit`(写 script+resetDraft+goTimeline)。
- `features/video-generation/VgTimelineEditorPage.tsx` — 草稿改 `stop_at='subtitle'`;视频轨 drop 区接拖拽。
- `features/video-generation/timeline/timelineEdit.ts` — `+appendClipFromMaterial`(+单测)。
- `features/video-generation/timeline/MediaPoolPanel.tsx` — 素材项 draggable(或在 MaterialsStep 卡片加 draggable)。
- `features/video-generation/timeline/TimelineTracks.tsx` — 轨道顺序(字幕下移)+ 视频轨 drop + thumbUrlOf 改素材级。

## 非目标(P5a 明确不做)

- 编辑字幕文字/时间(P5b)。
- 替换/编辑已有 clip 源(P5b)。
- 额外音频轨 + 多音频混音(P5b)。
- 「添加轨道」任意加轨(P5c)。
- 多视频层画中画 PIP(P5c)。
- drop 精确落点插入(P5a 先 append 末尾或就近边界,精确拖入排序留增强)。
