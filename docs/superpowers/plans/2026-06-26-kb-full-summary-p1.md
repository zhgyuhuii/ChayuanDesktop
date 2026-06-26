# 知识库全文总结 P1 实施 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉"全文总结又慢一遍 + 几页云端文档不走单次快路径"两个真因——缓存键改稳定口径（file_hash 优先）、`list_docs` 加稳定排序、`model_name` 空时回退默认模型让 ctx 正确解析。

**Architecture:** 不改"点击触发 + 流式 + map-reduce 兜底"现有链路，只在三处做最小修正：① `list_docs_from_db` 加 `ORDER BY id` 保证 chunk 顺序稳定；② 缓存判别值优先用文件已存的 `file_hash`、无则用"已排序 chunk 文本哈希"（不再随查询顺序漂移）；③ `summarize_file_now` 入口把空 `model_name` 解析成默认 LLM，使 `resolve_model_ctx` 拿到真实 ctx（云端 ≥32K）→ 几页文档走单次整篇。

**Tech Stack:** Python / FastAPI / SQLAlchemy（PostgreSQL）/ pytest；前端 TS/React（P1 不改前端，仅核对）。

**约定：** 所有改动在 desktop 内嵌副本 `/work/chayuan-desktop/chayuan-server`。沙箱可跑纯逻辑 pytest（py312，免密 sudo + root conda）；DB/FAISS/LLM 真链路只能 `py_compile` + docker 网络版真机验证。`/work/chayuan-desktop` 文件 root 属主，提交需 `sudo git`。

---

### Task 1: `list_docs_from_db` 加稳定排序（chunk 按入库顺序）

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/db/repository/knowledge_file_repository.py:62`

- [ ] **Step 1: 改 query 加 order_by**

把第 62 行：

```python
    return [{"id": x.doc_id, "metadata": x.metadata} for x in docs.all()]
```

改为（`FileDocModel.id` 自增 = 入库即文档顺序，保证两次调用顺序一致）：

```python
    return [
        {"id": x.doc_id, "metadata": x.metadata}
        for x in docs.order_by(FileDocModel.id).all()
    ]
```

- [ ] **Step 2: py_compile 校验语法**

Run: `cd /work/chayuan-desktop/chayuan-server && python -m py_compile libs/chayuan-server/chayuan/server/db/repository/knowledge_file_repository.py`
Expected: 无输出（成功）。

- [ ] **Step 3: 提交**

```bash
cd /work/chayuan-desktop && sudo git add chayuan-server/libs/chayuan-server/chayuan/server/db/repository/knowledge_file_repository.py
sudo git commit -m "fix(kb): list_docs_from_db 加 ORDER BY id 稳定 chunk 顺序"
```

---

### Task 2: 缓存判别值 file_hash 优先（纯逻辑 + 单测）

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/knowledge_base/kb_summary/cache_key.py`
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_kb_summary_cache_key.py`

- [ ] **Step 1: 写失败测试**

在 `test_kb_summary_cache_key.py` 末尾追加：

```python
from chayuan.server.knowledge_base.kb_summary.cache_key import summary_discriminator


def test_discriminator_prefers_file_hash():
    # 有 file_hash 时:直接用它,完全不依赖 chunk 文本/顺序
    d1 = summary_discriminator("abc123", ["chunk A", "chunk B"])
    d2 = summary_discriminator("abc123", ["completely", "different", "chunks"])
    assert d1 == "abc123"
    assert d1 == d2  # 只要 file_hash 不变,判别值就不变


