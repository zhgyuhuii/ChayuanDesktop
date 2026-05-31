# 数字人生成接入 VG 文字成片管线 — 设计 spec

- 日期：2026-05-31
- 状态：设计已通过，待 spec review → 写 P1 实现计划
- 方向：方案 A（数字人作为 VG「文字成片」管线里的"会说话片段"生产者，最大化复用）

## 1. 背景

在已落地的多形象 M1-M6 基础上,用户提出二次诉求:
1. 每人各自音色 + 各自脚本(现状:预设单一 voice 给所有形象共用 —— 错误)。
2. 口播文案处可 LLM 生成 / 参考视频生成稿。
3. 时间轴可生成脚本、编辑字幕;改字幕后按编辑内容重合成。
4. 数字人片段+脚本/字幕深度进时间轴精编,字幕编辑回流合成。
5. 任务持久化(切走不丢) + 复用「我的视频」库。
6. (已独立修复 d096303)成片末尾黑屏。

## 2. 关键复用发现(定方向)

VG(video_generation)已内建用户要的大半能力,**不在数字人重造**:
- `steps/script.py`:LLM 文案/分镜生成。
- `SrtCue`(schemas.py) + 时间轴字幕编辑器:字幕结构与编辑。
- `steps/tts.py:synthesize_to_cues(text, target_duration_ms)`:**按字幕 cue 重合成**(字幕即脚本真源、改字幕→重合成的核心已存在)。
- 时间轴 NLE / PIP / 字幕轨(VgTimelineEditorPage)。
- 「我的视频」库 VideoLibraryPage、素材库 ingest_material / materials_store.create_material。

经典范式对齐:剪映/CapCut「文字成片」(文案/字幕是真源,改字幕重出片段)、HeyGen/D-ID(script→avatar,多场景每场景各自 avatar+voice)。统一抽象:**段(segment)列表**,每段 `{形象, 音色, 脚本}`;wav2lip 把段脚本变成人像片段;字幕/脚本真源,改→重合成该段。

## 3. 总体架构(方案 A)

数字人不再自建脚本/字幕/时间轴,而是:
- 提供"把(形象+音色+脚本)变成会说话人像片段"的能力(wav2lip,已存在)。
- 文案/字幕/时间轴一律复用 VG 管线。
- 多形象同框/分段 = 时间轴上多段,每段绑一个形象+音色+脚本。

## 4. 分期

- **P1 每人各自音色(数据模型纠正)** —— 修"新建设置错误",最基础。本 spec 详设。
- **P2 文案 LLM 生成 + 参考视频生成稿** —— 复用 script.py + whisper ASR。后续单独 spec。
- **P3 字幕驱动重合成 + 时间轴深度对接** —— 复用 SrtCue/synthesize_to_cues/时间轴;改字幕→重合成段→重跑 wav2lip。最大块,后续单独 spec。
- **P4 任务持久化 + 复用「我的视频」库** —— DH 任务落库 + 复用 VideoLibraryPage。后续单独 spec。

## 5. P1 详细设计

### 5.1 数据模型
`AvatarSlot`(schemas.py)增:
```
voice_provider: str = ""   # 空=继承预设级音色
voice_name: str = ""
```
语义:
- 单形象预设:用预设级 `voice_provider/voice_name`(不变,单音色)。
- 多形象:每槽可配自己音色;槽音色为空→回退预设级音色。
- 向后兼容:老槽无 voice 字段→默认空→回退,零破坏。

### 5.2 后端
- jobs.py 抽 `_voice_string(provider, name) -> Optional[str]`:集中 provider→synthesize voice 串映射
  (clone→`voxcpm:`/`cosyvoice-clone:`(读 clones_dir);sherpa→`sherpa:<name>`;piper/edge→name 原样;空→None)。
- 抽 `_synth_to_wav(text, provider, name, audio_path)`:用 `_voice_string` 取 voice → `AudioPipeline().synthesize` → 写文件。
- `_synthesize_narration(text, preset, audio_path)` 改为调 `_synth_to_wav(text, preset.voice_provider, preset.voice_name, audio_path)`。
- `_gen_slot_clips` 每槽:`provider = slot.voice_provider or preset.voice_provider`、`name = slot.voice_name or preset.voice_name`,调 `_synth_to_wav(seg_text, provider, name, a_path)`。
- create_preset / 路由透传:avatars 里已含 voice_*(随 AvatarSlot 一起),无需额外字段。

### 5.3 前端
- `PresetEditor` 多形象模式:每个已选槽行内,除 lines 文本框,加一个**紧凑 VoicePicker**(复用现有受控 VoicePicker),写回 `slot.voice_provider/voice_name`;不设=继承预设音色(占位提示"继承预设音色")。
- 前端类型 `AvatarSlot` 增 `voice_provider?/voice_name?`。

### 5.4 错误处理
- 槽音色为空/非法 → 回退预设音色(不报错)。
- 合成失败 → 现有逐段失败处理(跳过/回退首片段)不变。

### 5.5 测试
- store:多槽各带不同 voice → create_preset 回读一致。
- jobs:`_voice_string` 各 provider 输出正确前缀;`_gen_slot_clips` 用槽音色(fake synthesize 记录传入 voice 串)。
- 兼容:老预设(槽无 voice)→ 回退预设音色。

### 5.6 P1 非目标
脚本 LLM 生成 / 参考视频 / 字幕重合成 / 时间轴深度对接 / 任务持久化 —— P2-P4。

