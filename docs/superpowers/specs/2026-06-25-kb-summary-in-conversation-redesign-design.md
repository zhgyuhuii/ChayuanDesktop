# 知识库「全文总结」改为对话内进行(重设计)

- 日期:2026-06-25
- 状态:设计已确认,待写实现计划
- 关联:前序设计 `2026-06-24-kb-full-file-summarize-design.md`(M1-M3,弹窗版)

## 背景与动机

M2 把「全文总结」做成了独立弹窗 `FileSummaryDialog`。用户反馈:不应弹独立窗口,
应当**和普通知识检索一样在对话框里进行** —— 触发后在对话里出现一轮:进度条(可取消)→
完成后流式输出总结正文,并像普通问答一样落入对话历史。

后端 SSE 端点 `/knowledge_base/kb_summary_api/summarize_file_now` 已修复并可用
(进度帧 `running/progress`、超大确认 `needs_confirm`、结果 `ok`、错误 `error`)。
本次只改前端交互层,后端不动。

## 已确认的需求(brainstorming 决议)

1. **触发入口**:文件列表的「总结」图标 + 对话内自然语言,两条统一进入对话,不再有弹窗。
2. **落历史**:总结轮次像普通问答一样落库,刷新/重开会话仍在,可接着追问。
3. **超大文件二次确认**:在助手气泡内联【仍然总结】【取消】按钮(保留安全闸门)。
4. **后台知识库管理(KbAdminDetail,无对话视图)**:**去掉**总结入口。
5. 方案 A:客户端编排总结轮次,复用既有对话/进度/落库基建,**后端零改动**。

## 架构

复用 `VgChatPage` 已上线的「父级编排 + setMessagesRef + extraSlot」模式
(video_generation 即如此:父级注入任务进度、用 extraSlot 渲染气泡额外 UI,
不重写 ConversationView 状态机)。

- **KbDetailPage** 扮演编排者:持 `setMessagesRef`、用 `extraSlot` 渲染总结气泡额外 UI、
  用 `onBeforeSend` 拦 NL。
- 新增 hook **`useFileSummaryTurn`**(`features/kb/detail/`),封装一次总结轮次生命周期。
  **只复用、不重造**:
  - `subscribeFileSummary`(已修复的 SSE 客户端,`packages/api`)
  - `upsertConversation` / `appendMessage` / `useLocalUserId`(与 ConversationView 同一套落库原语)
  - ConversationView 已暴露 props:`setMessagesRef`、`extraSlot`、`onBeforeSend`、`onConversationCreated`
- **不碰 chat 后端、不改 ConversationView 内部状态机**,只用其已开放的注入口。

## 数据流(一次总结)

1. 触发(图标 / NL)→ KbDetailPage 切 chat 模式 → 调 `startSummary(fileName)`。
2. `convId` 为空 → `upsertConversation` lazy 建会话(同 ConversationView)+ `onConversationCreated` 上抛。
3. 经 `setMessagesRef` 注入:用户气泡「请整篇总结《fileName》」+ assistant 气泡(`streaming=true`)。
4. `subscribeFileSummary` 帧映射:
   - `running` / `progress(done,total)` → patch `assistant.taskProgress.percent` → `TaskProgressPart` 进度条。
   - `needs_confirm(chunk_count, est_llm_calls)` → `metadata.summary.state='needs_confirm'` → extraSlot 出【仍然总结】【取消】。
   - `ok(summary)` → 把 summary 流式写入 `assistant.content`,`streaming=false`。
   - `error(msg)` → `metadata.summary.state='error'` + msg → extraSlot 出红字 +【重试】。
5. **取消**:hook 持 `AbortController`;**主路径=助手气泡内【取消】按钮**(自包含、可靠)→ `abort()` + 标记气泡已取消。composer 全局停止按钮的联动为可选增强,非本期必须(它驱动的是 chat.stop,需额外接线)。
6. **落库**:完成时 `appendMessage`(user + assistant),满足"落历史";途中取消/失败不落库。

## 消息模型扩展

仿 video 的 `metadata.videoMeta`,**不污染顶层 ChatMessage**:

- 进度条直接复用现有 `ChatMessage.taskProgress`。
- 新增 `ChatMessage.metadata.summary = { state: 'running'|'needs_confirm'|'ok'|'error',
  fileName: string, chunkCount?: number, estCalls?: number, msg?: string }`,供 extraSlot 判定渲染。

## 触发入口(两条都进同一个 `startSummary`)

- **图标**:`DocumentKbDetail` 新增 prop `onSummarizeFile?: (fileName: string) => void`。
  - 图标的**显隐由该 prop 是否传入驱动**:KbDetailPage 传 → 显示并进对话;
    KbAdminDetail 不传 → 自动隐藏(满足"后台去掉入口")。
  - 移除 DocumentKbDetail 内部 `summaryFile`/`setSummaryFile` 状态与 `<FileSummaryDialog>`。
- **NL**:KbDetailPage 的 `onBeforeSend` 命中 `detectSummarizeIntent` → `startSummary(hit.fileName)` → 返回 `true` 拦截普通发送。

## 新增渲染组件 `FileSummaryMessageExtras`(走 extraSlot)

按 `metadata.summary.state`:
- `running`:`TaskProgressPart`(percent / "正在通览整篇并归纳…")+【取消】
- `needs_confirm`:提示"该文件较大,约 N 次调用" +【仍然总结】【取消】
- `error`:红字 msg +【重试】
- `ok`:无额外(总结正文即 `content`,沿用气泡自带复制)

## 清理

- **删除 `FileSummaryDialog.tsx`**(全系统再无引用)。
- 移除 DocumentKbDetail / KbDetailPage 中对它的 import、状态与渲染。
- KbAdminDetail 不传 `onSummarizeFile` → 自然无图标,无需额外改动。

## 错误处理

- SSE 连接失败 / 非 2xx → `error` 态 +【重试】(`subscribeFileSummary` 的 onError)。
- 取消(AbortController)→ 静默,不报错、不落库。
- 找不到 KB / 文件 → 后端已返回 `code 404 status error`,前端按 `error` 态渲染。

## 测试

- `detectSummarizeIntent` 单测:已存在,保持。
- 新增 `useFileSummaryTurn` 单测(vitest):mock `subscribeFileSummary`,
  断言各类帧(running/progress/needs_confirm/ok/error)→ 消息状态机的迁移与 `metadata.summary`、
  `taskProgress`、`content`、落库调用次数;取消路径不落库。
- typecheck:`npm run typecheck` 全绿。

## 非目标(YAGNI)

- 流式途中刷新页面**不**支持续接(总结非后端注册任务,无 taskId 队列;已完成的总结正常落库)。
  若日后需要,可演进为"总结作为 modality 式后端任务"(brainstorming 中的方案 C)。
- 后台不做对话化结果区。
