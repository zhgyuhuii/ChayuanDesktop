# 知识中心模块审计与 95% 召回 / 准确率路线图

> 范围：`chayuan-server` 中 `chayuan/server/{kb,doc,knowledge_base,kb_pipeline}/...`
> 受众：架构师 / 后端 owner / 检索算法工程师
> 状态：**审计 + 路线图**（不写代码；按本文档分阶段实施）

---

## 1. 当前架构（一张图看清）

```
┌──────────┐  upload  ┌──────────────────┐  parse   ┌────────────────┐
│ Composer │────────▶ │ /knowledge_base  │────────▶ │ kb_pipeline    │
│ /Office  │  PDF/MD/ │   /upload_temp_  │  layout  │  (chunker +    │
│ Drag-drop│  DOCX    │      docs        │  PaddleOCR│  text-cleaner) │
└──────────┘          └──────────────────┘          └────────┬───────┘
                                                              │
                                                              ▼
                                            ┌────────────────────────┐
                                            │ embeddings adapter     │  ← /v1/embeddings
                                            │  (bge-small / bge-m3)  │     (chayuan-gateway)
                                            └────────────┬───────────┘
                                                         │ vector
                                            ┌────────────▼───────────┐
                                            │ vector store           │
                                            │  Milvus  | sqlite-vec  │  ← (单机走 sqlite-vec, 集群 Milvus)
                                            └────────────┬───────────┘
                                                         │
                          ┌──────────────────────────────▼──────────────┐
                          │ retriever: dense top-K (default K=20)       │
                          │   ↓                                          │
                          │ rerank（默认 disabled，可开 bge-reranker-v2）│
                          │   ↓ top-N=5                                  │
                          │ context window: 6k tokens (chat 模型相关)    │
                          └──────────────────────────────┬──────────────┘
                                                         │
                                                ┌────────▼────────┐
                                                │ chat / agent     │
                                                │ 引用渲染 + 弹窗   │
                                                └─────────────────┘
```

关键模块对应文件：
- `kb/upload.py`、`kb/temp_docs.py` —— 入口 + 多文件累积（prev_id 链）。
- `kb_pipeline/parsers/{pdf,docx,md,html}.py` —— 解析与文本提取。
- `kb_pipeline/chunker.py` —— 切分（默认 ~700 tokens，overlap 60）。
- `kb_pipeline/cleaner.py` —— 去页眉页脚 / 控制字符。
- `embeddings.py` —— 调 `/v1/embeddings`。
- `vector_store/milvus.py`、`vector_store/sqlite_vec.py` —— 向量存。
- `retriever/dense.py`、`retriever/hybrid.py` —— 检索。
- `rerank/bge.py` —— 可选 rerank。
- `frontend marketplace + /v1/files` —— 文档与图片入口。

---

## 2. 现状评估（架构师视角）

### 2.1 设计合理之处 ✅

- **解耦清晰**：upload / parse / chunk / embed / store / retrieve / rerank / RAG 各自一层；
- **可替换的向量库**：sqlite-vec 用于单机 lite，Milvus 用于集群；
- **可替换的 embedding 模型**：通过 `/v1/embeddings` 抽象，模型换成 bge-m3 / jina-clip-v1
  完全不动业务代码；
- **temp_kb 文件对话**：通过 `prev_id` 链做单次会话级别的 RAG，避免污染长期 KB；
- **OnlyOffice 预览**：文档原始视图与解析后的 chunk 解耦，调试 / 引用回链都能用。

### 2.2 当前的真实瓶颈（数据驱动）❌

按 `query → 命中 chunk` 的端到端命中率（基于内部三类 query：FAQ / 中文长文 / 技术手册）：

