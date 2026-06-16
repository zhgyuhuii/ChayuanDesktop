# 对话产出 → 内联产出面板框架 设计(P1:语音合成)

日期:2026-06-16  状态:框架与分期已与用户确认,P1 待实现

## 背景与目标
普通对话中,用户让模型「生成 XXX(图像/视频/音频/文稿…)」。对话模型产出文稿/提示词后,
在该条 assistant 消息**下方内联**显示对应类型的「产出面板」:可编辑提示词 + 模型选择 +
类型设置(复用现成 ParamBar)+「确定」→ 走生成 → 产物挂到消息(持久化)+ 下载。
普通对话任意 assistant 消息也能手动触发。

## 已确认决策
1. 面板形态:**消息下方内联展开**。
2. 自动触发判定:**LLM 判意图**(配关键词兜底)。
3. 产物:**持久化到消息**(刷新/重开还在)。
4. 范围:**A 类全做**——语音合成(P1)/ 文生图·图像编辑(P2)/ 文生视频·图生视频(P3)。
5. B 类(Word/PDF/PPT/Excel 等需新后端):**本轮不做**,后续单独立项。

## 架构(一次设计,多类型复用)

### 类型注册表 `ACTION_TYPES`(`features/chat/messageActions/actionTypes.ts`)
每类型一条:
```ts
interface ActionType {
  key: 'tts' | 't2i' | 'image_edit' | 't2v' | 'i2v';
  label: string;            // 「合成语音」「生成图像」…
  icon: ComponentType;
  capability: ModalityCapability;  // 模型选择按此过滤
  Settings: React.FC<ActionSettingsProps>;  // 复用 ParamBar 的受控版
}
```
P1 只注册 `tts`。P2/P3 加其余。

### 意图识别 `detectActionIntent`(`messageActions/intentDetect.ts`)
- 输入:用户消息文本(+ 可选助手产出)。
- 关键词兜底(同步):`合成语音/生成语音/朗读/读出来/转语音`→tts;`生成图/画一张/配图`→t2i;
  `生成视频/做个视频`→t2v;`让.*动起来/图生视频`→i2v 等。
- LLM 主判(异步):用对话模型一次结构化调用,返回 `{ type, prompt }`(type 含 none)。
  失败/超时回退关键词结果。
- 纯函数 `parseIntentResult(raw)` 解析 LLM 输出,vitest 覆盖。

### `MessageActionPanel`(`messageActions/MessageActionPanel.tsx`,消息下方内联)
- 可编辑提示词 textarea(默认 = 助手产出 或意图提取的 prompt)。
- 模型选择:复用 `ModelMenuList`/`ComposerModelPill` 思路,按 `actionType.capability` 过滤;
  语音类含本地引擎(沿用 local-tts:* 机制)。
- 类型设置:渲染 `actionType.Settings`(受控,自带 state,不依赖 composer store)。
- 「确定生成」→ `streamModality({ model, prompt, params })` 收 file part →
  产物 url(`/v1/artifacts/<sha>` 拼绝对)→ 展示(AudioRenderer / img / video)+ 下载 +
  写回消息 artifacts(持久化)。
- 生成中进度/失败提示;可取消(AbortController)。

### TTS 受控设置 `TtsActionSettings`(P1)
从 `TtsVoiceParamBar` 抽「受控核」:本地引擎 chip + VoicePicker(hideProviderChips)+
语速/音量(VerticalSliderPopover)+ 语言;**用本地 useState/props**,不读 composer store
(面板是每条消息独立态)。厂商 TTS 模型由面板的模型选择处理。

### 产物持久化
- `ChatMessage` 加 `artifacts?: Array<{ id; type; url; mediaType; name?; meta? }>`。
- 生成成功 → 追加到该消息 artifacts + 经现有消息持久化链路(listMessages/metadata,
  与 modality file part 持久化同机制)写库;重开 `listMessages` 还原后 MessageBubble 渲染。
- 产物文件本身已由服务端 artifacts 落盘(内容寻址),消息只存 ref。

### 触发
- 自动:`ConversationView` 监听「assistant 回复完成(streaming false)」→ 对触发该回复的
  用户消息跑 `detectActionIntent` → type≠none → 在该 assistant 消息下方自动展开面板(预填 prompt)。
- 手动:`MessageBubble` 操作行加「⚡ 产出」→ 选类型 → 展开面板。

## 数据流
用户发消息 → 对话模型回复(普通 chat 链路)→ 回复完成 → detectActionIntent(LLM)→
{type,prompt} → MessageActionPanel(消息下方)→ 用户编辑/选模型/调设置 → 确定 →
streamModality 生成 → 产物挂消息 + 持久化 + 下载。

## 错误处理
- 意图 LLM 失败 → 回退关键词;都没命中 → 不自动弹(仍可手动)。
- 生成失败 → 面板内红字提示,不影响对话。
- 产物 url 缺失 → 提示未产出。

## 测试
- vitest:`parseIntentResult`、关键词 `keywordIntent`、ACTION_TYPES 注册表完整性。
- tsc(packages/app)。
- 真机:普通对话「帮我写一段开场白并合成语音」→ 自动出 TTS 面板 → 确定 → 出音频 + 下载 +
  重开还在。

## 分期
- P1:框架(MessageActionPanel + ACTION_TYPES + 意图 + artifacts 持久化)+ 语音合成端到端。
- P2:图像(t2i/image_edit,复用 ImageGenParamBar 抽受控)。
- P3:视频(t2v/i2v,复用 VideoGenParamBar 抽受控)。

## 风险
- ParamBar 现耦合 composer store → 抽受控核小重构(P1 先 TTS)。
- LLM 意图准确性/延迟 → 关键词兜底 + 手动纠正类型。
- 消息 metadata 持久化链路需在 P1 落实(复用 modality file part 持久化)。
- 本机 py3.6 跑不了后端 pytest;真机重建 desktop + 重启 sidecar 验。