def test_discriminator_falls_back_to_content_hash():
    # file_hash 为空(历史文件)→ 回退按给定(已排序)顺序的内容哈希,且稳定可复现
    d1 = summary_discriminator("", ["chunk A", "chunk B"])
    d2 = summary_discriminator(None, ["chunk A", "chunk B"])
    assert d1 == d2
    assert len(d1) == 16  # content_hash 短哈希
    # 内容不同 → 判别值不同
    assert summary_discriminator("", ["X"]) != d1
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH=libs/chayuan-server python -m pytest libs/chayuan-server/tests/unit_tests/test_kb_summary_cache_key.py -q`
Expected: FAIL（`ImportError: cannot import name 'summary_discriminator'`）。

- [ ] **Step 3: 实现 summary_discriminator**

在 `cache_key.py` 的 `content_hash` 之后、`file_summary_cache_key` 之前插入：

```python
def summary_discriminator(file_hash: str | None, ordered_chunk_texts: List[str]) -> str:
    """缓存键的判别部分:优先用文件已存的内容 SHA-256(file_hash);
    历史文件无 file_hash 时回退到"按给定(已排序)顺序的 chunk 文本哈希"。
    两者都只随文件内容变,不随查询顺序漂移(前提:调用方传入的 chunk 已稳定排序)。"""
    if file_hash:
        return file_hash
    return content_hash(ordered_chunk_texts)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH=libs/chayuan-server python -m pytest libs/chayuan-server/tests/unit_tests/test_kb_summary_cache_key.py -q`
Expected: PASS（全绿）。

- [ ] **Step 5: 提交**

```bash
cd /work/chayuan-desktop && sudo git add chayuan-server/libs/chayuan-server/chayuan/server/knowledge_base/kb_summary/cache_key.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_kb_summary_cache_key.py
sudo git commit -m "feat(kb): summary_discriminator 缓存判别值优先 file_hash"
```

---

### Task 3: `summarize_file_now` 接入 file_hash 键 + 空模型回退默认

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/knowledge_base/kb_summary_api.py`（line 12 cache_key import；line 17 server.utils import；key 构造 351-352 行；ctx 解析前 400 行附近）

- [ ] **Step 1: 补 import（3 处）**

(1) 第 12 行：

```python
from chayuan.server.knowledge_base.kb_summary.cache_key import content_hash, file_summary_cache_key
```

改为（新增 `summary_discriminator`，去掉本文件已不再直接用的 `content_hash`）：

```python
from chayuan.server.knowledge_base.kb_summary.cache_key import file_summary_cache_key, summary_discriminator
```

(2) 第 17 行：

```python
from chayuan.server.utils import BaseResponse, get_ChatOpenAI, wrap_done, get_default_embedding
```

改为（新增 `get_default_llm`）：

```python
from chayuan.server.utils import BaseResponse, get_ChatOpenAI, wrap_done, get_default_embedding, get_default_llm
```

(3) 在第 17 行之后新增一行：

```python
from chayuan.server.db.repository.knowledge_file_repository import get_file_detail
```

- [ ] **Step 2: 缓存键改用 file_hash 判别值**

把第 351-352 行：

```python
            texts = [getattr(d, "page_content", "") for d in doc_infos]
            key = file_summary_cache_key(file_name, content_hash(texts))
```

改为：

```python
            texts = [getattr(d, "page_content", "") for d in doc_infos]
            _detail = get_file_detail(knowledge_base_name, file_name) or {}
            key = file_summary_cache_key(
                file_name, summary_discriminator(_detail.get("file_hash"), texts)
            )
```

- [ ] **Step 3: 空 model_name 回退默认 LLM（修 ctx 退 4096 陷阱）**

在解析 ctx 之前（第 400 行 `ctx = resolve_model_ctx(model_name)` 这一行**之前**）插入：

```python
            # model_name 为空时,resolve_model_ctx 会退到本地 4096 → 几页文档被迫 map-reduce。
            # 回退到默认 chat 模型(通常云端,真实 ctx≥32K)→ 走单次整篇快路径。
            if not model_name:
                model_name = get_default_llm()
```

- [ ] **Step 4: py_compile 校验**

Run: `cd /work/chayuan-desktop/chayuan-server && python -m py_compile libs/chayuan-server/chayuan/server/knowledge_base/kb_summary_api.py`
Expected: 无输出（成功）。

- [ ] **Step 5: 提交**

```bash
cd /work/chayuan-desktop && sudo git add chayuan-server/libs/chayuan-server/chayuan/server/knowledge_base/kb_summary_api.py
sudo git commit -m "fix(kb): 总结缓存键用 file_hash + 空模型回退默认(修 ctx 退 4096)"
```

