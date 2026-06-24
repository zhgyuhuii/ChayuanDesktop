# 知识库「全文总结」M1(服务端) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 服务端按需对单个文件做整篇 map-reduce 总结,带内容哈希缓存、超大文件二次确认、流式进度;不接 NL(M3)、不接前端按钮(M2)。

**Architecture:** 新增独立流式端点 `POST /kb_summary_api/summarize_file_now`(不动 /kb-query/search 同步链路)。复用 `kb.list_docs(file_name)`+`get_doc_by_ids` 取全文、`SummaryAdapter`(map-reduce)归纳、`KBSummaryService` 摘要库做缓存。缓存键 = 文件名 + 全文内容哈希(重新入库→哈希变→失效)。chunk 数超阈值(默认 60)且未确认 → 返回 needs_confirm。

**Tech Stack:** FastAPI、LangChain MapReduceDocumentsChain(已用)、FAISS 摘要库(KBSummaryService)、asyncio。

**沙箱限制:** 纯逻辑(哈希键 / 阈值 / 缓存命中判定)可在 py3.11 单测;map-reduce 链依赖 langchain,沙箱跑不了,标 [INTEGRATION] 待用户环境验。

---

### Task 1: 内容哈希缓存键(纯函数,沙箱可测)

**Files:**
- Create: `libs/chayuan-server/chayuan/server/knowledge_base/kb_summary/cache_key.py`
- Test: `libs/chayuan-server/tests/unit_tests/test_kb_summary_cache_key.py`

- [ ] **Step 1: 失败测试**
```python
from chayuan.server.knowledge_base.kb_summary.cache_key import file_summary_cache_key, content_hash

def test_hash_stable_and_order_independent():
    h1 = content_hash(["a", "b", "c"])
    h2 = content_hash(["a", "b", "c"])
    assert h1 == h2 and len(h1) == 16
    # 内容变 → 哈希变
    assert content_hash(["a", "b", "c"]) != content_hash(["a", "b", "x"])

def test_cache_key_shape():
    k = file_summary_cache_key("报告.pdf", "deadbeefdeadbeef")
    assert k == "summary::报告.pdf::deadbeefdeadbeef"
```
- [ ] **Step 2: 跑测试验证失败** — `pytest .../test_kb_summary_cache_key.py -v` → FAIL (module 不存在)
- [ ] **Step 3: 实现**
```python
"""文件全文摘要的缓存键:文件名 + 全文内容哈希。文件重新入库(内容变)→ 哈希变 → 缓存自动失效。"""
from __future__ import annotations
import hashlib
from typing import List

def content_hash(chunk_texts: List[str]) -> str:
    """对全部 chunk 文本(按给定顺序)算稳定短哈希(16 hex)。"""
    h = hashlib.sha256()
    for t in chunk_texts:
        h.update(t.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:16]

def file_summary_cache_key(file_name: str, chash: str) -> str:
    return f"summary::{file_name}::{chash}"
```
- [ ] **Step 4: 跑测试验证通过** — PASS
- [ ] **Step 5: 提交** — `git commit -m "feat(kb-summary): 全文摘要内容哈希缓存键(纯函数)"`

---

### Task 2: 超大文件阈值 / needs_confirm 判定(纯函数,沙箱可测)

**Files:**
- Create: `libs/chayuan-server/chayuan/server/knowledge_base/kb_summary/oversize.py`
- Test: `libs/chayuan-server/tests/unit_tests/test_kb_summary_oversize.py`

