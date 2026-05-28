# 视频生成 Chat-Driven 重设计 · Design Spec

**日期**:2026-05-28
**作者**:Claude (brainstorming skill)
**用户**:zhgyuhuii
**状态**:Draft — 待用户审

## 背景

M1-N8 阶段实现了视频生成模块完整管道(后端 + wizard + chat-driven 入口),
但用户审核时发现关键缺口:

- **没真复用 ChatComposer / ConversationView** — N4 自实现 mini composer
- **脚本非流式** — 同步调用,用户体验不如 ChatGPT 流式
- **缺大模型选择** — 用户不能挑用哪个 LLM 跑
- **附件没抽文字** — 图像/PDF/音频 上传后 LLM 看不到内容
- **缺 BGM/输出 step** — MaterialsDrawer 确认后直接 submit,跳过配乐
- **TTS 卡用 `<details>` 折叠** — 布局不科学

用户在新一轮 brainstorming 给出 5 条详细要求,选了"方案 1:全部重做"。

## 用户原始要求

1. 输入框像对话框,输入主题 + 上传附件(自动抽文字 + 入素材库)+ 读 URL;
   复用对话框/消息列表;选大模型 + 语言 + 段落数 + 画幅;发送后流式脚本到
   消息块;用户可编辑;删独立"脚本"step;消息块下方 TTS;消息块字幕图标
   → 字幕编辑;消息块下方"去生成"按钮 → 素材界面(本地/在线搜/URL/打开)
   → 配乐+输出 step → 渲染 step
2. 全自动模式(从头到尾)
3. 多任务并行
4. 架构师视角:模块化 / 代码复用 / 高性能 / 多并发;统一样式;组件化
5. 借鉴别的产品(ChatGPT/Claude/Sora/Runway)

## 9 个核心决策(用户已确认 — 按推荐)

| # | 决策 | 选项 |
|---|---|---|
| 1 | Composer 复用策略 | createComposerStore('video-generation') scope 实例 |
| 2 | 消息块扩展方式 | ChatMessage.metadata.videoMeta 字段 |
| 3 | 流式 SSE 协议 | 走 chat.completions 协议(N6.c handler 改流式) |
| 4 | Drawer 结构 | 单 Dialog 三 section(素材/BGM/输出) |
| 5 | 渲染进度位置 | chat 内嵌 + library 聚合两处都有 |
| 6 | 多任务并发体验 | 同一对话内多次发起 |
| 7 | 附件文字抽取时机 | 发送时后端抽 |
| 8 | 国内短视频站点 | yt-dlp + 免责提示 |
| 9 | 素材源配置面板位置 | Dialog 内弹快捷设置 |