---

### Task 4: 回归——确认 token_budget 既有单测仍绿

**Files:**
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_summary_token_budget.py`、`test_file_summary_cache.py`、`test_kb_summary_oversize.py`

- [ ] **Step 1: 跑全部 summary 纯逻辑单测**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH=libs/chayuan-server python -m pytest libs/chayuan-server/tests/unit_tests/test_summary_token_budget.py libs/chayuan-server/tests/unit_tests/test_file_summary_cache.py libs/chayuan-server/tests/unit_tests/test_kb_summary_cache_key.py libs/chayuan-server/tests/unit_tests/test_kb_summary_oversize.py -q`
Expected: PASS（全绿，无回归）。

- [ ] **Step 2: 若有红，定位修复后重跑至全绿**（不改测试预期来"凑绿"，红了就查 Task 1-3 改动）

---

### Task 5: 前端核对（modelId 来源，P1 通常无需改）

**Files:**
- Check: `chayuan-client/packages/app/src/features/kb/detail/KbDetailPage.tsx:156`、`detail/useFileSummaryTurn.ts:66`

- [ ] **Step 1: 确认 modelId 来源是 composer 选中的对话模型**

`KbDetailPage.tsx:156` 是 `const modelId = useComposerStore((s) => s.modelId)`，`useFileSummaryTurn.ts:66` 传 `model_name: modelId || undefined`。这是用户选中的对话模型，来源正确。**由于 Task 3 后端已对空 model_name 回退默认 LLM，前端即便传 undefined 也安全，P1 不需要改前端。**

- [ ] **Step 2: typecheck（确认没被其它改动带歪）**

Run: `cd /work/chayuan-desktop/chayuan-client && npm run typecheck`
Expected: PASS。

> 若发现 `composer.modelId` 在 KB 详情页常为空且默认模型不是期望的云端模型，记录为 P1.5 跟进项（让 KB 详情页有独立模型选择），不在本 P1 范围内强改。

---

### Task 6: 真机端到端验证（docker 网络版）

**前置：** 沙箱跑不了 FAISS/DB/LLM 真链路，必须重建镜像在 docker 网络版验证。

- [ ] **Step 1: 重建并起网络版镜像**

按项目 docker 流程重建 `chayuan` 镜像（含上述后端改动）并起容器。

- [ ] **Step 2: 验证缓存命中（修"又慢一遍"）**

对同一文件点"总结"两次：
- 首次：流式出摘要，后端日志有 `[summary] start ... ` 或 `done(stream)`。
- 二次：SSE 帧应直接收到 `{status:"ok", cached:true}` **秒回**，后端**无** `[summary] start`。

- [ ] **Step 3: 验证几页云端文档走单次整篇**

用云端模型对几页文档总结，后端日志应是 `[summary] done(stream) ... ctx=<真实大值>`（如 32768/65536），**不是** `done(map-reduce)`，且耗时数秒级。

- [ ] **Step 4: 验证缓存自动失效**

重新上传/重建该文件索引（file_hash 变）后再点总结：应重新计算（`cached:false`），证明内容变后键变、不返回旧摘要。

- [ ] **Step 5: push**

```bash
cd /work/chayuan-desktop && sudo git push origin main
```

---

## 验收标准（P1 完成定义）

1. 同文件二次点击总结 `cached:true` 秒回（缓存真命中）。
2. 几页云端文档首次走单次整篇流式、耗时数秒级（不再 26s map-reduce）。
3. 文件内容变（重建索引）后总结自动重算。
4. 全部 summary 纯逻辑单测绿；前端 typecheck 绿；后端改动文件 py_compile 通过。

## 范围外（P2/P3，本 plan 不做）

- Tier 3 按文件 RAPTOR（海量文档）→ P2。
- MinIO 原文兜底 + re-index 自动清旧 summary → P3。
- KB 详情页独立模型选择器（若 Task 5 Step 2 发现需要）→ P1.5 跟进。