## 6. 风险/验证
沙箱仅 py3.6,pytest/typecheck 需用户 py312 跑。wav2lip 实际合成、moviepy 同框/分段渲染需实测。


---

# 附录 A：全设置矩阵 + 整合编辑器布局(2026-05-31 扩充)

## A.1 设置全景(预设级=存进数字人复用;生成级=每次出片可调)

| 组 | 设置 | 级别 | 现状 | 落地期 |
|---|---|---|---|---|
| 形象与人物 | 形象选择(图/视频)、单/同框/分段、同框版式 | 预设 | ✅ | 已有 |
| 形象与人物 | 每形象位置/缩放微调(同框) | 预设 | ❌ | P5 |
| 形象与人物 | 绿幕/抠像去背景 | 生成 | 🟡 matte | 已有 |
| 音色 | provider+voice、每形象各自音色 | 预设 | ✅ | P1 ✅ |
| 音色 | 语速/音量(复用 VG voice_rate/volume) | 预设 | ❌ | P1.5 |
| 音色 | 语调pitch/停顿 | 预设 | ❌ | 后置 |
| 脚本字幕 | 口播文案、每形象分段台词 | 生成 | ✅ | 已有 |
| 脚本字幕 | LLM 生成文案 / 参考视频生成稿 | 生成 | ❌ | P2 |
| 脚本字幕 | 字幕开关/位置/样式(复用 VG) | 生成 | ❌ | P3 |
| 脚本字幕 | 字幕编辑→重合成(synthesize_to_cues) | 生成 | ❌ | P3 |
| 画布 | 尺寸/宽高比(竖9:16/横16:9/方1:1) | 预设 | ❌ 写死720x1280 | P1.5 |
| 画布 | 分辨率档(720p/1080p)、fps | 预设/生成 | ❌ 固定25fps | P1.5 |
| 引擎 | wav2lip/sadtalker/musetalk | 生成 | ✅ | 已有 |
| 背景叠加 | 商品图+版式、绿幕抠像 | 生成 | ✅ | 已有 |
| 背景叠加 | 背景替换(纯色/图/视频) | 生成 | ❌ | P5 |
| 输出 | 格式mp4、任务持久化/我的视频 | 生成 | 🟡 | P4 |

## A.2 UI:整合编辑器(左预览 / 右分组面板)

定:把「新建/编辑数字人」与「生成」合并为一个**整合编辑器**(参考 HeyGen/剪映),
取代现有 DigitalHumanPage 的双 tab(实时对话页 LiveAvatarPage 独立保留)。

布局:
```
┌─ 数字人编辑器 ───────────────────┬─ 设置面板(右,分组折叠)──────┐
│  预览画布(按宽高比)               │ ▸ 形象与人物 (模式/网格/版式)  │
│   - 显示当前形象/同框版式          │ ▸ 画布 (尺寸比例/分辨率/fps)   │
│   - 字幕位置示意                   │ ▸ 音色 (单/每形象 + 语速音量)  │
│   - 比例随画布设置变               │ ▸ 文案 (输入 + AI生成/参考视频)│
│                                   │ ▸ 背景/叠加 (商品图/抠像/背景) │
│                                   │ ▸ 字幕 (开关/位置/样式)        │
│                                   │ ▸ 引擎/输出                    │
│  [预设另存]      [开始生成]        │                                │
├───────────────────────────────────┴──────────────────────────┤
│ 任务区: 进行中进度 + 历史(复用「我的视频」VideoLibraryPage)     │
└──────────────────────────────────────────────────────────────┘
```
原则:
- 预设级设置改动可「另存为/更新数字人」;生成级设置即时用于「开始生成」。
- 分组默认展开常用(形象/画布/音色/文案),高级(背景/字幕/引擎/输出)折叠。
- 预览区是纯展示(画布比例 + 形象 + 版式 + 字幕位置),不阻塞业务。
- 组件复用:VoicePicker、KnowledgePicker/ModelPicker(若文案用 LLM)、VG 的字幕样式控件、VideoLibraryPage、DhProgressCard。

## A.3 修订分期(覆盖原 §4)

- **P1 ✅** 每形象各自音色(已实现已推)。
- **P1.5 整合编辑器外壳 + 画布(尺寸/比例/分辨率/fps) + 语速/音量** —— 大前端重构:
  搭整合编辑器骨架(左预览/右分组面板),把现有预设+生成设置迁入分组;预设加
  video_width/height/fps(+ AvatarSlot voice_rate/volume);wav2lip 用预设画布尺寸/fps。
- **P2** 文案 LLM 生成 + 参考视频生成稿(复用 script.py + ASR),接入编辑器「文案」组。
- **P3** 字幕(开关/位置/样式 + 编辑→synthesize_to_cues 重合成)+ 时间轴深度对接。
- **P4** 任务持久化 + 复用「我的视频」库。
- **P5** 背景替换 + 每形象位置/缩放微调 + (后置)pitch/停顿。

## A.4 兼容与风险
- 整合编辑器替换 DigitalHumanPage 双 tab,但**保留底层 store/路由/PresetEditor 子组件**逐步迁移,避免一次性大爆破;LiveAvatarPage 不动。
- 预设新增字段(video_width/height/fps、slot voice_rate/volume)均带默认值,向后兼容。
- 沙箱仅 py3.6,前端无 toolchain:pytest/typecheck 需用户 py312 实测。
