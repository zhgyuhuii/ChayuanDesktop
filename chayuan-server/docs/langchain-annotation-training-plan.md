# LangChain 数据标注、评测与模型优化实施方案

## 1. 目标

建设一条从真实业务数据到可训练数据的闭环：

1. 从 KB 查询、Office 助手、AI Space 运行、对话历史和审计日志中采样。
2. 用 LLM 预标注降低人工成本。
3. 人工标注和复审形成可信样本。
4. 用 LangChain/LangSmith 建评测集和回归测试。
5. 导出训练数据，用于 RAG、reranker、分类器、小模型或大模型微调。

核心原则：先提升数据质量和评测稳定性，再决定是否训练模型。

## 2. 已实现基础

本轮已实现 P0 数据标注中心基础：

- 后端表：`annotation_task`、`annotation_feedback`
- 后端路由：`/annotation/tasks`、`/annotation/tasks/{id}`、`/annotation/tasks/{id}/claim`、`/annotation/tasks/{id}/review`、`/annotation/datasets/export`、`/annotation/feedback`
- 前端 SDK：`annotationApi`
- 前端页面：`/annotation`
- 导出格式：JSON 与 JSONL

`annotation_task` 使用通用 JSON 字段承载输入、模型输出、预标注、人工标签、复审结论和元数据，兼容 QA、RAG、OfficeAction、安全合规、偏好对等多种任务。

`annotation_feedback` 用于保存业务过程中的即时质量反馈和多人标注记录。每个标注员或业务用户提交一条独立反馈，不覆盖其他人的判断；系统把同一 task 下的反馈聚合到 `annotation_task.review.feedback_summary`，形成 good / bad / mixed 共识、平均评分和错误标签计数。

`/annotation` 页面已提供任务过滤、任务详情、领取、标签 JSON 编辑、复审 JSON 编辑、提交与 JSONL 导出入口。

已新增第一条业务数据采样入口：

- `POST /annotation/sample/route-context`
- 前端 `annotationApi.sampleFromRouteContext()`
- `/annotation` 页面顶部可输入 `route_context id` 生成标注任务

该入口会把搜索/定位历史中的 query、route、context、anchor、result_doc_ids、first_match_anchor 转为 `office_search_relevance` 或指定 task_type 样本。

已新增第二条业务数据采样入口：

- Office 编辑器助手动作 Apply / Reject 反馈
- 前端 `OfficeEditorPage` 调用 `annotationApi.createTask()`
- 生成 `office_action_review` 标注任务

该入口会把用户指令、助手信息、文档格式、动作 JSON、动作序号、Apply/Reject 结果沉淀为样本。用户 Apply 成功的动作可作为正样本候选；用户 Reject 的动作可作为负样本或偏好训练 rejected 样本候选。

已新增第三条业务数据采样入口：

- `POST /annotation/sample/kb-ask`
- 前端 `annotationApi.sampleFromKbAsk()`
- `useKbAskTrial`、`KbDetailComposer`、`KbBoard` 在 KB 查询完成后 best-effort 上报

该入口会把 KB 查询的 query、ku_ids、top_k、检索选项、响应 block、召回 chunk/row/hit、score、page、chunk_index、snippet 等字段沉淀为 `rag_relevance` 样本。它主要服务 RAG 召回相关性、引用正确性、回答质量评测，以及后续 reranker / embedding / answer evaluator 的数据集建设。

已新增第四条业务数据采样入口：

- Office 批量助手同步运行 `/office/assistant/batch-run`
- Office 批量助手后台任务 `/office/assistant/batch-jobs`
- 后端在 done / cancelled / failed 后调用 `annotation_repository.create_task()`
- 生成 `office_batch_action_review` 标注任务

该入口会把 assistant_id、instruction、doc_ids、任务状态、成功/失败数量、首个成功 item、首个失败 item、首条 OfficeAction 和完整 items 沉淀为样本。成功批次可用于批量 OfficeAction 质量复审；失败或取消批次优先作为错误分类、负样本和鲁棒性评估数据。

已新增第五条业务数据采样入口：

- AI Space 主运行 `/ai/space/apps/{app_id}/run`
- AI Space 断点续跑 `/ai/space/apps/{app_id}/runs/{run_id}/resume`
- AI Space OpenAPI 调用 `/ai/space/v1/ai-app/{app_id}/invoke`
- 后端包装 SSE 事件流，在 done / error / waiting_human 终态采样
- 生成 `ai_space_run_review` 标注任务

该入口会把 app_id、app_name、version_id、run_id、inputs、最终 output、error/error_kind、终态事件、节点 trace、LLM/HTTP/tool/human_task 相关事件沉淀为样本。成功运行适合构建 LangSmith 端到端评测集；失败或等待人工的运行适合链路错误分类、工具轨迹复审和 workflow 鲁棒性优化。

已新增数据质量即时反馈能力：

- `POST /annotation/feedback`
- `GET /annotation/feedback`
- 前端 `annotationApi.submitFeedback()`、`annotationApi.listFeedback()`
- KB 查询结果卡片支持“好 / 部分正确 / 坏”、错误标签和备注

该能力用于对对话过程中的具体结果进行好坏评价。没有现成 task 时可自动创建 `data_quality_feedback` 或业务指定 task；已有 task 时会追加多人反馈记录并更新聚合摘要。它适合 KB 查询质量、引用质量、回答质量、OfficeAction 是否可用、AI Space 工具轨迹是否合理等所有在线反馈场景。

## 3. 数据标注任务类型

建议优先建设以下任务类型：

