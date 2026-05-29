# 时间轴编辑器 P5b 设计 —— 编辑字幕 / 替换 clip / 插入音频轨混音 / 清理草稿

> 状态:已用户审过设计(2026-05-29),待写 implementation plan。
> 前置:P1-P3、P4a、P5a(消息卡入口 + 手拖素材成片 + 图像渲染 + finalize 放宽)已落地。

## 背景与目标

P5a 让用户从对话进时间轴、手拖 video/image 成片(只读旁白/字幕/BGM 轨)。P5b 加入
**编辑能力**:编辑字幕(时间+文字)、替换 clip 源、插入额外音频轨并真混音、清理草稿 task。
终极目标仍是全真多轨 NLE,本阶段后剩 P5c(添加任意轨 + 多视频层画中画 PIP)。

## 选定决策(brainstorming 结论)

| 维度 | 选择 |
|---|---|
| 字幕编辑回传 | A. `finalizeDraft(taskId, timeline, subtitleCues?)`,服务端收 cues 写 srt 覆盖 |
| 额外音频轨 | A. 一条独立「插入音频」轨,clip 按 `track_start_ms` 定位,compose `with_start` 混音 |
| clip 替换 | 选中 clip 工具条「替换素材」→ 素材选择窗 → `replaceClipSource`(保留 in/out) |
| 草稿清理 | finalize 升 `stop_at='video'` + 「视频任务」过滤 `stop_at != 'video'` |

## 现状(已确认)

- `compose.generate_video(video_path, audio_path, subtitle_path, params)`:旁白
  `AudioFileClip(audio_path)×voice_volume`,若 `get_bgm_file(params.bgm_type, params.bgm_file)`
  命中则 `CompositeAudioClip([旁白, bgm(loop)])`;字幕从 `subtitle_path`(srt 文件)经
  `SubtitlesClip` 渲染。**旁白+BGM 混音已存在**;timeline 的 audio 轨当前完全不读。
- `render_from_edl(timeline, audio_file, subtitle_path, output_file, params, *, source_resolver)`:
  只取 video 轨拼接 → `generate_video`。
- `finalize_task(task_id, timeline, owner_id)`(P5a):校验 audio+subtitle+视频轨有 clip,
  set `params.timeline`,`runner.enqueue_finalize` → `_run_finalize` → `_compose_via_edl` →
  `render_from_edl`。
- 「视频任务」列表 = `VgTaskListPanel`(`videoGeneration.listTasks`,前端按 state 分组)。

## ① 编辑字幕(拖 cue 改时间 + 改文字)

文件:`timeline/SubtitleCueTrack.tsx`(改:可编辑)、`timeline/subtitleEdit.ts`(新:纯算子+测)、
`VgTimelineEditorPage.tsx`(改:cues 编辑态 + finalize 传 cues)、`packages/api/src/videoGeneration.ts`
(改:`vgFinalizeDraft` 加可选 `subtitleCues`)、`service.py`/`runner.py`(改:finalize 收 cues 写 srt)。

- `SubtitleCueTrack` 升级 editable:每个 cue 块
  - 左右把手 pointer 拖拽 → 改 `startMs`/`endMs`(同 P5a 视频 clip 把手模式);
  - 点 cue body → 弹小输入框(inline `<input>` 或浮层)改 `text`;
  - 回调 `onCuesChange(cues)`。
- 纯算子 `subtitleEdit.ts`:
  ```ts
  export interface SrtCue { startMs: number; endMs: number; text: string; }
  export function editCueTime(cues: SrtCue[], i: number, startMs: number, endMs: number): SrtCue[]
  export function editCueText(cues: SrtCue[], i: number, text: string): SrtCue[]
  export function cuesToSrt(cues: SrtCue[]): string
  ```
  `editCueTime` 夹正(`end ≥ start + 200ms`,`start ≥ 0`);`editCueText` 空字符串保留(渲染时占位)。