## 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│ 前端 VgChatPage(packages/app/src/features/video-generation/)    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ConversationView(复用 features/chat/ConversationView)     │  │
│  │ ├ user message:主题 + 附件 chips                         │  │
│  │ ├ assistant message:                                       │  │
│  │ │   ├ 流式脚本(content,可编辑 textarea)                 │  │
│  │ │   ├ TtsCard(metadata.videoMeta.tts)                     │  │
│  │ │   ├ 字幕编辑图标 → SubtitleEditorDialog                  │  │
│  │ │   ├ 「✨ 去生成」按钮 → MaterialsBgmOutputDialog          │  │
│  │ │   └ RenderProgressCard(metadata.videoMeta.taskId)       │  │
│  │ └ 多任务:同一对话内 N 条 user msg → N 条 assistant 各跑  │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ChatComposer(复用 features/composer/ChatComposer)         │  │
│  │ ├ 模型 pill / 附件 chip / URL / 全自动 / 画幅 chip        │  │
│  │ └ Enter 发送 → chat protocol(mode=video_generation)      │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                              ↓ chat SSE
┌──────────────────────────────────────────────────────────────────┐
│ 后端 chat handler (mode='video_generation', N6.c 升级流式)       │
│  1. 解析附件 → 自动抽文字(OCR/PyMuPDF/whisper)→ append prompt │
│  2. LLM 流式生成脚本 → yield SSE chunks                          │
│  3. 末尾 yield videoMeta(taskId 留空 — 用户点"去生成"才提交) │
└──────────────────────────────────────────────────────────────────┘
```

## 详细设计

### A. 后端

#### A.1 升级 `chat/handlers/video_generation.py` 流式

当前(N6.c)`generate_override` 返同步 dict。重构成 async generator:

```python
class VideoGenerationHandler(BaseModeHandler):
    mode = "video_generation"

    async def generate_override(self, state):
        req = state["request"]
        query = req.query.strip()
        # 1. 解析附件文字
        attach_texts = []
        for att in (req.attachments or []):
            text = await attachment_extractor.extract(att)
            if text:
                attach_texts.append(f"### 附件:{att.name}\n{text}")

        # 2. 组 prompt
        prompt = SCRIPT_PROMPT.format(
            subject=query,
            attachments="\n\n".join(attach_texts) or "(无)",
            language=...,  # 从 state.params 拿
            paragraph_number=...,
        )

        # 3. LLM 流式 yield
        llm = get_ChatOpenAI(model=req.model, streaming=True)
        async for chunk in llm.astream(prompt):
            yield {"chunk": chunk.content}

        # 4. 末尾 emit metadata
        yield {"videoMeta": {
            "scriptCues": None,
            "tts": {"provider": "piper", "voice": ""},
            "renderState": "idle",
        }}
```

#### A.2 新增 `video_generation/attachment_extractor.py`

dispatcher 按 mime 路由(全部用现有 deps):

| 类型 | 抽取工具 | 说明 |
|---|---|---|
| image/* | rapidocr_onnxruntime | OCR 图像文字 |
| application/pdf | PyMuPDF (fitz) | 全文 |
| text/* | 直接 decode | UTF-8 |
| application/msword 等 docx | python-docx 或 unstructured | 已 deps |
| audio/* | modality.audio.transcribe | 走 whisper sidecar |
| video/* | 抽第一帧 OCR + 头 30s 音频 transcribe | 组合 |

输出文本上限 ~10k 字符 / 附件,避免 LLM 上下文爆。

#### A.3 yt-dlp 集成

- 新增 deps `yt-dlp = "*"`(后续 PyInstaller spec 加 hidden import)
- 新增 `video_generation/sources/ytdlp_source.py` connector
- 用户粘 URL → 后端先试官方 API(Pexels/Pixabay/YouTube Data)→ 失败 fallback yt-dlp
- 视频/音频下载到 `vg_materials`,user_id 关联

### B. 前端

#### B.1 ChatMessage.metadata 扩展

`packages/transport/src/types.ts`:

```typescript
export interface ChatMessageMetadata {
  // 现有字段不动
  videoMeta?: {
    taskId?: string;
    scriptCues?: VgSrtCue[];
    tts?: {
      provider: 'piper' | 'edge' | 'sherpa';
      voice: string;
      rate: number;
      volume: number;
    };
    materials?: VgMaterialInfo[];
    bgm?: { type: 'none'|'random'|'file'; file: string; volume: number };
    renderState?: 'idle' | 'submitting' | 'running' | 'complete' | 'failed';
    finalVideos?: string[];
  };
}
```

#### B.2 ConversationView 加 extraSlot

`features/chat/ConversationView` 在 MessageBubble 渲染时,如有 `extraSlot` prop,
对每条 assistant message 调用 `extraSlot(message)` 渲染额外组件(放在 content 之后)。

不破坏 chat 现有渲染,只 append。

#### B.3 VgChatPage 重写

```tsx
const vgStore = createComposerStore('video-generation');

