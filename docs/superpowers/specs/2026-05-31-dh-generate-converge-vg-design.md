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