- `rag_relevance`：判断 query 与 chunk 是否相关。
- `answer_quality`：判断答案是否正确、完整、忠于上下文。
- `citation_accuracy`：判断引用是否指向正确文档位置。
- `office_action_review`：判断 `OfficeAction[]` 是否可执行、是否符合意图。
- `safety_confidential`：涉密、敏感、越权、合规风险标签。
- `preference_pair`：A/B 两个答案或动作的偏好选择。
- `intent_classification`：意图识别，如查询、写作、翻译、审查、生成 PPT。

## 4. LangChain/LangSmith 使用方式

### 4.1 LLM 预标注

用 LangChain chain 读取样本并产出初始标签：

- 相关性分数
- 错误类型
- 推荐答案
- 是否可进入训练集
- 标注理由

人工标注员只修正预标注结果，提高吞吐量。

### 4.2 自动评测

用 LangSmith Dataset 固化评测样本，每次改动模型、prompt、retriever、reranker 后跑同一批数据。

核心 evaluator：

- `qa_correctness`
- `context_relevance`
- `faithfulness`
- `citation_accuracy`
- `tool_call_validity`
- `office_action_validity`
- `safety_policy`

### 4.3 实验追踪

每次实验记录：

- 模型名称与参数
- embedding/reranker 配置
- prompt 版本
- retriever top_k、score_threshold
- tool call 轨迹
- latency、token、成本
- 各评测指标

## 5. 训练数据导出格式

### 5.1 QA / SFT JSONL

```json
{"messages":[{"role":"system","content":"..."},{"role":"user","content":"..."},{"role":"assistant","content":"..."}],"meta":{"task_type":"answer_quality"}}
```

### 5.2 Reranker Pair

```json
{"query":"...","positive":["chunk A"],"negative":["chunk B","chunk C"],"meta":{"kb":"..."}}
```

### 5.3 Preference Pair

```json
{"prompt":"...","chosen":"...","rejected":"...","reason":"chosen has correct citation"}
```

### 5.4 OfficeAction SFT

```json
{"input":{"instruction":"翻译选区","context":"..."},"output":{"actions":[{"type":"replace","target":{"quote":"..."},"content":"..."}]}}
```

## 6. 最优技术路线

### P0：标注中心基础

已完成：

- 标注任务表
- CRUD / 领取 / 复审 / 导出
- 前端 API SDK

下一步可加页面：任务列表、标注面板、复审面板。

已完成页面基础；下一步应增加更强的表单化标签 schema、冲突仲裁视图和批量采样入口。

### P1：样本采集

从以下链路自动创建标注任务：

- KB 查询：query、召回 chunk、最终答案、引用。（已接入 KB ask 完成采样）
- Office 助手：OfficeContext、OfficeAction、用户 apply/reject。（已接入编辑器 Apply/Reject 反馈）
- route_context：搜索命中和定位结果。（已接入手动采样）
- 批量助手：成功/失败样本和首条动作。（已接入同步与后台任务采样）
- AI Space：app run input/output/tool trace。（已接入主运行、断点续跑和 OpenAPI invoke 采样）

采样策略：

- 用户显式反馈优先。
- 低置信度、高成本、高风险样本优先。
- 错误、取消、人工 reject 优先。
- 每个任务类型设置每日采样上限。

### P2：LangChain 预标注与评测

新增服务：

- `annotation_prel_label_service.py`
- `langchain_eval_service.py`
- `langsmith_dataset_sync.py`

能力：

- LLM 预标注
- LangSmith dataset 同步
- evaluator 批量运行
- 实验对比报告

### P3：RAG / Reranker 优化

优先训练和优化：

- chunk 相关性 reranker
- hard negative 召回
- citation reranker
- query rewrite 分类器

不建议一开始微调通用大模型。

### P4：任务小模型

适合训练小模型的任务：

- 涉密/敏感分类
- 意图识别
- 文档类型识别
- OfficeAction 类型选择
- 错误标签分类

### P5：大模型微调

仅当满足以下条件再做：

- 单任务样本足够多。
- 输出格式稳定。
- 人工复审一致性高。
- RAG/prompt/reranker 优化仍不足。

优先微调：

- 公文润色
- 涉密审查
- OfficeAction 生成
- 报告摘要

## 7. 架构建议

推荐架构：

```text
业务日志 / Office / KB / AI Space
        ↓
annotation_task
        ↓
LLM 预标注
        ↓
人工标注 / 复审 / 仲裁
        ↓
LangSmith Dataset / 本地 Eval Dataset
        ↓
RAG/Reranker/Prompt 回归评测
        ↓
训练数据导出
        ↓
Embedding / Reranker / 小模型 / 大模型微调
```

## 8. 行业最佳实践

- 用真实用户数据做评测样本，但必须脱敏。
- 标注必须有复审和冲突仲裁。
- 所有训练样本必须能追溯来源和版本。
- 优先训练 reranker 与分类器，谨慎微调大模型。
- 用固定评测集比较每次 prompt、模型、检索策略改动。
- 对高风险任务使用人工确认，不让模型自动写入生产数据。
- 保留 rejected 样本，它们是 hard negative 和偏好训练的高价值数据。

## 9. 后续实现清单

- 标注中心前端页面。
- 从 KB 查询和 Office 助手自动生成标注任务。
- LLM 预标注 worker。
- LangSmith dataset 同步。
- LangChain evaluator 批处理接口。
- JSONL 导出格式细分：SFT、preference、reranker。
- 脱敏与权限策略。
- 标注一致性指标：IAA / Cohen Kappa。
- 数据版本管理：dataset version、model version、prompt version。