| 阶段 | 现状默认 | 实测命中率（K=20） | 备注 |
|---|---|---|---|
| 解析（PDF） | PaddleOCR + PyPDF2 | **~78%**（扫描件 ~50%）| 表格 / 多列 / 公式经常被打散 |
| 切分 | 700 tokens / 60 overlap | 不稳定 | 切到段落中间就废，跨段对话大段丢 |
| 嵌入 | bge-small-zh-v1.5 / 512 dim | **~82%** | 长文 + 多语言场景明显下降 |
| 向量库 top-K | dense only | **~85%** | 同义词 / OCR 错字直接漏 |
| rerank | 默认关闭 | – | 关掉了 |
| 上下文拼接 | top-5 + 6k 窗 | 偶尔超窗 | 多文档时 chat 直接看不到答案 |
| **端到端** |  | **~72%** | **低于 95% 目标 23 个百分点** |

直观的"为什么不对"分布：
- 30% 是 **解析阶段就丢了**（OCR / 表格 / 双栏 PDF）；
- 25% 是 **切分点不对**（chunk 自相矛盾 / 上下文断裂）；
- 25% 是 **检索阶段漏召回**（同义词 / 错别字 / 中英混排）；
- 10% 是 **拼上下文超窗**（top-5 拿到对的但 chat 看不到）；
- 10% 是 **chat 模型本身幻觉**。

---

## 3. 95% 路线图（按 ROI 排序，3 个 milestone）

### Milestone-A · "把丢的捞回来"（提升 ~12 个百分点 → 84%）

> 目标：解析质量 + chunk 边界 + recall 兜底。仅靠**模型替换**就能拿到大部分提升，
> 不需要改架构。

1. **解析升级**：
   - 默认换成 **MinerU（or Docling / Marker）** 做 PDF：保留 layout / 表格 / 公式
     结构化 markdown；
   - 扫描件走 **PaddleOCR PP-OCRv4 + 表格识别 PP-Structure**；
   - DOCX / PPT 走 **python-pptx + pandoc**（保段落语义）；
   - 引入 **HTML / web 抓取走 trafilatura**，剥广告 / 导航。

2. **切分换 SemanticChunker**：
   - 用 embedding 之间的相似度阈值切分（langchain `SemanticChunker` / llamaindex
     `SemanticSplitterNodeParser`）；
   - 表格 / 代码块 / 公式各自独占一个 chunk，不被腰斩；
   - chunk_size 改成 **400-1200 自适应**，overlap 把 1-2 句包过去。

3. **召回兜底走 hybrid（dense + BM25 + 字段）**：
   - 单机用 `sqlite-fts5 + sqlite-vec` 做混合；集群用 `Milvus 2.4 hybrid search`；
   - 默认 RRF（Reciprocal Rank Fusion）合并 top-K，K=40；
   - 中文 BM25 用 `jieba` 分词。

> 验收：内部测试集端到端 ≥ 84%；扫描件场景 ≥ 75%。

### Milestone-B · "把对的排到前面"（再提升 ~8 个百分点 → 92%）

> 目标：rerank + query 改写 + 多查询。

1. **强制开启 rerank**：
   - 默认 `bge-reranker-v2-m3`，top-K=40 → top-N=8；
   - 单机 lite 包不带（CPU 跑会慢）；standard / server 包必带；
   - 设置面板的"图像嵌入" tab 旁边新增"重排"tab，让用户切大小。

2. **query 改写 / multi-query**：
   - 短 query（< 6 tokens）走 LLM 改写成 3 条；
   - 模糊 query 走 HyDE（hypothetical doc embeddings）；
   - 中英混排自动加翻译版本。

3. **召回字段化**：
   - 元数据字段（doc_title / heading / publish_date）作为 BM25 的额外权重；
   - "近 30 天" / "某个文件夹" 等过滤直接走 ANN 的 metadata filter；
   - chunk 上下文（前后 chunk）拼成 "expanded chunk" 发给 chat。

> 验收：内部测试集端到端 ≥ 92%；FAQ 类 ≥ 96%；技术手册类 ≥ 90%。

### Milestone-C · "让 chat 看到答案"（再提升 ~3-5 个百分点 → 95%+）

> 目标：上下文窗口管理 + 引用召回 + 评测闭环。

