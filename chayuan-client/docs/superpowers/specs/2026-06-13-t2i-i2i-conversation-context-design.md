# 文生图/图生图 记住对话上下文(智能改写 + 图生图复用上一张)

> 日期:2026-06-13 · 范围:chayuan-client 前端(不动后端)

## 1. 背景与目标
对话里的「文生图(t2i)」「图生图(image_edit/i2i)」目前每次只把当前一句 prompt 发给图像模型,不带任何上下文(前端写死单条 message、后端只取最后一句、图像模型本身也只吃一句 prompt)。
目标:让 t2i/i2i「记住当前对话上下文」,能理解「把刚才那张再红一点 / 在上面加只猫」这类承接式指令。用户已选**方案 C**。

## 2. 关键约束
图像模型(qwen-image / qwen-image-edit / dall-e 等)是**单 prompt 接口,不吃多轮 messages**。所以「喂上下文」不能透传聊天记录,只能:① 用对话模型把历史融合成增强 prompt;② 图生图自动复用上一张生成图。两者纯前端可实现,后端通路(image_edit 吃 artifact URL)已现成。

## 3. 方案设计(纯前端)

### ① Prompt 智能改写(t2i + i2i)
- 触发:`ConversationView.handleSend` 里,当前 composerMode 是 `t2i` 或 `image_edit`,**且存在历史对话**(messages 长度 > 0 的已完成轮次)。
- 行为:调一次对话模型(非流式 `aiPlatform.complete`),system 指令="你是图像提示词专家。根据对话历史和用户最新一句,产出一句完整、自洽的图像生成提示词,只输出提示词本身,不要解释";user 内容=最近 N 轮文本 + 当前输入。把返回文本作为发给图像模型的 prompt。
- 历史窗口:最近 3 轮(≤6 条消息),只取文本 content(忽略图片/工具消息正文)。
- 模型选择:自动挑可用的 chat 模型(`useAvailableModelsByCapability` → `pickBestModel(byCap.get('chat'))`)。无可用 chat 模型 → 跳过改写。
- 显示:对话里**仍显示用户原话**;改写后的 prompt 仅发给图像模型,不写进可见消息(后台进行)。
- 失败兜底:改写调用异常 / 超时 / 无 chat 模型 → 回退用原始 prompt,**绝不阻塞生图**。
- 仅有历史才改写;第一句直接发原 prompt(不多调用、不增延迟)。

### ② 图生图复用上一张图(仅 image_edit)
- 当 mode==image_edit 且用户**未上传图片附件**时,自动找最近一条 assistant 消息里的图片产物(`message.files` 中 mediaType image 的 `url`),作为 `modalityAttachments` 的 `{mime, url}` 传下去。
- 用户上传了图 → 用用户的(不变)。
- 找不到上一张图 → 按现状(无图;image_edit 缺图时由后端/模型报错,符合现有行为)。

## 4. 落点(文件)
- 新增 `packages/app/src/features/chat/imagePromptContext.ts`:纯函数 + 改写编排,隔离可测:
  - `pickHistoryForRewrite(messages, maxTurns=3)`:取最近 N 轮文本。
  - `buildRewriteMessages(history, currentText, mode)`:组装 chat completion 的 messages。
  - `rewriteImagePrompt(deps)`:调 `aiPlatform.complete`,返回增强 prompt 或 null(失败/无模型)。
  - `findLastAssistantImage(messages)`:返回最近 assistant 生成图的 `{url, mime}` 或 null。
- 改 `packages/app/src/features/chat/ConversationView.tsx` `handleSend`:在走模态生成(t2i/image_edit)分支前,先 await 改写得到 finalPrompt;image_edit 无图时注入上一张图。

## 5. 默认决定
始终开启(无开关);自动选 chat 模型;最近 3 轮;失败回退原 prompt;改写结果后台不显示。

## 6. 范围外 / 风险
- 不动后端;不改图像模型协议。
- 改写多一次 LLM 调用(仅在有历史时;失败回退)。
- 无 chat 模型时不改写(等效现状)。
- 改写质量取决于所选 chat 模型;后台不显示,用户若想看实际 prompt 后续可加开关(本次不做)。

## 7. 验证
- `cd chayuan-client/packages/app && node_modules/.bin/tsc -p tsconfig.json --noEmit`(EXIT=0)。
- 纯函数(pickHistory/buildRewriteMessages/findLastAssistantImage)逻辑可独立断言。
- 手测:t2i 连续两句("画只猫"→"让它戴帽子")第二张应承接;i2i 不传图时基于上一张改;无历史时第一句行为不变;断网/无 chat 模型时仍能生图(回退)。
- 前端改动需重建 desktop + 重启 sidecar。