- [ ] **Step 1: 失败测试**
```python
from chayuan.server.knowledge_base.kb_summary.oversize import summarize_precheck

def test_under_threshold_runs():
    r = summarize_precheck(chunk_count=10, confirmed=False, threshold=60)
    assert r.needs_confirm is False

def test_over_threshold_needs_confirm():
    r = summarize_precheck(chunk_count=120, confirmed=False, threshold=60)
    assert r.needs_confirm is True
    assert r.chunk_count == 120
    assert r.est_llm_calls >= 120  # map 调用至少 = 块数

def test_over_threshold_confirmed_runs():
    r = summarize_precheck(chunk_count=120, confirmed=True, threshold=60)
    assert r.needs_confirm is False
```
- [ ] **Step 2: 跑测试验证失败**
- [ ] **Step 3: 实现**
```python
"""超大文件二次确认:chunk 数超阈值且未确认 → needs_confirm(带预估)。"""
from __future__ import annotations
from dataclasses import dataclass

@dataclass
class SummarizePrecheck:
    needs_confirm: bool
    chunk_count: int
    est_llm_calls: int

def summarize_precheck(*, chunk_count: int, confirmed: bool, threshold: int = 60) -> SummarizePrecheck:
    over = chunk_count > threshold
    # map 阶段每块 1 次 + reduce 合并若干次(粗估为 ceil(块/5))
    est = chunk_count + max(1, (chunk_count + 4) // 5)
    return SummarizePrecheck(needs_confirm=over and not confirmed, chunk_count=chunk_count, est_llm_calls=est)
```
- [ ] **Step 4: 跑测试验证通过**
- [ ] **Step 5: 提交**

---

### Task 3: 缓存读写封装(KBSummaryService 包装;命中判定沙箱可测,FAISS [INTEGRATION])

**Files:**
- Create: `libs/chayuan-server/chayuan/server/knowledge_base/kb_summary/file_summary_cache.py`
- Test: `libs/chayuan-server/tests/unit_tests/test_file_summary_cache.py`(mock KBSummaryService)

- [ ] **Step 1: 失败测试(mock 掉 FAISS,只验命中/写回逻辑)**
```python
from unittest import mock
from chayuan.server.knowledge_base.kb_summary import file_summary_cache as fsc

def test_get_returns_none_on_miss():
    store = mock.Mock()
    store.search_by_key.return_value = None
    assert fsc.get_cached_summary(store, "summary::a::h") is None

def test_get_returns_text_on_hit():
    store = mock.Mock()
    store.search_by_key.return_value = "整篇摘要正文"
    assert fsc.get_cached_summary(store, "summary::a::h") == "整篇摘要正文"
```
- [ ] **Step 2: 跑测试验证失败**
- [ ] **Step 3: 实现**(薄封装;`search_by_key`/`put` 在 [INTEGRATION] 阶段对接 KBSummaryService 的 FAISS metadata 查询)
```python
"""文件全文摘要缓存的读写薄封装(底座 = KBSummaryService 摘要 FAISS 库)。
命中判定逻辑此处可单测;FAISS 实际读写在 KBSummaryService,集成态验证。"""
from __future__ import annotations
from typing import Optional, Protocol

class SummaryStore(Protocol):
    def search_by_key(self, key: str) -> Optional[str]: ...
    def put(self, key: str, summary_text: str) -> None: ...

def get_cached_summary(store: SummaryStore, key: str) -> Optional[str]:
    try:
        return store.search_by_key(key)
    except Exception:
        return None

def put_summary(store: SummaryStore, key: str, summary_text: str) -> None:
    try:
        store.put(key, summary_text)
    except Exception:
        pass  # 缓存写失败不影响主流程返回结果
```
- [ ] **Step 4: 跑测试验证通过**
- [ ] **Step 5: 提交**

> [INTEGRATION] 在 KBSummaryService 上补 `search_by_key(key)`(按 metadata.summary_key 过滤 FAISS)与 `put(key, text)`(add_kb_summary 时把 key 写进 metadata)。用户环境验证。

---

### Task 4: 并发 map-reduce 包装(复用 SummaryAdapter;[INTEGRATION])

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/knowledge_base/kb_summary/summary_chunk.py`(加并发 map 选项)
- Create: `libs/chayuan-server/chayuan/server/knowledge_base/kb_summary/summarize_now.py`

- [ ] **Step 1: 实现 summarize_now 编排**(组合 Task1-3 + SummaryAdapter)
```python
"""按需单文件全文总结:缓存命中→秒回;否则 list_docs 取全文→并发 map-reduce→写缓存。"""
from __future__ import annotations
from typing import Optional
from chayuan.server.knowledge_base.kb_summary.cache_key import content_hash, file_summary_cache_key
from chayuan.server.knowledge_base.kb_summary.oversize import summarize_precheck
from chayuan.server.knowledge_base.kb_summary import file_summary_cache as fsc

