# 时间轴编辑器 P4a 设计 —— 界面重设计 + 预生成草稿 + 多轨可视化 + 预览联动

> 状态:已用户审过设计(2026-05-29),待写 implementation plan。
> 前置:P1(EDL schema + 渲染)、P2(只读时间轴 + 画面预览 + /preview-edl)、
> P3(交互编辑 reorder/delete/裁 in/拖时长)已落地。

## 背景与目标

当前时间轴编辑器被塞在一张小卡片里,时间轴宽度 = 时长×12px(30s 才 360px),
"太短/另类",违反主流剪辑器(剪映/CapCut、Premiere、DaVinci)的界面铁律。用户
要求参考专业剪辑器整体重设计,**轨道是主角、全宽、可缩放**,并配预览联动。

P4a 是"全可编辑 NLE"终极目标的**第一阶段(地基)**,交付:三区经典布局 + 时间标尺
+ zoom + 播放头 + 全宽多轨 + 轨道头 + V 轨缩略图 + 旁白/字幕/BGM 三轨**只读**可视化
+ proxy 预览联动 + 预生成草稿(自动+缓存)。

后续阶段(各自单独 spec):
- **P4b**:字幕轨可编辑(拖 cue 改起止时间 + 改文字 → 编辑后 srt 回传 compose)。
- **P4c**:音频/BGM 轨可编辑(换/裁 BGM、旁白音量/替换)。

## 选定决策(brainstorming 结论)

| 维度 | 选择 |
|---|---|
| 整体布局 | A. 三区经典布局(左小素材库可折叠 + 右大预览 / transport / 全宽多轨) |
| 预览联动 | A. proxy 渲染 + 播放头联动(复用 `previewEdl`) |
| 轨道内容 | B. 预生成真实内容(旁白波形 / 字幕 cue / BGM / V 轨缩略图) |
| 预生成触发 | C. 自动 + 缓存(首次进页自动生成,scriptHash 失效判断) |
| 可编辑性 | C 终极目标全可编辑;**P4a 仅 V 轨可编辑(P3 已有),A/字幕/BGM 只读** |
| 推进方式 | 分阶段,先 P4a |

## ① 数据流 / 草稿模型(核心)

复用现有 pipeline,不另造一套。后端 `stop_at` 已支持
`script/terms/audio/subtitle/materials/video`,且 `stop_at="materials"` 会把
`audio_file` / `subtitle_path` / `materials[]` **落库**到 task 行 —— 这正是草稿缓存单元。

```
进编辑器 → 有脚本且无有效草稿?
  → submitTask(params, stop_at="materials")   # script→terms→tts→subtitle→materials,不 compose
  → 轮询直到 draft task 完成(沿用 listTasks / getTask 轮询)
  → 拿到 draft.task_id + audio_file + subtitle_path + materials[]
  → 缓存进 store(带 scriptHash)
编辑 V 轨(排序 / 裁 in / 拖时长,P3 算子已有)
提交生成 → finalize 草稿:POST /tasks/{draft_id}/finalize {timeline}
  → compose 复用草稿已生成的 audio/subtitle/materials + 编辑后的 EDL → 成片
```

**收益**:旁白/字幕只在草稿期生成一次,最终渲染不重跑 TTS;草稿即一个
`stop_at=materials` 的 task,天然可缓存、可复用。

**失效判断**:store 存 `scriptHash = hash(video_script + voice_provider + voice_name +
voice_rate + voice_volume + bgm_type + bgm_file + video_language + paragraph_number)`。
进页面比对当前 params 的 hash 与缓存草稿的 hash,**不一致才重新生成草稿**。
注意:`video_aspect` / `timeline` / 素材排列**不计入** scriptHash —— 它们不影响
旁白/字幕,改它们不该触发重生成。

**草稿状态存哪**:vgComposer store 新增非提交字段(不进 `params`,不污染最终
submit body):

```ts
interface VgTimelineDraft {
  taskId: string;
  scriptHash: string;
  state: 'idle' | 'generating' | 'ready' | 'failed';
  audioFileName: string | null;     // /files/{taskId}/{name} 取音频
  subtitleFileName: string | null;  // /files/{taskId}/{name} 取 srt
  materials: { idx: number; path: string; durationMs: number }[];
  error?: string;
}
```

