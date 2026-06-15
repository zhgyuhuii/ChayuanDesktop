# 语音合成对话模式整合(厂商模型 + 本地引擎)设计

日期:2026-06-16  状态:已与用户确认三项决策

## 背景
「语音合成」现为 chat 的 `tts` 对话模式(`composerMode.TTS_MODE`,paramKind `tts_voice`,
backendPath `modality`)。参数条 `TtsVoiceParamBar` 是阉割版(仅厂商音色下拉+语速 chips+格式),
缺本地引擎/音量/语言/克隆。VG 那边有全套 `VoicePicker`(piper/edge/sherpa/clone+语言过滤+
上传/录音/重命名/试听)。厂商 TTS(openai_compat / dashscope 连接器)经 `/v1/modality/completions`
按模型 capability 分发;本地引擎此前只在 VG 的 `audio/preview → tts.synthesize` 链路。

## 用户确认的三项决策
1. 形态:**升级对话模式参数条**(把 VoicePicker 全套搬进 tts 模式)。
2. 厂商 vs 本地切换:**统一下拉混排**(厂商真模型 + 本地引擎伪条目同一下拉)。
3. 后端:**完整打通**本地引擎到 modality 路由(复用 tts.synthesize)。

## 架构

### 伪模型约定
本地引擎用伪模型 id:`local-tts:piper` / `local-tts:edge` / `local-tts:sherpa` / `local-tts:clone`。
- 前端统一引擎下拉 = 厂商 TTS 真模型(models.list 过滤 capability 含 tts) + 4 个本地伪条目。
- transport `classifyModalityCapability` 把 `local-tts:*` 归为 `'tts'`,使 useModalitySubmit.shouldHandle=true、
  TtsVoiceParamBar 正常显示。

### 前端
- `TtsVoiceParamBar` 升级:
  - 顶部「合成引擎」下拉(厂商组 + 本地组)。选中写入 composer 选中模型(真 id 或 `local-tts:<engine>`)。
  - 选**本地** → 渲染 `VoicePicker`(provider=engine,language 受语言下拉控制,clone 引擎可上传/录音/重命名)
    + 语速滑条 + 音量滑条 + 语言下拉。值写入 modalityParams:
    `{ voice_provider, voice_name, voice_rate, voice_volume, language }`。
  - 选**厂商** → 沿用现有 vendor 音色下拉 + 语速(+ 格式);音量隐藏。值写入 modalityParams:`{ voice, speed, format }`。
- 复用真源:`VoicePicker` 整组件直接 import;语速/音量控件照搬 `VgAudioPopover`;vendor 音色映射沿用现有 `TtsVoiceParamBar`。

### 后端(/v1/modality/completions)
- `classify_capability`:`local-tts:*` → `'tts'`。
- 新增本地 TTS 连接器 `modality/router/connectors/tts/local.py`:当 `model` 以 `local-tts:` 开头时匹配,
  解析 engine = 冒号后部分,从 GenerateReq.params 取 `voice_name/voice_rate/voice_volume`,调
  `video_generation.steps.tts.synthesize(text, voice_file=<tmp>, voice_provider=engine, voice_name=..., voice_rate=..., voice_volume=...)`,
  把产出音频用 `modality/router/artifacts.save_bytes` 落地,emit 一个 file part(mediaType audio/wav 或 mp3)。
- 路由选择(routing/connector 注册)需让 `(tts, local-tts:*)` 命中 local 连接器,厂商模型仍走 openai_compat/dashscope。
- 向后兼容:vendor 路径与现有完全不变。

### 试听
- 本地:VoicePicker 内置试听(已走 `videoGeneration.previewAudio` → audio/preview)。
- 厂商:沿用现有(短文本合成);本期不强求新增。

## 数据流
ChatComposer(tts 模式)→ 升级版 TtsVoiceParamBar → composer.modalityParams + 选中模型 →
streamModality(model, prompt, params)→ POST /v1/modality/completions →
classify tts → dispatch:vendor→openai_compat/dashscope;local-tts→local 连接器→tts.synthesize→
save_bytes→file part(audio)→ 前端消息卡音频播放。

## 测试
- 前端:`npm run typecheck`;若抽出纯函数(如 engine 下拉条目构造 buildEngineOptions、
  local-tts id 解析 parseLocalTtsEngine)写 vitest。
- 后端:`local.py` connector 的 model 匹配 + engine 解析 + 参数透传做单元/ast 自检
  (py312 真跑 pytest);classify_capability(`local-tts:piper`)=='tts' 测试。

## 分期
- P1 后端:classify_capability 支持 local-tts:* + 新增 local TTS 连接器(调 tts.synthesize + save_bytes)
  + 路由注册 + params 透传;py compile/ast 自检。
- P2 前端:transport classifyModalityCapability 支持 local-tts:*;TtsVoiceParamBar 升级(统一引擎下拉 +
  本地复用 VoicePicker + 语速/音量/语言;厂商沿用 vendor 音色);写入 modalityParams。
- P3 联调:试听两路 + typecheck + vitest;真机验。

## 风险
- 厂商 TTS 模型在 model list 的 capability=tts 标记/注册机制需在 P2 确认(否则下拉厂商组为空)。
- modality 完成事件的音频 file part mediaType/URL 拼接(useModalitySubmit 已处理 `/v1/artifacts` 相对→绝对)。
- 克隆引擎运行时(voxcpm/cosyvoice)在 modality 路由下的可用性(复用 VG 同一 synthesize,理论一致)。
- 本机 py3.6 跑不了 pytest(运行时 py3.12),后端只能 ast 自检 + 真机验。