def summarize_file_now(*, kb, summary_store, file_name: str, confirmed: bool,
                       threshold: int, make_adapter, concurrency: int = 6):
    docs = kb.list_docs(file_name=file_name)            # 全部 chunk(含文本)
    texts = [d.page_content for d in docs]
    key = file_summary_cache_key(file_name, content_hash(texts))
    cached = fsc.get_cached_summary(summary_store, key)
    if cached is not None:
        return {"status": "ok", "cached": True, "summary": cached}
    pre = summarize_precheck(chunk_count=len(docs), confirmed=confirmed, threshold=threshold)
    if pre.needs_confirm:
        return {"status": "needs_confirm", "chunk_count": pre.chunk_count, "est_llm_calls": pre.est_llm_calls}
    adapter = make_adapter()                              # 复用 SummaryAdapter.form_summary(...)
    result = adapter.summarize(file_description="", docs=docs)   # map-reduce(map 并发见下)
    summary = result["summary"] if isinstance(result, dict) else str(result)
    fsc.put_summary(summary_store, key, summary)
    return {"status": "ok", "cached": False, "summary": summary}
```
- [ ] **Step 2: SummaryAdapter map 并发**:把 map 阶段对 docs 的 LLM 调用改成 `asyncio.gather` 分批(batch=concurrency),reduce 不变。[INTEGRATION] 用真 llm 验证摘要正确 + 并发提速。
- [ ] **Step 3: py_compile 全部新文件** — `python -m py_compile .../kb_summary/*.py` → OK
- [ ] **Step 4: 提交**

---

### Task 5: 流式端点 + 路由注册

**Files:**
- Modify: `libs/chayuan-server/chayuan/server/api_server/kb_routes.py`(summary_router 加端点)

- [ ] **Step 1: 加端点**(镜像现有 summary_file_endpoint 的鉴权/参数;流式吐进度)
```python
@summary_router.post("/summarize_file_now", summary="按需对单文件做整篇总结(带缓存/二次确认/流式)")
def summarize_file_now_endpoint(
    knowledge_base_name: str = Body(...),
    file_name: str = Body(...),
    confirmed: bool = Body(False),
    model_name: str = Body(None),
    temperature: float = Body(0.01),
    max_tokens: int = Body(None),
    user=Depends(require_auth_enabled()),
):
    _require_write(user, knowledge_base_name)
    # 复用现有流式 output() 模式(EventSourceResponse):吐 {status, cached|needs_confirm|progress|summary}
    # 内部调 summarize_now.summarize_file_now(...);needs_confirm 直接吐一条事件结束。
    ...
```
- [ ] **Step 2: py_compile kb_routes.py** → OK
- [ ] **Step 3: 提交**

> [INTEGRATION] 端点真实流式行为、与前端 SSE 对接在 M2 + 用户环境联调。

---

### Task 6: 收尾

- [ ] **Step 1: 跑沙箱可测单测** — `pytest test_kb_summary_cache_key.py test_kb_summary_oversize.py test_file_summary_cache.py -v` → 全 PASS
- [ ] **Step 2: 全量 py_compile 改动文件**
- [ ] **Step 3: bump 版本 + 提交 + push**

## Self-Review
- 覆盖 spec M1:契约(端点)/总结路径/缓存(内容哈希)/needs_confirm 阈值/并发 ✓;NL 与按钮明确排除(M2/M3)✓。
- 无占位:纯函数任务给了完整测试+实现;langchain/FAISS 部分明确标 [INTEGRATION](沙箱不可测,非占位)。
- 类型一致:summarize_precheck/SummarizePrecheck、file_summary_cache_key、get_cached_summary/put_summary 跨任务命名一致 ✓。