- 编辑器:草稿 ready 时 `setCues(parseSrt(...))`(P5a 已有);本地 `cues` 状态成为编辑真源,
  `SubtitleCueTrack` 的 `onCuesChange` 写回 `setCues`。
- 提交:`finalizeDraft(draft.taskId, timeline, cues)`。后端 `finalize_task` 新增可选
  `subtitle_cues` 参数:若非空,用 `cuesToSrt`(后端等价实现)写一份 `edited.srt` 到 task_dir,
  把该路径作为 `subtitle_path` 传 `_run_finalize`/`_compose_via_edl`(覆盖草稿原 srt);否则用
  草稿 `result.subtitle_path`。
  > 后端 `finalize_task` 与 `enqueue_finalize`/`_run_finalize` 增加 `subtitle_path` 覆盖参数。

## ② 编辑/替换 clip 源

文件:`timeline/timelineEdit.ts`(新算子 `replaceClipSource`+测)、`timeline/VgTimeline.tsx`
(选中 clip 工具条加「替换」按钮)、`VgTimelineEditorPage.tsx`(替换素材选择窗 + 回调)。

- 纯算子:
  ```ts
  export function replaceClipSource(t: VgTimeline, clipId: string, source: { material_id?: string; url?: string }): VgTimeline
  ```
  只换 `source`,保留 `in_ms/out_ms/duration_ms/track_start_ms`;recomputeStarts 不必(时长未变)。
- `VgTimeline` 选中 clip 的 `[‹][›][🗑]` 工具条加「替换」按钮 → 回调 `onReplaceClip?(clipId)`。
- 编辑器:`onReplaceClip` 打开素材选择小窗(复用 `<MaterialsStep>` 包一个 Dialog,或简化的素材网格)→
  选中 → `replaceClipSource(timeline, clipId, {material_id|url})` → patchParams。
- 裁剪 in/out 沿用 P3 把手,不改。

## ③ 插入音频轨 + compose 按位混音

文件:`timeline/timelineEdit.ts`(`appendAudioClip` 算子+测)、`timeline/AudioInsertTrack.tsx`(新)、
`timeline/TimelineTracks.tsx`(加第 5 轨 + audio drop)、`steps/compose.py`(`render_from_edl` 抽 audio 轨
→ `generate_video(extra_audios=...)`)、`VgTimelineEditorPage.tsx`(audio drop 回调)。

- 轨道由 P5a 的 4 轨扩为 **5 轨**,顺序:视频 / 旁白 / **插入音频** / 音乐(BGM) / 字幕。
  `lanesH = TRACK_H * 5`;左侧轨道头加「音频」行。
- 拖拽:MaterialsStep audio 素材(mime `audio/*`)`onDragStart` 设 `kind:'audio'`;
  插入音频轨作 drop 区 → `appendAudioClip(timeline, m, atIndex?)`。
  ```ts
  export function appendAudioClip(t: VgTimeline, m: DraggedMaterial, atIndex?: number): VgTimeline
  ```
  写进/新建 `kind==='audio'` 轨;clip `out_ms = m.durationMs || 0`(0=整段);**audio 轨不 recomputeStarts**
  (插入音频按用户放置位置,不强制紧贴;P5b 先 append 到当前末尾 = 上一音频 clip 末尾,或 0)。
  > 简化:P5b audio clip `track_start_ms` = 该轨现有 clips 末尾(顺序排);精确拖到任意时间点留增强。
- `AudioInsertTrack.tsx`:按 `track_start_ms`+`clipDurMs` 绝对定位音频 clip 块(显文件名/波形占位)。
- 后端 `render_from_edl`:抽 `kind=='audio'` 轨 clips → resolver 解析路径 →
  `extra_audios = [{path, start_s: track_start_ms/1000, volume: clip.volume ?? 1.0}]` →
  传 `generate_video(..., extra_audios=extra_audios)`。
- `generate_video` 新增可选 `extra_audios`:对每个 `{path,start_s,volume}` 建
  `AudioFileClip(path).with_effects([MultiplyVolume(volume)]).with_start(start_s)`,加入
  现有 `CompositeAudioClip([旁白, (bgm), *extra])`。解析/打开失败的跳过并告警。