## ② 后端改动(3 处)

文件:`api_server/video_generation_routes.py`(路由) + `video_generation/service.py`
或 `runner.py`(finalize 逻辑) + 一个 `steps/media_probe.py`(波形/缩略图纯工具)。

### 2.1 `POST /video-generation/tasks/{task_id}/finalize`

body:`{ "timeline": <Timeline> }`。取该 draft task 持久化的
`audio_file`/`subtitle_path`/`materials`,把 `params.timeline` 设为传入 timeline,
**只跑 compose 步**(复用 `compose.render_from_edl` + 现有 `_compose_via_edl` 路径),
完成后 task 置 complete、写 `vg_videos`。

- 校验:draft task 必须存在、owner 匹配、`state` 为已停在 materials(有
  audio_file/subtitle_path/materials)。否则 400/404。
- 不重跑 tts/subtitle/materials(断言:finalize 路径不调 `_tts_step` / `_subtitle_step`
  / `_resolve_materials`)。
- 复用 runner executor 异步跑(返回 task_id,前端轮询)。

### 2.2 `GET /video-generation/files/{task_id}/audio-peaks?n=600`

读该 task 的 `audio_file`,ffmpeg 解码为单声道 PCM,下采样成 `n` 个峰值(0~1),
返回 `{ "peaks": number[], "duration_ms": int }`。

实现:`ffmpeg -i <audio> -ac 1 -ar 8000 -f s16le -`(stdout),numpy 读 int16,
分 `n` 段取每段 `max(abs)` 归一化。无 numpy 时纯 Python 也可(8000Hz×时长,量级 OK)。
落盘缓存 `<task_dir>/peaks_{n}.json`,二次直接返回。

### 2.3 `GET /video-generation/files/{task_id}/thumb?src={idx}&t={sec}`

对该 task `materials[idx]` 的视频文件 `ffmpeg -ss {t} -i <file> -frames:v 1
-vf scale=160:-1 -y <thumb.jpg>` 抽帧,落盘缓存 `<task_dir>/thumb_{idx}_{t}.jpg`,
返回 `FileResponse`(image/jpeg)。P4a 每 clip 只取首帧(t=0)即可。

## ③ 前端组件结构(三区布局)

`VgTimelineEditorPage` 重写为三区容器。时间轴拆成小组件,各自单一职责、可单测。
新目录 `features/video-generation/timeline/`(已存在,扩充)。

```
VgTimelineEditorPage              # 布局容器 + 草稿编排 + finalize
├─ 上半(flex)
│  ├─ MediaPoolPanel             # 左, 可折叠, 复用 <MaterialsStep/>(素材不是重点→收窄)
│  └─ PreviewPlayer              # 右大, <video> 播 previewEdl proxy, 吐 onTime(ms)
├─ TransportBar                  # ▶/⏸ + 时间码 mm:ss/mm:ss + zoom 滑块 [-]●[+]
└─ TimelinePanel                 # 全宽
   ├─ TimeRuler                  # 顶部刻度(随 pxPerSec/scroll), 点击 seek
   ├─ Playhead                   # 竖线, 绑 playheadMs, 拖动 seek
   └─ TimelineTracks             # 全宽, 横向滚动, 左侧固定 TrackHeader 列
      ├─ VideoTrack              # 复用/升级 P3 VgTimeline 的 video 轨 + 缩略图   [可编辑]
      ├─ AudioTrack              # 旁白波形(audio-peaks)                          [只读]
      ├─ SubtitleTrack           # 字幕 cue 块(srt→cue)                          [只读]
      └─ BgmTrack                # 已选 BGM 块(params.bgm_*)                      [只读]
```

纯函数 / 工具(单测):
- `timelineScale.ts`:`pxPerSec` ↔ px 换算、`totalSec(timeline, audioDurationMs)`。
- `srtParse.ts`:srt 文本 → `{startMs,endMs,text}[]`。
- 复用 `timelineEdit.ts`(P3)。