export const VgChatPage = () => (
  <ComposerScopedContext.Provider value={vgStore}>
    <div className="flex h-full flex-col">
      <ConversationView
        mode="video_generation"
        extraSlot={(m) => <VgMessageExtras message={m} />}
      />
      {/* 关键配置工具栏 — 显式露在 composer 上方,不藏 popover */}
      <VgComposerToolbar />
      <ChatComposer
        mode="video_generation"
        onSend={handleSend}
        showKnowledgePicker={false}      // 视频生成不挂 KB
        showRetrievalControls={false}
      />
    </div>
  </ComposerScopedContext.Provider>
);
```

`onSend` 走 chat 协议发送 `mode='video_generation'` 请求,SSE 进 ConversationView。

#### B.4 VgComposerToolbar(新增,在 ChatComposer 上方一行)

用户明确要求"关键配置要在对话输入框上面显示",不藏 popover。
工具栏从左到右 chip 化展示:

```
┌─────────────────────────────────────────────────────────────┐
│ [模型 deepseek-v4 ▾] [画幅 9:16] [语言 中文 ▾]              │
│ [段落 1] [全自动 ⚡] [脚本风格 知识科普 ▾]                  │
└─────────────────────────────────────────────────────────────┘
[ChatComposer textarea + 附件/URL 按钮 + 发送]
```

字段绑定:
| 字段 | UI | 写回位置 |
|---|---|---|
| 模型 | ComposerModelPill(复用,与 ChatPage 同款) | vgComposerStore.modelId |
| 画幅 | 3-chip 9:16/16:9/1:1 | vgComposerStore.params.video_aspect |
| 语言 | dropdown(自动/中/英/日) | vgComposerStore.params.video_language |
| 段落数 | inline `<input type=number>` 1-10 | vgComposerStore.params.paragraph_number |
| **音频** | chip 弹 popover (provider chip + voice + rate/volume slider + 试听) | vgComposerStore.params.voice_* |
| **字幕** | chip 弹 popover (开关 + 位置 + 字体 + 字号 + 前/描边色 + 描边粗细 + 背景) | vgComposerStore.params.subtitle_*, font_*, text_*, stroke_* |
| 全自动 | ⚡ toggle | useState (VgChatPage 本地) |

**字幕 chip 弹出 popover**(`VgSubtitlePopover` 新组件):
```
[ Aa 字幕 STHeitiMedium · 60 · 底部 ▾ ]
  ↓ 点击展开 popover (~360×320)
┌──────────────────────────────────────────┐
│ 启用字幕 ☑                                │
│ 位置 [底部 ▾]   字体 [STHeitiMedium ▾]   │
│ 字号 [60]        粗体描边 [1.5]           │
│ 前景 ▇▇  描边 ■■   背景 [黑底 ▾]         │
└──────────────────────────────────────────┘
```

写回到 `vgComposerStore.params` 的 `subtitle_enabled / subtitle_position
/ font_name / font_size / text_fore_color / stroke_color / stroke_width /
text_background_color`。这是**全局默认**,具体一条任务字幕(SrtCue 列表)
仍可在消息块 ✎ 字幕图标的 SubtitleEditorDialog 内编辑。

**音频 chip 弹出 popover**(`VgAudioPopover` 新组件,内嵌在 VgComposerToolbar):
```
[ 🔊 音频 piper · zh_CN-huayan-medium ▾ ]
  ↓ 点击展开 popover (~360×260)