## ④ 清理草稿 task

文件:`service.py finalize_task`(改)、`VgTaskListPanel.tsx`(改:过滤)。

- `finalize_task`:在 set timeline 后,把该 task 的 `stop_at` 持久化升为 `'video'`
  (`tasks_store.update_progress(task_id, ...)` 无 stop_at 字段?需确认 —— 若 update_progress 不支持
  改 stop_at,加一个 `tasks_store.set_stop_at(task_id, 'video')` 或在 update 里支持)。这样 finalize 后
  的渲染任务作为正常 video 任务出现在列表 + 显进度。
- `VgTaskListPanel`:`tasks.filter((t) => t.stop_at === 'video')` —— 未 finalize 的
  `stop_at=subtitle` 草稿不再露出;finalize 后(已升 'video')正常显示。

## ⑤ 错误处理

- 字幕:`editCueTime` 夹正(end≥start+200,start≥0);空文字保留(srt 写空行渲染时跳过)。
- 替换源:UI 仅允许同类替换(视频 clip 换 video/image,不允许换 audio);算子不校验类型(纯数据),UI 限制。
- 插入音频:解析失败该 clip 跳过(resolver 空 → 不加 extra_audio);compose 不因单条失败整体崩。
- finalize 写 srt 失败:回退用草稿原 srt(try/except),不阻断渲染。

## ⑥ 测试

- 前端 vitest:`editCueTime`(夹正)、`editCueText`、`cuesToSrt`(格式)、`replaceClipSource`(保留 in/out)、
  `appendAudioClip`(写 audio 轨、整段/指定时长)。现有 timeline 单测不破。
- 后端 pytest:`finalize_task` 收 cues 写 srt 并以其为 subtitle_path(mock 断言);
  `render_from_edl` 抽 audio 轨传 extra_audios(纯计划/抽取逻辑,mock moviepy);
  `cues_to_srt`(后端)格式;`list_tasks`/前端过滤草稿(前端断言或后端不变+前端过滤)。
- typecheck `@chayuan/app`+`@chayuan/api`;web build。

## 文件清单(plan 阶段细化)

后端:
- `steps/compose.py` — `render_from_edl` 抽 audio 轨 + `generate_video(extra_audios=)`;`cues_to_srt` 工具。
- `service.py` / `runner.py` — `finalize_task`/`enqueue_finalize`/`_run_finalize` 加 `subtitle_path` 覆盖参数;finalize 升 stop_at='video'。
- `store/tasks.py` — 若 `update_progress` 不支持改 stop_at,加支持/新函数。
- `api_server/video_generation_routes.py` — `finalize` 路由 body 收 `subtitle_cues`。
- `tests/unit_tests/test_vg_p5b_*.py`。

前端:
- `packages/api/src/videoGeneration.ts` — `vgFinalizeDraft(taskId, timeline, subtitleCues?)`;`SrtCue` 导出。
- `features/video-generation/timeline/subtitleEdit.ts`(+测)、`timelineEdit.ts`(+`replaceClipSource`/`appendAudioClip`+测)。
- `features/video-generation/timeline/SubtitleCueTrack.tsx`(可编辑)、`AudioInsertTrack.tsx`(新)、`TimelineTracks.tsx`(5 轨+audio drop)、`VgTimeline.tsx`(替换按钮)。
- `features/video-generation/VgTimelineEditorPage.tsx`(cues 编辑态+finalize 传 cues、替换窗、audio drop)。
- `features/video-generation/steps/MaterialsStep.tsx`(audio 素材拖拽 kind='audio')。
- `features/video-generation/VgTaskListPanel.tsx`(过滤草稿)。

## 非目标(P5b 不做,留 P5c)

- 「添加任意轨」(P5b 固定 5 轨)。
- 多视频层画中画 PIP。
- 插入音频/字幕 cue 拖到任意时间点的精确落点(P5b 顺序 append + 把手微调即可)。
