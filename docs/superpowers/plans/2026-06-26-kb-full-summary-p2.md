# 知识库全文总结 P2 实施 Plan（Tier 3：按文件 RAPTOR 层次摘要）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让海量文档（chunk 数 > 200，约几十万字）也能产出整篇摘要——新增"按文件 RAPTOR 层次聚类摘要"，在 `summarize_file_now` 的兜底分支按规模切到它。

**Architecture:** 新建**独立纯逻辑模块** `kb_summary/per_file_raptor.py`，编排"嵌入→语义聚类→逐簇摘要→递归→根摘要"，三类外部能力（embed_fn / cluster_fn / summarize_fn）全部**注入式**传入，故无 langchain/sklearn 依赖、沙箱可单测（注入假函数）。默认实现复用现成 `file_rag/raptor/clustering.gmm_cluster` + `get_Embeddings` + summarize_file_now 已有的 `_reduce_call`。**与整库 RAPTOR 的本质区别：纯内存、只返回根摘要文本、不写回 KB 检索向量库（避免污染检索）。** 结果由现有缓存层（P1 的 file_hash 键）落库。

**Tech Stack:** Python / pytest（注入式纯逻辑单测）；运行时依赖 numpy/sklearn/umap（仅默认 cluster_fn 用，单测不碰）。

**约定（同 P1）：** 改动在 `/work/chayuan-desktop/chayuan-server`（root 属主，改文件用 `sudo` python 补丁脚本，提交 `sudo git`，只 stage 改的文件，commit message 末尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`，不 push）。纯逻辑 pytest：`cd /work/chayuan-desktop/chayuan-server && PYTHONPATH=libs/chayuan-server /usr/bin/python3.11 -m pytest <file> -q`（py3.11；conftest 读 root 设置时加 `sudo`）。

---

### Task 1: 新模块 `per_file_raptor.py`（TDD，注入式纯逻辑）

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/knowledge_base/kb_summary/per_file_raptor.py`
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_per_file_raptor.py`

- [ ] **Step 1: 写失败测试**

新建 `tests/unit_tests/test_per_file_raptor.py`：

```python
from chayuan.server.knowledge_base.kb_summary.per_file_raptor import (
    summarize_file_hierarchical,
)


def _fake_embed(texts):
    # 每条文本 → 一维向量(长度),够 cluster_fn 区分即可
    return [[float(len(t))] for t in texts]