┌──────────────────────────────────┐
│ TTS 后端 [piper] [edge] [sherpa] │
│ 音色 [中文女声 (huayan) ▾]       │
│ 语速 ━━●━━ 1.00×    音量 ━●━ 80%│
│ 试听文本(用最近一条 user 主题前 50 字)│
│            [▶ 试听]               │
└──────────────────────────────────┘
```

写回到 `vgComposerStore.params` 的 `voice_provider / voice_name /
voice_rate / voice_volume`。新消息从 store 默认值初始化 `videoMeta.tts`,
单条 message 仍可用消息块下方的 TtsCard 独立调整(不污染全局)。

两层结构:
- **全局默认** — Toolbar 音频 chip popover,决定新消息的 tts 初始值
- **单条覆盖** — 消息下方 TtsCard,影响本条 message 提交时的 tts

工具栏自身组件 `VgComposerToolbar.tsx`,内部独立读 vgComposerStore,跟
ChatComposer 共享同一个 scope 实例(均在 ComposerScopedContext 下)。

注:模型选择 chip 用 `ComposerModelPill`(features/composer 现有,跟
ChatPage 模型选择同款 UI),scope 实例隔离让 vg 跟 chat 各自记忆上次
选的模型不互相覆盖。

### C. VgMessageExtras 组件(消息块下方追加)

```
VgMessageExtras
├ TtsCard          (inline,紧凑布局:
│                   row1 provider chip + voice dropdown + 试听 ▶
│                   row2 语速 slider + 音量 slider
│                   row3 当前生效:piper · zh_CN-huayan-medium)
├ SubtitleIconBtn  (右上角浮动,点击开 SubtitleEditorDialog)
├ GoGenerateBtn    (主 CTA,点击开 MaterialsBgmOutputDialog)
└ RenderProgressCard(任务已提交后:圆环进度 + 步骤 label + 终态嵌入视频)
```

每个组件读 `message.metadata.videoMeta` 独立配置;不共享全局 state,
多任务并发安全。

### D. MaterialsBgmOutputDialog(单 Dialog 三 section)

```
┌─ ✨ 完成最后配置 ──────────────────── X ──┐
│ ① 素材  (Tab:本地库 / 在线 / 上传 / URL)   │
│   [grid + 选中 chip + 已选 N 段]           │
│   在线 tab:源 chip 行,未配 Key 点击弹快  │
│           捷设置 popover                    │
│                                            │
│ ② BGM   (无 / 随机 / 指定文件 + 音量)     │
│                                            │
│ ③ 输出  (份数 / 转场 / 拼接 / 字幕样式)   │
│                                            │
│ [取消]                  [✨ 提交生成]      │
└────────────────────────────────────────────┘
```

复用 `MaterialsStep` + 拆 `BgmOutputStep`:
- `BgmSection.tsx`(从 BgmOutputStep 切出)
- `OutputSection.tsx`(渲染参数 + 字幕样式部分)

在线源 chip:
- Pexels / Pixabay / Unsplash / YouTube / Vimeo / Coverr(已配后绿点,未配灰)
- 未配点击弹 popover:输入 Key + Save → 调 `POST /api/v1/video-generation/sources/config`

### E. 多任务并发

- 用户在同一对话内多次发主题 → N 条独立 user message → N 条 assistant message
- 每条 assistant 渲染时基于自己的 `videoMeta.taskId` 独立订阅 SSE
- 后端 runner ThreadPoolExecutor workers=4(已升级)
- 复用 N7 InProgressTasksPanel("我的视频"页)做聚合视图

### F. 全自动模式

ChatComposer leadingControls 旁边加 `<VgAutoToggle />` ⚡ 按钮:
- 关:发送后只生成脚本到 message,等用户点"去生成"才提交 task
- 开:发送后 handler 直接 submitTask(script_source='ai', stop_at='video') —
  跳过脚本预览/编辑;message 直接渲染 RenderProgressCard

## 工作量拆分

| Commit | 范围 | 工时 |
|---|---|---|
| R1 | 后端 attachment_extractor(rapidocr/PyMuPDF/whisper dispatch) + handler 升级流式 + yt-dlp connector | 1.5d |
| R2 | ChatMessage.metadata.videoMeta(packages/transport 类型 + ConversationView extraSlot 接入) | 1d |
| R3 | VgChatPage 重写:createComposerStore + ChatComposer + ConversationView + **VgComposerToolbar(6 chip 显式工具栏)**+ VgMessageExtras 组件套 | 2.5d |
| R4 | MaterialsBgmOutputDialog 整合(单 Dialog 三 section + 在线源配置弹窗) | 1d |
| R5 | 多任务订阅 + 在线源 endpoint(/sources/config + GET 列表) + 联调 + 旧 VgChatPage(N4-N8)删除 | 1.5d |
| **合计** | | **7 天** |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| ChatComposer scope 切换可能有未发现的全局 state 假设 | R3 阶段优先验证一个最小 hello-world 跑通,再补功能 |
| chat handler 流式协议跟 LangChain stream 接口磨合 | 参考 `_home_intro_stream` 现有套路,LLM token chunk 直接 yield |
| yt-dlp 法律灰带 | UI 显眼免责;默认 enabled 但弹首次警告;不下载验证文件可 hash |
| 附件文字抽取 + LLM prompt token 上限 | 每附件截 10k 字符 + 总和 < 30k,超过用 "..." 截断 |
| 同一对话 N 个独立 vg_task SSE | 浏览器 HTTP/2 多路复用 6+ 并发够用,N7 已实测 |

## 测试

- 单元:attachment_extractor 各 mime 分支(模拟图像/PDF/音频固定输入)
- 集成:ChatComposer + scope store 切换不互相污染 draft / model
- e2e:
  - chat 模式发主题 → 流式脚本到 message → 点去生成 → MaterialsBgmOutputDialog
    选素材 + BGM + 输出 → 提交 → message 渲染进度 → 完成嵌入视频播放
  - 同一对话内连续发 3 个不同主题 → 3 条独立 assistant 同时跑

## 退役

完成 R5 后:
- 删 `VgChatPage.tsx`(N4 自实现版)
- 删 `MaterialsDrawer.tsx`(被 MaterialsBgmOutputDialog 替代)
- BatchModePage 保留(批量场景需求独立)
- 旧 wizard `/video-generation/wizard` 保留作 legacy 兜底

## 决策日志

所有 9 个决策都基于"真复用 + 借鉴 ChatGPT/Sora 体验 + 模块化"原则,
排斥"自实现 mini X"的反模式。CLAUDE.md 新加的"大功能 / 重构前
brainstorming 强制纪律"+ "真复用判定标准"规则将守护后续维护。


---

## 实施记录(2026-05-28)

- **R1** 后端 attachment_extractor + handler 升级 + yt-dlp + sources_config: 完成
- **R2** ChatMessage.metadata.videoMeta + ConversationView extraSlot + sentinel 解析: 完成
- **R3** VgChatPage 重写(ChatComposer + ConversationView + scope + 组件套): 完成
  - R3.6 中 useChayuanChat 没加 patchMessageMetadata/injectAssistantMessage,改走 ConversationView setMessagesRef + ChatRequestV2.mode='video_generation' 路径
- **R4** MaterialsBgmOutputDialog 单 Dialog 三 section + OnlineSourceChips: 完成
- **R5.1** UI 手动联调: 留给用户在 desktop 内验证
- **R5.2** 退役 N5 MaterialsDrawer: 完成
- **R5.3** VgChatPage smoke test: 完成
- **R5.4** spec 收尾 + 最终推送: 本 commit

### 剩余 followups(非 plan 范围,后续 task)

- chat handler 真流式(R1 同步 LLM 调用,需看 chat runner 协议升级 SSE chunk yield)
- 在线源 connector 真接入(目前 Pexels/Pixabay 走 video_source enum,Unsplash/YouTube Data API/Vimeo 后端 source connector 未实现)
- yt-dlp 真 download endpoint 接 vg_materials(R1.4 注册 connector,但没串到 wizard 的"添加在线 URL"动作)
- URL 抽取按钮在 ChatComposer leadingControls slot 注入(目前用户粘 URL 文本走默认 chat path,没有专门 UX)
- 拖文件入素材库(N6.b 路径)走 ChatComposer 标准 attachment;若用户要"直接进 vg_materials",需要在拖拽层接 vg upload endpoint
