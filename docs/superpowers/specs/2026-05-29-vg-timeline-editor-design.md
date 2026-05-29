# 视频生成 · 时间轴可视化编辑器 Design

**日期**:2026-05-29
**范围**:chayuan-server(EDL schema + EDL 渲染 + 预览)+ chayuan-client(时间轴 UI + 交互)
**目标形态**:完整 NLE(裁剪/排序/多轨)+ EDL 所见即所得 + 服务端低清代理预览

---

## 1. 背景与目标

当前视频生成是**批量自动渲染**:用户配参数 → runner TTS → 按音频时长自动下载/挑素材、每段截 `max_clip` → ffmpeg 拼接 → 成片。素材的时长分配、与音频对齐全由服务端在渲染时自动决定,用户看不到也控制不了。

要做的是**时间轴可视化编辑器**:底部多轨道(视频/音频/字幕),素材拖拽排列/排序/删除/裁剪,下载的在线素材与素材库统一导入并加入轨道,点击预览。这要求把渲染从"自动拟合"演进到"**所见即所得 EDL**"——用户在轨道上排什么,成片就是什么。

**已确认决策**:
- 编辑器做到 **T3 完整 NLE**(裁剪 in/out、拖时长、多视频轨、转场)。
- 渲染采用 **EDL 所见即所得**。
- 整条预览用**服务端低清代理渲染**(避开浏览器帧级同步播放器的复杂度);单段预览在浏览器即时播。

---

## 2. EDL 数据模型(地基)

所见即所得的核心 = 一份用户编辑、渲染器照做的**剪辑决策表(EDL)**:

```
Timeline {
  version: 1
  duration_ms: int                  // 时间轴总长(= 音频轨长 / 最末 clip 终点取大)
  tracks: Track[]
}
Track {
  id: str
  kind: 'video' | 'audio' | 'subtitle'
  clips: Clip[]                      // video/audio 轨
  cues:  Cue[]                       // subtitle 轨(复用现有 SrtCue)
}
Clip {
  id: str
  source: { material_id?: str, path?: str, url?: str }  // 指向统一素材库 / 本地 / 在线
  track_start_ms: int                // 在轨道上的起点
  in_ms: int                         // 源素材裁剪入点(默认 0)
  out_ms: int                        // 源素材裁剪出点(默认 = 素材时长)
  transition?: 'none'|'fade'|'slide' // 入场转场(T4)
  volume?: float                     // 音频轨用
}
```

- **单一真源**:Timeline 存前端 `vgComposer.params.timeline`,提交时作 `VideoParams.timeline` 发后端;后端按它精确渲染。
- **音频轨**:第一条 = TTS 语音(渲染时生成,时长固定);可选第二条 = BGM。
- **字幕轨**:复用现有 `SrtCue`(start_ms/end_ms/text),由 TTS 的 cues 初始化,可编辑。
- **向后兼容**:`timeline` 缺省 → runner 走现有自动拟合路径,不破坏现功能/批量模式。

---

## 3. 分期路线

| 期 | 交付 | 依赖 |
|---|---|---|
| **P1** | EDL schema(后端 Pydantic + 前端 TS)+ runner EDL 渲染路径(ffmpeg 精确裁剪/拼接/叠音轨/烧字幕)+ 自动路径兼容 | 无(地基) |
| **P2** | 时间轴 UI(只读展示视频/音频/字幕轨)+ 统一「加入轨道」(库∪在线∪链接)+ 服务端低清代理预览整条 | P1 |
| **P3** | 交互编辑:拖拽排序、删除、拖柄裁剪 in/out、拖时长(改 EDL) | P2 |
| **P4** | 进阶:多视频轨叠加、转场、playhead 单段即时预览 | P3 |

**本设计聚焦 P1**(地基),P2-P4 各自再出 spec/plan。

---

## 4. P1 详细设计:EDL 模型 + 后端 EDL 渲染

### 4.1 Schema(`schemas.py`)
新增 Pydantic 模型 `TimelineClip` / `TimelineTrack` / `Timeline`(字段同 §2),`VideoParams` 加可选字段 `timeline: Optional[Timeline] = None`。前端 `videoGeneration.ts` 加对应 TS 类型,`VgVideoParams.timeline?`。

### 4.2 EDL 渲染(`steps/compose.py` + `runner.py`)
- 新增 `render_from_edl(timeline, audio_file, subtitle_path, output_file, params) -> str`:
  - 逐 video clip:moviepy `VideoFileClip(src).subclip(in_ms/1000, out_ms/1000)`(裁剪)→ 缩放/填充到 `video_aspect` 分辨率 → 记 `track_start_ms`。
  - 多 clip 按 `track_start_ms` 排序拼接(沿用 `concat_video_clips_with_ffmpeg` 思路,先各 clip 规整再 ffmpeg concat,避免逐段重编码)。
  - 叠加音频轨(TTS;BGM 若有按 `volume` 混音)。
  - 烧字幕(复用现有 `generate_video` 的字幕逻辑 / `subtitle.srt`)。
  - 时长错配策略:视频总长 < 音频 → 末段定格或循环补到音频长;> 音频 → 截到音频长。**P1 固定用"截断到音频长 + 不足末段定格"**,后续可配置。
- `runner.py` section 5/6:`if params.timeline: materials/compose 走 render_from_edl`;否则现有自动路径。terms/素材下载在有 timeline 时跳过(素材已由 EDL 指定)。

### 4.3 单元测试
- `test_timeline_schema`:Timeline 解析 + 默认值(in_ms=0、缺省 timeline 不破 VideoParams)。
- `test_edl_render_plan`:给定一个 2-clip timeline,`render_from_edl` 产出的 clip 列表/ffmpeg concat 顺序与 EDL 一致(可 mock moviepy,只验编排逻辑:顺序、subclip 区间、目标分辨率)。
- `test_backward_compat`:`timeline=None` 时 runner 仍走自动路径(现有用例不回归)。

---

## 5. 预览(P2 概要,P1 不实现)
新 `POST /preview`:吃 EDL(+ 已合成音频)→ 同一 `render_from_edl` 用低清(360p/15fps)出代理片 → 返 mp4。按 EDL hash 缓存。

---

## 6. 素材统一(已就绪,P2 接线)
在线/链接 ingest 已落统一素材库 `vg_materials`。时间轴「加入轨道」复用现有素材多选(库∪在线∪链接)→ 批量 append 成 video 轨 clips(默认整段 in/out、track_start 接上一段后)。下载素材天然在同一库,已连通。

---

## 7. 风险 / 边界
- **EDL→ffmpeg/moviepy 编排复杂度**是 P1 主要工程量(裁剪 + 多 clip 排列 + 音轨叠加 + 字幕)。P1 先做单视频轨,多轨叠加留 P4。
- **时长错配**:P1 固定"截断 + 末段定格"策略。
- **帧级浏览器同步播放器**:不做(用服务端代理预览)。
- **批量模式 / 现有自动路径**:`timeline=None` 必须零回归 —— 单测守住。

---

## 8. 验证
- 后端:`py_compile` + §4.3 三个单测。
- 兼容:现有视频生成(无 timeline)端到端不回归。
- P1 不含 UI;EDL 可由测试构造,渲染产物人工抽验一条。
