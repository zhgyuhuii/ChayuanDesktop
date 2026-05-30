# 实时交互数字人(直播流式对话)技术方案

> 状态:设计稿(brainstorming 产物,用户已逐节确认)。承接已交付的批量数字人
> (DH P1–P3 + GPU 引擎 Wav2Lip/SadTalker/MuseTalk)。
>
> 用户拍板的关键决策:
> - 实时口型视频路径 = **GPU 按需运行时(MuseTalk 准实时)**(复用已搭 MuseTalk runtime;基础包仍 CPU 自包含)。
> - 实时流传输 = **WebRTC 真连续流**。
> - 输入 = **文字 + 语音输入(ASR)**。
> - 大脑(LLM 模型 + 知识库)= **每次会话临时选**(不绑死 preset)。
> - **分期且 RT-P1(对话内核·无口型视频)先做**(本机可验、无 GPU、价值高)。

---

## 0. 现状盘点:批量 DH vs 实时所需

**当前 DH 栈(批量·离线)**:`preset(形象+音色+名字)` → jobs 队列:整段文本 →TTS整段→
talking-head整段→ mp4 文件 → 下载/播。**同步、文件式、分钟级、无 LLM、无流式、无交互**。

**实时交互需要(流式闭环)**:用户输入 → LLM(带 KB RAG)流式 token → 句切 → TTS 逐句流式
→ talking-head 按音频块出口型帧流 → 前端 A/V 同步实时播,不说话播 idle。可感延迟 = 首句出画时间。

**致命约束**:真·实时口型在自包含 CPU 桌面**不可行**(Wav2Lip CPU 秒/分钟级)。真实时**必须 GPU
(MuseTalk 准实时)或云**。故实时数字人的视频走**按需 GPU 运行时**;基础包零变化、无 GPU 用户用不了视频档(但 RT-P1 文字+语音可用)。

---

## 一、架构总览 + 数据流

```
前端「实时数字人」页(上=数字人视频,下=对话框)
  创建流前选:数字人(形象+音色) + LLM 模型 + 知识库(ku_ids) + 人设 prompt
        │  signaling(WS:SDP offer/answer + ICE)   [RT-P2]
        ▼
  RTCPeerConnection ⇄ realtime_avatar_server(GPU sidecar, aiortc)   [RT-P2]
        ▲ 远端 video track(口型) + audio track(语音)   ▲ data channel(文字流)
        │
后端 实时会话编排:
  ① 用户输入:文字 / 麦克风→ASR(funasr/whisper)转文字   [ASR=RT-P3]
  ② → chat/v2/chat 流式 LLM(带 ku_ids RAG)──► token 流
  ③ → 句切器(标点+长度)──► 逐句
  ④ → TTS 流式(piper/edge/clone)──► 音频块
  ⑤ → MuseTalk 实时(GPU)按音频块生成口型帧   [RT-P2]
  ⑥ → aiortc:音频块 + 口型帧 push 进 WebRTC track(边说边播)   [RT-P2]
  不说话 → idle 待机循环帧;文字流同时推前端下方对话框
```

**组件边界**
- **会话编排**(CPU,可本机验):输入→LLM/KB 流式→句切→TTS 流式。复用 `chat`/`kb_query`/TTS。
- **实时媒体服务 `realtime_avatar_server`**(GPU sidecar):aiortc peer + MuseTalk 实时帧源 +
  把 TTS 音频/口型帧塞进 WebRTC track。[RT-P2,GPU-only]
- **signaling**:WS 交换 SDP/ICE。[RT-P2]
- **前端**:`RTCPeerConnection` + `<video srcObject>` + 对话框 + 会话配置。

---

## 二、强制分解 + 分期

| 阶段 | 内容 | 可验证性 |
|---|---|---|
| **RT-P1 对话内核(无视频)** | 实时数字人页 + 选数字人/模型/知识库/人设 + **文字流式 LLM(RAG) + TTS 语音逐句播**(本地音频,数字人形象静态/idle,先不接口型) | ✅ 本机 stub 可验;无 GPU |
| **RT-P2 实时口型流** | `realtime_avatar_server`(GPU sidecar)+ aiortc WebRTC + MuseTalk 实时帧 → 视频接上「边说边播」 | ❌ GPU-only,本机不可验 |
| **RT-P3 语音输入** | 麦克风 → ASR(复用 funasr/whisper)→ 文字进编排器 | ⚠️ 部分可验;麦克风权限/实测在 GPU/桌面环境 |

