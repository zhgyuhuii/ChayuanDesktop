# 全文总结:服务端统一路由 + 上下文预算化总结器

- 日期:2026-06-25
- 状态:设计已确认,待写实施计划
- 关联前序设计:`2026-06-25-kb-summary-in-conversation-redesign-design.md`(M4 对话内全文总结,前端 KB 详情页轨)

## 背景与问题

用户在**常规对话**里选中知识库提问「答辩状文件讲的是什么」,期望得到**整篇全文总结**,实际返回的是普通 top-k RAG 的 5 个片段拼接答案。

两个真实根因(均已代码确证):

1. **覆盖漏洞**:整篇全文总结的自然语言识别(`detectSummarizeIntent` → `useFileSummaryTurn`)**只接在前端 KB 详情页**(`KbDetailPage.tsx` 的 `onBeforeSend`)。常规对话链路 `ChatPage → Lane → ChatWindow → ConversationView` 上没有该识别,WPS 加载项同样没有。
2. **总结器上下文溢出**:即便走详情页按钮(`/knowledge_base/kb_summary_api/summarize_file_now`),也会因本地 chat 模型仅 `--ctx-size 4096`(`process_args.py:281`)而失败:
   - `summarize_file_now` 调 `get_ChatOpenAI(max_tokens=None)`,None 在 `utils.py:690` 被删,请求**不带 max_tokens**,输出无上限;
   - `SummaryAdapter` 的 map 阶段 `MapReduceDocumentsChain.llm_chain.apply([...])` 把每个 chunk 套 prompt **并行**发出,**无任何 token 预算/截断**;
   - chunk 较大或生成跑长即超 4096 → llama-server 抛「Context size has been exceeded」(日志并发 4 条 = map 并行多块同时炸)→ `summarize_file_now 失败`;
   - `token_max=1300` 仅管 reduce 折叠,且 LangChain 默认用 tiktoken(英文)数中文,严重低估,折叠边界不可靠。

## 目标

1. 让**所有客户端**(网络版、桌面版、WPS 加载项)在选中知识库的常规对话里,问「某文件讲了什么」能触发整篇全文总结,而非 top-k 片段。
2. 修好总结器,使其在小上下文本地模型(4096)上也能稳定完成全文 map-reduce,大文件不溢出。

## 非目标(本期不做)

- 不删除前端 KB 详情页的 `detectSummarizeIntent` 拦截与 `summarize_file_now` 直连(保留现状,底层修好即可用)。
- 不把详情页轨也改成走服务端路由(那是更大重构,后续再议)。
- 不在常规对话里弹「大文件二次确认」交互。

## 设计

### 1. 上下文预算化的总结器(地基,服务端,所有入口共用)

改造 `SummaryAdapter`(`knowledge_base/kb_summary/summary_chunk.py`)及其调用处(`kb_summary_api.py` 的三个总结端点 + `summarize_file_now`),让总结显式按目标模型上下文窗口做预算。

- **有效窗口 `n_ctx`**:本地 chat 模型 = 启动 `--ctx-size`(默认 4096);云模型 = `model_metadata.context_length`;拿不到则保守取 4096。提供一个解析函数,按 `model_name` 推出有效窗口。
- **预算公式**:`输入预算 = n_ctx - 模板开销 - 输出预留`。
  - map 调用:有界 `max_tokens ≈ 384`(每块摘要);
  - reduce 调用:有界 `max_tokens ≈ 768`(合并);
  - 不再透传 `max_tokens=None`。这两个值先按经验定,后续可经 settings 配置。
- **map 阶段切块**:对 `kb.list_docs` 的每个 chunk,若「正文 token 估算 + 模板开销 + 输出预留 > n_ctx」则递归字符切分,保证每次 map 调用必然塞进窗口。
- **中文 token 估算**:不用 tiktoken 英文表;改用保守估算(按字符数 × 系数,取上界),用于切块判断与 reduce 折叠阈值。
- **reduce 折叠阈值**:`token_max` 由 `n_ctx` 推导(为合并 prompt 头部留足空间),不再硬编码 1300。