交互要点:
- **zoom**:`pxPerSec` 状态(范围 4~120,默认按容器宽 fit 到总时长);`[-]●[+]` 调;
  标尺 / 轨道 / 播放头共用同一 `pxPerSec` 与同一横向 scrollLeft(滚动同步)。
- **全宽 + 横滚**:轨道容器 `w-full overflow-x-auto`,内容宽 = `totalSec * pxPerSec`
  —— 根治"太短"。
- **轨道头**:左侧固定列(V/旁白/字幕/音乐 标签 + 每轨可折叠);右侧 clip 区横滚。
- `totalSec = max(草稿旁白音频时长, V 轨片段总长)` —— 旁白长度是画布基准。
- V 轨 clip 宽 = `clipDurMs/1000 * pxPerSec`,首帧缩略图作背景。

## ④ 预览联动

- `PreviewPlayer` 的 `<video src={proxyUrl}>` 播放 `previewEdl` 渲染的 proxy。
- `<video> onTimeUpdate` → 设容器状态 `playheadMs = currentTime*1000`。
- `Playhead` 按 `playheadMs` 定位竖线(left = `playheadMs/1000 * pxPerSec` − scrollLeft)。
- 点 `TimeRuler` / 拖 `Playhead` → 算出目标秒 → set `video.currentTime`。
- 改了 V 轨(timeline 变化)→ 当前 proxy 失效:置 `proxyStale=true`,预览区显
  "重新生成预览" 按钮(点了再调 previewEdl)。不自动重渲染(省算力)。

## ⑤ 错误处理

- 草稿生成失败(materials 解析空 / TTS 失败):draft.state='failed',编辑器显错误条 +
  "重试生成草稿" 按钮(重新 submit stop_at=materials)。
- audio-peaks / thumb 失败:对应轨道降级为占位灰条 / 无缩略图纯色块,不阻断编辑。
- finalize 失败:沿用现有 reportError + task 失败态,可在"我的视频/视频任务"重试。
- 无脚本进编辑器:显空态提示"先在对话/批量生成脚本"。

## ⑥ 测试

- 前端纯函数单测(vitest,沿用 timelineEdit.test 模式):
  - `timelineScale`:pxPerSec↔px、totalSec(含旁白>片段总长 / 反之)。
  - `srtParse`:多 cue、含中文、空行容错。
- 后端单测(pytest):
  - finalize 复用 audio/subtitle 不重生成(mock,断言不调 tts/subtitle/materials 步)。
  - audio-peaks 下采样返回定长 `n` 数组 + duration_ms(给定固定 PCM)。
  - peaks/thumb 缓存命中(二次不重跑 ffmpeg)。
- typecheck:`@chayuan/app` + `@chayuan/api`。

## 文件清单(plan 阶段细化)

后端:
- `api_server/video_generation_routes.py` — +finalize / +audio-peaks / +thumb 路由。
- `video_generation/service.py` 或 `runner.py` — finalize 编排(只 compose)。
- `video_generation/steps/media_probe.py`(新) — 波形下采样 + 抽帧纯工具。
- `tests/unit_tests/test_vg_finalize.py` / `test_vg_media_probe.py`(新)。

前端:
- `packages/api/src/videoGeneration.ts` — +finalizeDraft / +audioPeaksUrl / +thumbUrl + 类型。
- `features/video-generation/VgTimelineEditorPage.tsx` — 重写三区 + 草稿编排。
- `features/video-generation/timeline/` — TimeRuler / Playhead / TransportBar /
  PreviewPlayer / TimelineTracks / TrackHeader / AudioTrack / SubtitleTrack / BgmTrack /
  MediaPoolPanel + `timelineScale.ts` / `srtParse.ts`(+ 各 *.test.ts)。
- `features/video-generation/store/vgComposer.ts` — +VgTimelineDraft 状态 + scriptHash。

## 非目标(P4a 明确不做)

- 字幕 / 旁白 / BGM 的编辑(留 P4b/P4c)。
- 逐帧 scrub 预览(用 proxy 渲染替代)。
- 多视频轨 / 画中画 / 转场可视化。
- clip 跨轨拖拽。