**顺序**:RT-P1 → RT-P2 → RT-P3。RT-P1 是整个实时对话的可验证基础。

---

## 三、RT-P1 会话编排(大量复用 chat + TTS)

```
用户输入文字
  → POST /chat/v2/chat (SSE,已有) { mode, model, ku_ids(知识库 RAG), 人设 prompt, query }
  → token 流回前端(下方对话框流式显示,复用现有流式渲染)
  → 前端「句切器」:token 累积到句末/逗号 → 出一句
  → 每句 → 现有 TTS(preview-audio 风格端点)→ 音频 blob
  → 前端音频队列顺序播(上一句 ended 接下一句)= 语音反馈
  → 上方显示所选数字人形象(avatarFileUrl;口型视频留 RT-P2)
```
- **几乎零新后端**:LLM+KB(RAG) 复用 `chat/v2/chat`(`ku_ids` 已是 RAG 真源);TTS 复用现有逐句合成端点。
- **新增主要在前端**:实时数字人页 + 句切器 + 音频顺序播队列。
- 会话配置(数字人/模型/知识库/人设)**临时态不持久化**(可记住上次用的)。

## 四、RT-P1 前端页

- 新页 `features/digital-human/LiveAvatarPage.tsx`,路由 `/digital-human/live`;数字人页加「实时对话」入口。
- **布局**:上半=数字人形象(`<img>`/`<video>` idle);下半=对话流 + 输入框。
- **会话配置条**:数字人 picker(复用预设列表)+ 模型 picker(复用现有模型选择器)+ 知识库
  picker(复用现有 KB 选择 → `ku_ids`)+ 人设 prompt 输入。
- **流式 + 语音**:复用聊天流式显示;新增 `useSentenceTts`(监听流式文本 → 句切 → TTS → `Audio` 队列顺序播)。
- **真复用**:模型/知识库选择、聊天流式、TTS 都用现成组件/接口,不另写 mini 版。

## 五、RT-P2 / RT-P3 概要 + 打包红线

- **RT-P2(GPU 实时口型)**:`modality/realtime_avatar_server.py`(GPU sidecar,`aiortc` WebRTC peer +
  MuseTalk 实时帧源 + TTS 音频/口型帧 push 进 track)+ signaling WS 端点 + 前端 `RTCPeerConnection`
  接 `<video>`。**整块 GPU-only 本机不可验**,标 `[GPU-VERIFY]`。
- **RT-P3(语音输入)**:麦克风 → 复用 ASR(funasr/whisper)→ 文字进编排器(Tauri 麦克风权限需实测)。
- **打包红线**:RT-P1 不需 GPU、不破基础包(纯复用 chat+TTS+前端)。RT-P2 的 `aiortc` + MuseTalk 走
  **按需 GPU 运行时**(同 GPU 引擎机制),不进基础包。

## 六、数据模型 / 错误 / 测试

- **数据模型**:RT-P1 无新持久化(会话配置临时态);可选复用 chat conversation 存历史。
  RT-P2 的 WebRTC 会话是临时 peer,不持久化。
- **错误**:LLM/KB 失败 → 对话框报错;TTS 单句失败 → 跳过该句继续(不卡整段);
  RT-P2 sidecar 未就绪 → 提示装/起 MuseTalk 运行时(复用引擎 gating)。
- **测试**:RT-P1 句切器单测(标点/长度切句)、音频队列顺序(stub Audio)、前端页 smoke;
  后端几乎复用无新逻辑。RT-P2/P3 GPU/麦克风部分本机 stub + 标记。

---

## 七、可行性结论

**全套(文字流 + 语音 + 口型视频 + 边说边播 + 语音输入)技术上可实现**,但是个明显更大、与批量
DH 不同的新子系统(实时数字人流媒体服务)。**RT-P1(文字流 + 语音 + 数字人形象)本机可验、无 GPU,
先落地**;RT-P2(WebRTC + MuseTalk 实时口型)= 全套的"视频"部分,GPU-only、不可本机验,你环境迭代;
RT-P3 语音输入收尾。

> 确认本 spec 后,按 **RT-P1(对话内核)** 用 writing-plans 写实施计划落地。