def _fake_cluster_two(vectors, target_cluster_size=5):
    # 强制分两簇:前半 0、后半 1,模拟一次有效聚类
    n = len(vectors)
    labels = [0 if i < n // 2 else 1 for i in range(n)]
    return labels, (2 if n >= 2 else 1)


def _fake_cluster_converged(vectors, target_cluster_size=5):
    # 永远 1 簇 → 触发收敛、走最终 reduce
    return [0] * len(vectors), 1


def test_single_chunk_directly_summarized():
    calls = []
    def summ(text):
        calls.append(text); return "S:" + text
    out = summarize_file_hierarchical(
        ["only one"], embed_fn=_fake_embed,
        cluster_fn=_fake_cluster_two, summarize_fn=summ,
    )
    assert out == "S:only one"
    assert calls == ["only one"]  # 单 chunk 不聚类,直接摘要


def test_hierarchical_recurses_then_reduces_to_root():
    def summ(text):
        return "SUM(" + text.replace("\n\n", "|") + ")"
    out = summarize_file_hierarchical(
        ["a", "b", "c", "d"], embed_fn=_fake_embed,
        cluster_fn=_fake_cluster_two, summarize_fn=summ,
        target_cluster_size=1, max_levels=3,
    )
    # level1: 簇0={a,b}->SUM(a|b), 簇1={c,d}->SUM(c|d);
    # 仍 2 条 → 再聚类仍 2 簇但 len<=? 继续; 最终把剩余多条 reduce 成 1 条根
    assert out.startswith("SUM(")
    assert isinstance(out, str) and len(out) > 0


def test_converged_cluster_falls_to_final_reduce():
    def summ(text):
        return "ROOT"
    out = summarize_file_hierarchical(
        ["x", "y", "z"], embed_fn=_fake_embed,
        cluster_fn=_fake_cluster_converged, summarize_fn=summ,
        target_cluster_size=5,
    )
    # n=3 <= target 5 或 簇=1 → 不递归,直接对全篇 reduce 一次
    assert out == "ROOT"


def test_empty_returns_empty():
    out = summarize_file_hierarchical(
        [], embed_fn=_fake_embed, cluster_fn=_fake_cluster_two,
        summarize_fn=lambda t: "X",
    )
    assert out == ""


def test_progress_cb_called():
    seen = []
    summarize_file_hierarchical(
        ["a", "b", "c", "d"], embed_fn=_fake_embed,
        cluster_fn=_fake_cluster_two, summarize_fn=lambda t: "s",
        target_cluster_size=1, progress_cb=lambda done, total: seen.append(done),
    )
    assert seen and seen[-1] >= 1  # 至少推进过进度
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH=libs/chayuan-server /usr/bin/python3.11 -m pytest libs/chayuan-server/tests/unit_tests/test_per_file_raptor.py -q`
Expected: FAIL（ModuleNotFoundError / ImportError）。

- [ ] **Step 3: 实现模块**

新建 `per_file_raptor.py`：

```python
"""按文件 RAPTOR 层次摘要(Tier 3:海量文档)。

对单个文件的全部 chunk 文本做"嵌入→语义聚类→逐簇归纳→递归→根摘要"。
与整库 RAPTOR(file_rag/raptor/builder.build_raptor_for_kb)的区别:
  - 粒度=单文件(只喂该文件 chunk),不跨库;
  - 纯内存,只返回根摘要文本,**不写回 KB 检索向量库**(避免污染检索);
  - embed/cluster/summarize 三类能力全部注入式 → 无 langchain/sklearn 依赖,可单测。

极限摘要本身有损(海量文档→一段摘要),逐簇按上界截断成员是可接受的取舍。
"""
from __future__ import annotations

from typing import Callable, List, Optional, Tuple

# 单簇拼接的成员上界(对齐整库 RAPTOR builder 的经验值,防单次 prompt 过大)
_MEMBER_CHAR_CAP = 1500
_MEMBERS_PER_CLUSTER_CAP = 12


def summarize_file_hierarchical(
    texts: List[str],
    *,
    embed_fn: Callable[[List[str]], List],
    cluster_fn: Callable[..., Tuple[List[int], int]],
    summarize_fn: Callable[[str], str],
    target_cluster_size: int = 5,
    max_levels: int = 3,
    progress_cb: Optional[Callable[[int, int], None]] = None,
) -> str:
    """对单文件全部 chunk 文本做层次聚类摘要,返回整篇(根)摘要。

    - ``embed_fn(texts) -> vectors``:把一组文本向量化。
    - ``cluster_fn(vectors, target_cluster_size=...) -> (labels, n_clusters)``:语义软聚类。
    - ``summarize_fn(joined_text) -> summary``:对一段拼接文本归纳。
    - ``progress_cb(done, total)``:每完成一次簇摘要回调(done 累计调用数,total 粗估)。
    空输入返回 ""。单条直接摘要。"""
    current = [t for t in (texts or []) if t and t.strip()]
    if not current:
        return ""
    if len(current) == 1:
        return (summarize_fn(current[0]) or "").strip()

    done = 0
    total_est = len(current)  # 粗估:最坏每条一次,够前端进度条用

    for _level in range(1, int(max_levels) + 1):
        vectors = embed_fn(current)
        labels, n_clusters = cluster_fn(vectors, target_cluster_size=int(target_cluster_size))
        if n_clusters <= 1 or len(current) <= int(target_cluster_size):
            break  # 收敛 → 走最终 reduce
        next_level: List[str] = []
        for cid in sorted(set(labels)):
            members = [current[i] for i, lb in enumerate(labels) if lb == cid]
            if not members:
                continue
            joined = "\n\n".join(
                (m or "")[:_MEMBER_CHAR_CAP] for m in members[:_MEMBERS_PER_CLUSTER_CAP]
            )
            s = (summarize_fn(joined) or "").strip()
            done += 1
            if progress_cb:
                progress_cb(done, total_est)
            if s:
                next_level.append(s)
        if not next_level:
            break
        current = next_level
        if len(current) == 1:
            return current[0]

    # 最终 reduce:把剩余(已是少数高层摘要)合并成一段根摘要
    if len(current) == 1:
        return current[0]
    joined = "\n\n".join(current)
    root = (summarize_fn(joined) or "").strip()
    done += 1
    if progress_cb:
        progress_cb(done, total_est)
    return root
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH=libs/chayuan-server /usr/bin/python3.11 -m pytest libs/chayuan-server/tests/unit_tests/test_per_file_raptor.py -q`
Expected: PASS（5 测试全绿）。

- [ ] **Step 5: 提交**

```bash
cd /work/chayuan-desktop && sudo git add chayuan-server/libs/chayuan-server/chayuan/server/knowledge_base/kb_summary/per_file_raptor.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_per_file_raptor.py
sudo git commit -m "feat(kb): per_file_raptor 按文件层次聚类摘要(注入式纯逻辑)"
```

---

### Task 2: token_budget 加 Tier 3 阈值常量

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/knowledge_base/kb_summary/token_budget.py`
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_summary_token_budget.py`

- [ ] **Step 1: 加常量**

在 `token_budget.py` 的 `MAP_CONCURRENCY: int = 4` 行之后新增：

```python
# Tier 3 触发阈值:单文件 chunk 数超过它 → 走按文件 RAPTOR 层次摘要(per_file_raptor),
# 而非线性 map-reduce。约几十万字。低于此走 Tier 1 单次整篇 / Tier 2 map-reduce。
RAPTOR_CHUNK_THRESHOLD: int = 200
```

- [ ] **Step 2: 加断言测试**

在 `test_summary_token_budget.py` 末尾追加：

```python
def test_raptor_threshold_constant():
    from chayuan.server.knowledge_base.kb_summary.token_budget import RAPTOR_CHUNK_THRESHOLD
    assert RAPTOR_CHUNK_THRESHOLD == 200
```

- [ ] **Step 3: 运行通过**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH=libs/chayuan-server /usr/bin/python3.11 -m pytest libs/chayuan-server/tests/unit_tests/test_summary_token_budget.py -q`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
cd /work/chayuan-desktop && sudo git add chayuan-server/libs/chayuan-server/chayuan/server/knowledge_base/kb_summary/token_budget.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_summary_token_budget.py
sudo git commit -m "feat(kb): token_budget 加 RAPTOR_CHUNK_THRESHOLD=200"
```

---

### Task 3: `summarize_file_now` 兜底分支按 chunk 数切 RAPTOR

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/knowledge_base/kb_summary_api.py`（约 401 import 段；494 的 `_run` 线程体；行号经 P1 改动后偏移,以下用文本精确匹配为准）

- [ ] **Step 1: import 加 RAPTOR_CHUNK_THRESHOLD**

找到 `summarize_file_now` 内的这段 import（约 393-395 行）：

```python
            from chayuan.server.knowledge_base.kb_summary.token_budget import (
                resolve_model_ctx, MAP_MAX_TOKENS, REDUCE_MAX_TOKENS, map_concurrency_for,
            )
```

改为（加 `RAPTOR_CHUNK_THRESHOLD`）：

```python
            from chayuan.server.knowledge_base.kb_summary.token_budget import (
                resolve_model_ctx, MAP_MAX_TOKENS, REDUCE_MAX_TOKENS, map_concurrency_for,
                RAPTOR_CHUNK_THRESHOLD,
            )
```

- [ ] **Step 2: `_run` 线程体按 chunk 数二选一**

找到 map-reduce 兜底里的 `_run`（约 479-490 行）：

```python
                def _run() -> None:
                    try:
                        _holder["summary"] = summarize_budgeted(
                            texts_for_summary, ctx=ctx,
                            map_call=_map_call, reduce_call=_reduce_call,
                            concurrency=map_concurrency_for(model_name),
                            progress_cb=lambda done, _total: _q.put(done),
                        )
                    except Exception as _e:  # noqa: BLE001
                        _holder["err"] = _e
                    finally:
                        _q.put(None)  # sentinel:无论成败都收尾,防生成器卡死
```

改为（chunk 数超阈值走按文件 RAPTOR，否则原 map-reduce）：

```python
                def _run() -> None:
                    try:
                        if len(doc_infos) > RAPTOR_CHUNK_THRESHOLD:
                            # Tier 3:海量文档 → 按文件层次聚类摘要(纯内存,不写回 KB)
                            from chayuan.server.knowledge_base.kb_summary.per_file_raptor import (
                                summarize_file_hierarchical,
                            )
                            from chayuan.server.file_rag.raptor.clustering import gmm_cluster
                            from chayuan.server.utils import get_Embeddings
                            _emb = get_Embeddings(resolved_embed)
                            _holder["summary"] = summarize_file_hierarchical(
                                texts_for_summary,
                                embed_fn=lambda ts: _emb.embed_documents(ts),
                                cluster_fn=gmm_cluster,
                                summarize_fn=_reduce_call,
                                progress_cb=lambda done, _total: _q.put(done),
                            )
                        else:
                            _holder["summary"] = summarize_budgeted(
                                texts_for_summary, ctx=ctx,
                                map_call=_map_call, reduce_call=_reduce_call,
                                concurrency=map_concurrency_for(model_name),
                                progress_cb=lambda done, _total: _q.put(done),
                            )
                    except Exception as _e:  # noqa: BLE001
                        _holder["err"] = _e
                    finally:
                        _q.put(None)  # sentinel:无论成败都收尾,防生成器卡死
```

> 说明：`resolved_embed`（KB 真实 embedding 模型，约 342 行已定义）、`_reduce_call`（约 421 行已定义）、`doc_infos`（约 343 行）、`texts_for_summary`（约 425 行）在该作用域内均已存在，直接用。

- [ ] **Step 3: py_compile 校验**

Run: `cd /work/chayuan-desktop/chayuan-server && python -m py_compile libs/chayuan-server/chayuan/server/knowledge_base/kb_summary_api.py`
Expected: 无输出。

- [ ] **Step 4: 提交**

```bash
cd /work/chayuan-desktop && sudo git add chayuan-server/libs/chayuan-server/chayuan/server/knowledge_base/kb_summary_api.py
sudo git commit -m "feat(kb): summarize_file_now chunk>200 走按文件 RAPTOR(Tier 3)"
```

---

### Task 4: 回归——全部 summary 单测仍绿

- [ ] **Step 1: 跑全套**

Run: `cd /work/chayuan-desktop/chayuan-server && PYTHONPATH=libs/chayuan-server /usr/bin/python3.11 -m pytest libs/chayuan-server/tests/unit_tests/test_summary_token_budget.py libs/chayuan-server/tests/unit_tests/test_file_summary_cache.py libs/chayuan-server/tests/unit_tests/test_kb_summary_cache_key.py libs/chayuan-server/tests/unit_tests/test_kb_summary_oversize.py libs/chayuan-server/tests/unit_tests/test_per_file_raptor.py -q`
Expected: PASS（全绿，含新增 per_file_raptor 与 threshold 测试）。

- [ ] **Step 2: 红则定位修复**（不改测试预期凑绿）。

---

### Task 5: 真机验证（docker 网络版，海量文档）

**前置：** 沙箱跑不了 sklearn/umap/embedding/LLM 真链路；必须重建镜像验证。

- [ ] **Step 1: 重建并起网络版镜像**（含本 P2 后端改动）。

- [ ] **Step 2: 准备一个 chunk 数 > 200 的大文件**（几十万字），入库建索引。

- [ ] **Step 3: 点总结 → 二次确认 → 观察**
- 应触发 `needs_confirm`（chunk>60），确认后开始算。
- 后端日志应能看到进度帧推进（`status:"progress"`），最终 `status:"ok"` 出根摘要、不报错、不无限转圈。
- 确认走的是层次摘要分支（chunk>200），不是普通 map-reduce 也不是单次整篇。

- [ ] **Step 4: 验证缓存**：同文件二次点 → `cached:true` 秒回（复用 P1 file_hash 缓存）。

- [ ] **Step 5: push**

```bash
cd /work/chayuan-desktop && sudo git push origin main
```

---

## 验收标准（P2 完成定义）

1. chunk > 200 的文档点总结：二次确认后能产出一段根摘要、不报错、不卡死。
2. 走的是 `per_file_raptor` 层次分支（非 map-reduce / 非单次整篇）。
3. 不写回 KB 检索向量库（检索结果不被摘要节点污染）。
4. 同文件二次点 `cached:true` 秒回。
5. 全部 summary 纯逻辑单测绿；改动文件 py_compile 通过。

## 范围外

- chunk ≤ 200 的文档仍走 P1 的单次整篇 / map-reduce（不变）。
- MinIO 原文兜底 + re-index 自动清旧 summary → P3。
- 成员截断（_MEMBER_CHAR_CAP/_MEMBERS_PER_CLUSTER_CAP）的质量调参 → 真机校准后按需。