产出:大文件分多轮 map + 递归 reduce 稳定跑完,不再溢出。`summarize_file_now`(详情页按钮)与服务端路由共用此实现。

### 2. ChatGraph 服务端意图路由

在 `chat/graph` 链路 `classify` 之后、`retrieve` 之前插入轻量分流节点:

```
quota_check → classify → [新] detect_summarize → guardrail_in → retrieve → ...
```

- **触发条件**:仅 `resolved_mode ∈ {kb, multi_source}` 时判定,其余模式零开销跳过。
- **意图判定**:把前端 `detectSummarizeIntent` 逻辑移植到服务端 —— 关键词命中 + 在该 KB 文件列表里**唯一**匹配一个文件名。
  - 命中 → `state.summarize_file = {kb_name, file_name}`;
  - 0 个或多个匹配 → 不写,照常走普通 RAG(绝不瞎猜,与前端一致)。
- **分流执行**:`retrieve` 节点检查 `state.summarize_file`:
  - 命中 → 全文总结分支(复用第 1 节预算化 `SummaryAdapter` + 内容哈希缓存,命中秒回),摘要作为最终答案;
  - 未命中 → 现有 `KBHandler` 多源检索。
- **失败兜底**:总结分支异常 → fail-soft 退回普通 RAG,不让对话报错断流。

### 3. 聊天里的流式 / 大文件 / UX

- **流式**:总结结果走现有 chat SSE 协议(`stage` 事件标「正在通览全文…」,摘要文本走 `token`/最终消息)。常规对话里呈现为一条正常 AI 回答,无需详情页的进度条组件。
- **大文件**:聊天链路**不弹二次确认**(第 1 节已让大文件可稳定跑完),直接跑 + `stage` 进行中提示。详情页按钮保留其原有 `needs_confirm` 交互。
- **不动**:详情页「总结全文」按钮 + 前端 `detectSummarizeIntent` 拦截;进度条 UI 改动(已 typecheck 绿,见下)独立保留。

### 4. 已附带完成的 UI 修复(独立于上述,已落代码待提交)

详情页点「总结全文」出现**两个进度条**:`MessageBubble` 对带 `taskProgress` 的消息渲染一条,`FileSummaryMessageExtras`(extraSlot)又渲染一条。已修:

- `MessageBubble.tsx`:带 `metadata.summary` 的消息跳过通用大进度条;
- `FileSummaryMessageExtras.tsx`:running 态改为一行紧凑小条(loader + 文案 + 细进度条 + 百分比 + 末尾 X 取消图标),去掉独立「取消」按钮与重复 `TaskProgressPart`。

`npm run typecheck` 全包通过。

## 风险与取舍

- 服务端路由与前端详情页拦截**各有一条触发路径**,共用同一预算化 `SummaryAdapter` 与缓存,行为一致,仅入口不同。彻底统一留待后续。
- map/reduce 的 `max_tokens` 与折叠阈值为经验值,需真机大文件验证后微调。
- 中文 token 保守估算偏安全(宁可多切块),可能略增 LLM 调用次数,换取不溢出。

## 测试与验证

- **服务端**(py312,本机可跑):
  - 意图路由单测:关键词命中 + 唯一文件匹配 → 命中;0/多匹配 → 不命中(走 RAG)。
  - 预算切块单测:超长 chunk 被切到窗口内;map/reduce `max_tokens` 有界。
  - 中文 token 估算单测:上界保守。
  - fail-soft:总结分支抛异常 → 退回 RAG。
- **真机**:对《答辩状.docx》在常规对话提问 → 返回整篇总结(非片段);大文件不再「Context size has been exceeded」。
- **前端**:typecheck;详情页进度条目视为单条小条 + X。

## 验收标准

1. 常规对话(网络版/桌面版)选中文档知识库,问「X 文件讲了什么」→ 整篇全文总结。
2. 详情页《答辩状.docx》总结全文不再溢出失败。
3. 详情页进度条为单条紧凑小条,X 可取消。
4. 选中知识库的普通问题(非总结意图)行为不变,仍走 RAG。