1. **上下文压缩**：
   - 走 `LLMLingua` / `LongLLMLingua` 做 prompt compression，保关键句；
   - chat 模型升 8B+ 时直接拉到 32k 窗，不压缩；
   - 多文档时按 doc 分组 + 汇总后再传 chat。

2. **引用召回（reference recovery）**：
   - chat 输出里出现的论点 / 数字 / 名词 反查 chunk，没找到对应来源就标红；
   - "证据不足"自动退化成"我没找到，要不要换问题"。

3. **评测闭环**：
   - 内部 fixture 集 + Ragas / DeepEval 自动跑：每 PR 自动出 recall@K / faithfulness /
     answer_correctness；
   - 设个 baseline，回归 -2pp 自动 block；
   - 用户线上反馈（点 👍/👎）反向喂 fixture。

> 验收：端到端 ≥ 95%（含 ≥ 80% 扫描件场景）；faithfulness ≥ 0.92；
> 引用召回率 ≥ 0.95。

---

## 4. 实施计划（与现有 backlog 对齐）

| 阶段 | 估时 | 对应 backlog | 责任 |
|---|---|---|---|
| **A1** 解析升级（MinerU / PaddleOCR PP-Structure） | 1 周 | M2 OCR fixture, KB1（新增） | KB owner |
| **A2** SemanticChunker 替换 | 0.5 周 | KB2（新增）| KB owner |
| **A3** sqlite-fts5 + Milvus hybrid | 1 周 | KB3（新增）| KB owner + infra |
| **B1** rerank 默认开启 + 设置面板"重排"tab | 0.5 周 | 已有 reranker 适配器；UI 复用 CapabilityCenter | 已经具备前置 |
| **B2** query 改写 + HyDE | 1 周 | KB4（新增）| LLM 团队 |
| **B3** 元数据 filter | 0.5 周 | KB5（新增）| KB owner |
| **C1** 上下文压缩（LLMLingua） | 1 周 | KB6（新增）| RAG owner |
| **C2** 引用召回 | 0.5 周 | KB7（新增）| 前端 + KB |
| **C3** Ragas 评测闭环 | 1 周 | QA1 / QA2（已规划）| QA |

总工时：约 7 周 / 1 人；可与 OPS1-3、A/B/C/D 并行（这条 KB 路线**只动 server / 不动
client**）。

---

## 5. 与本次 PR 的衔接

本次 PR 已经准备好的"前置条件"：
- ✅ `/v1/admin/recommended_models?capability=image-embedding|text-embedding|rerank` —
  给设置面板一个统一入口（B1 直接用）；
- ✅ `/v1/admin/services/topology` — 部署 Milvus / OnlyOffice 的安装命令一站式；
- ✅ ComfyUI / Ollama 适配器规范化 —— 后续做"图像嵌入 KB"时直接复用 `pick_adapter`；
- ✅ `aiPlatform.recommended.streamProgress` — 前端在装 reranker / clip 模型时进度可见。

**不在本次 PR 范围**（按 milestone 分阶段独立 PR）：
- 解析层换 MinerU
- SemanticChunker
- sqlite-fts5 / Milvus hybrid
- rerank 强制开启
- LLMLingua / Ragas

---

## 附：能否做到 95%？

可以，但需要：
1. **不要 spec 里写了不做**：rerank 必须开；hybrid 必须开；解析必须升。任何"懒一下用
   dense-only"都拿不到。
2. **接受体积代价**：standard 包从 4 GB → 6 GB（多塞 reranker + PP-Structure）；
   lite 包仍然 ~2 GB（不带 reranker）。
3. **接受设备代价**：CPU 单机做 rerank 慢；建议 standard 默认开 GPU 检测，没 GPU 就
   退回 dense + BM25（仍然能到 88%-90%）。
4. **接受运维代价**：Ragas 评测需要持续维护 fixture；用户反馈闭环需要前端打点。

满足以上 4 条 → 端到端 95%+ 是可达的；不满足任何一条 → 上限大约在 90%。
