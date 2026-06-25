# 全文总结服务端统一路由 + 上下文预算化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有客户端(网络版/桌面版/WPS)在选中知识库的常规对话里问「某文件讲了什么」触发整篇全文总结,并修好总结器使其在 4096 上下文本地模型上不溢出。

**Architecture:** 两层。① 上下文预算化总结器(替换 LangChain 不可控的 token 计数,自己按 n_ctx 做 map 切块 + 有界 max_tokens + 贪心分组 reduce + 保守中文 token 估算)。② ChatGraph 在 classify 后插 detect_summarize 节点,命中则跳过 RAG 检索、由 BaseModeHandler.generate_override_stream 走共享的 stream_file_summary 流式产出摘要;0/多匹配或异常 fail-soft 退回普通 RAG。

**Tech Stack:** Python 3.12 / FastAPI / LangChain(LLMChain 单次调用) / pytest。所有路径根 = `/work/chayuan-desktop/chayuan-server/libs/chayuan-server/chayuan/server/`(下称 `$S/`)。测试根 = `/work/chayuan-desktop/chayuan-server/libs/chayuan-server/tests/`(下称 `$T/`)。

**测试运行约定**(本机 py312,见记忆 reference_py312_test_env):
```bash
cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server
PYTHONPATH=. sudo -E /root/miniconda3/envs/py312/bin/python -m pytest -q <test_file> 2>&1 | tail -30
```
纯逻辑测试也可用 py3.11。**仓库 root 所有,改文件流程**:写到 scratchpad → `sudo cp` 覆盖(保留 root 属主);或 `sudo python3 -` 脚本就地改。

**提交约定**:每个 Task 末尾提交;有程序代码改动的提交才 bump 版本(VERSION + 3 个 `chayuan-client/apps/*/src-tauri/tauri.conf.json` + `chayuan-server/libs/chayuan-server/pyproject.toml`,当前 2.0.291)。commit 用 sudo,只 stage 改的文件,末尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

---

## File Structure

新建:
- `$S/knowledge_base/kb_summary/token_budget.py` — 纯逻辑:中文 token 估算、n_ctx 解析、map/reduce 预算常量。
- `$S/knowledge_base/kb_summary/intent.py` — 纯逻辑:服务端版 detect_summarize_intent(移植前端)。
- `$S/chat/handlers/file_summary_stream.py` — 共享流式总结产出器(reuse 预算化总结 + 缓存)。
- `$T/unit_tests/test_summary_token_budget.py`
- `$T/unit_tests/test_summary_intent.py`
- `$T/unit_tests/test_budgeted_summarize.py`
- `$T/unit_tests/test_detect_summarize_node.py`

修改:
- `$S/knowledge_base/kb_summary/summary_chunk.py` — SummaryAdapter 增预算化 map-reduce(`summarize_budgeted`)。
- `$S/knowledge_base/kb_summary_api.py` — `summarize_file_now` 改调预算化路径 + max_tokens 兜底。
- `$S/chat/graph/state.py` — ChatState 增 `summarize_file` 字段。
- `$S/chat/graph/nodes.py` — 增 `node_detect_summarize`;`node_retrieve_async` 命中总结时短路。
- `$S/chat/graph/runner.py` — `run_chat_stream` classify 后调 detect 节点。
- `$S/chat/graph/graph.py` — graph 插节点 + 两条 linear fallback 插调用。
- `$S/chat/handlers/base.py` — `generate_override_stream` 命中 `summarize_file` 时返 stream_file_summary。

---

## Phase A — 上下文预算化总结器(地基)

### Task A1: token 预算工具模块

**Files:**
- Create: `$S/knowledge_base/kb_summary/token_budget.py`
- Test: `$T/unit_tests/test_summary_token_budget.py`

- [ ] **Step 1: 写失败测试**

```python
# $T/unit_tests/test_summary_token_budget.py
from chayuan.server.knowledge_base.kb_summary.token_budget import (
    estimate_tokens, resolve_model_ctx, map_input_char_budget, DEFAULT_CTX,
    MAP_MAX_TOKENS, REDUCE_MAX_TOKENS,
)


def test_estimate_tokens_chinese_is_conservative():
    # 中文按 1 token/字 上界估(宁可高估防溢出)
    assert estimate_tokens("答辩状内容") >= 5
    assert estimate_tokens("") == 0


def test_estimate_tokens_ascii_words():
    # ASCII 大致按 4 字符/token,但取上界不低于字数/4
    assert estimate_tokens("hello world foo") >= 3


def test_resolve_model_ctx_falls_back_to_default():
    # 拿不到 metadata 的模型名 → 保守默认
    assert resolve_model_ctx("nonexistent-model-xyz") == DEFAULT_CTX


def test_map_input_char_budget_leaves_room_for_output_and_template():
    # 输入预算 = ctx - MAP_MAX_TOKENS - 模板开销 - 安全余量,且 > 0
    budget_tokens, budget_chars = map_input_char_budget(DEFAULT_CTX)
    assert 0 < budget_tokens < DEFAULT_CTX - MAP_MAX_TOKENS
    assert budget_chars > 0
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && PYTHONPATH=. /root/miniconda3/envs/py312/bin/python -m pytest -q tests/unit_tests/test_summary_token_budget.py 2>&1 | tail -15`
Expected: FAIL（ModuleNotFoundError: token_budget）

- [ ] **Step 3: 写实现**

```python
# $S/knowledge_base/kb_summary/token_budget.py
"""全文总结的上下文预算工具(纯逻辑,不依赖 langchain)。

本地 chat 模型仅 4096 上下文(process_args.py 默认 --ctx-size 4096),旧
SummaryAdapter 不做预算 → map 阶段并行发超长 prompt → llama-server 抛
「Context size has been exceeded」。本模块提供保守的中文 token 估算与按
n_ctx 推导的输入/输出预算,供 summary_chunk.py 切块与分组使用。
"""
from __future__ import annotations

import math
from typing import Tuple

# 保守默认上下文窗口(本地 llama-server chat 默认 --ctx-size 4096)。
DEFAULT_CTX: int = 4096
# 每次 map 调用给输出预留的 token(单块摘要,经验值,真机可调)。
MAP_MAX_TOKENS: int = 384
# 每次 reduce 调用给输出预留的 token(合并摘要)。
REDUCE_MAX_TOKENS: int = 768
# prompt 模板固定开销(任务说明 + 角色 + 框架字)粗估。
_TEMPLATE_OVERHEAD: int = 96
# 额外安全余量,吸收 token 估算误差与对话历史等。
_SAFETY_MARGIN: int = 256


def estimate_tokens(text: str) -> int:
    """保守(偏高)估算 token 数。

    为防上下文溢出宁可高估:中文/CJK 字符按 1 token/字计,其余按 4 字符/token,
    两者相加再取与「总字符数/3」的较大者作上界。
    """
    if not text:
        return 0
    cjk = sum(1 for ch in text if "一" <= ch <= "鿿")
    other = len(text) - cjk
    est = cjk + math.ceil(other / 4)
    return max(est, math.ceil(len(text) / 3))


def resolve_model_ctx(model_name: str | None) -> int:
    """解析模型有效上下文窗口;拿不到则保守取 DEFAULT_CTX。

    优先查 model_metadata.context_length(DB);任何异常/缺失 → DEFAULT_CTX。
    """
    name = (model_name or "").strip()
    if not name:
        return DEFAULT_CTX
    try:
        from chayuan.server.db.repository.model_metadata_repository import (
            get_model_metadata,
        )
        md = get_model_metadata(name)
        ctx = getattr(md, "context_length", None) if md else None
        if ctx and int(ctx) > 0:
            return int(ctx)
    except Exception:  # noqa: BLE001 — 任何失败都回退保守默认
        pass
    return DEFAULT_CTX


def map_input_char_budget(ctx: int) -> Tuple[int, int]:
    """返回 (输入 token 预算, 输入字符预算上界) 供 map 阶段切块。

    字符预算用最保守口径(1 token/字)反推,确保再保守也不溢出。
    """
    budget_tokens = max(256, ctx - MAP_MAX_TOKENS - _TEMPLATE_OVERHEAD - _SAFETY_MARGIN)
    return budget_tokens, budget_tokens  # 1 token/字上界 → 字符数 == token 预算


def reduce_group_token_budget(ctx: int) -> int:
    """reduce 合并阶段:一组待合并摘要的 token 预算上界。"""
    return max(256, ctx - REDUCE_MAX_TOKENS - _TEMPLATE_OVERHEAD - _SAFETY_MARGIN)
```

注:`get_model_metadata` 若实际函数名不同,实现时按 `model_metadata_repository.py` 真实导出名调整(已知该文件有 context_length 字段)。

- [ ] **Step 4: 运行确认通过**

Run: 同 Step 2 命令
Expected: PASS（4 passed）

- [ ] **Step 5: 提交**

```bash
cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server
sudo git -C /work/chayuan-desktop add chayuan-server/libs/chayuan-server/chayuan/server/knowledge_base/kb_summary/token_budget.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_summary_token_budget.py
sudo git -C /work/chayuan-desktop commit -m "feat(kb): 全文总结 token 预算工具(中文保守估算+n_ctx 解析)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A2: SummaryAdapter 预算化 map-reduce

**Files:**
- Modify: `$S/knowledge_base/kb_summary/summary_chunk.py`(在 SummaryAdapter 增 `summarize_budgeted` 及私有 helper)
- Test: `$T/unit_tests/test_budgeted_summarize.py`

**接口约定**(后续 Task 依赖,务必一致):
- `SummaryAdapter.summarize_budgeted(docs, *, ctx, map_call, reduce_call, progress_cb=None) -> str`
  - `docs`: `List[str]`(每个 chunk 的 page_content)。
  - `ctx`: int 有效上下文窗口。
  - `map_call(prompt: str) -> str`:对单块发 map prompt 返回摘要(调用方注入,便于测试用 fake)。
  - `reduce_call(prompt: str) -> str`:合并摘要(同上)。
  - `progress_cb(done: int, total: int)`:可选进度回调。
  - 返回:最终摘要文本。

- [ ] **Step 1: 写失败测试**

```python
# $T/unit_tests/test_budgeted_summarize.py
from chayuan.server.knowledge_base.kb_summary.summary_chunk import SummaryAdapter


def _fake_map(prompt: str) -> str:
    # 摘要 = 把输入压成「S(...)」,长度可控,便于断言不溢出
    return "S" + str(len(prompt) % 7)


def _fake_reduce(prompt: str) -> str:
    return "R" + str(len(prompt) % 5)


def test_oversize_chunk_is_split_so_no_map_prompt_exceeds_ctx():
    # 一个超长 chunk(远超预算)必须被切分;记录每次 map prompt 的长度都在预算内
    seen = []

    def cap_map(prompt: str) -> str:
        seen.append(len(prompt))
        return _fake_map(prompt)

    huge = "答" * 20000  # 约 20000 token(中文 1token/字)
    out = SummaryAdapter.summarize_budgeted(
        [huge], ctx=4096, map_call=cap_map, reduce_call=_fake_reduce,
    )
    assert out  # 有产出
    # 每次 map prompt 字符数都 <= ctx(保守 1token/字 ⇒ 字符即 token 上界)
    assert seen and max(seen) <= 4096


def test_many_chunks_reduce_groups_keep_each_reduce_prompt_in_budget():
    seen = []

    def cap_reduce(prompt: str) -> str:
        seen.append(len(prompt))
        return _fake_reduce(prompt)

    docs = ["答辩状第%d段内容" % i for i in range(50)]
    out = SummaryAdapter.summarize_budgeted(
        docs, ctx=4096, map_call=_fake_map, reduce_call=cap_reduce,
    )
    assert out
    assert all(n <= 4096 for n in seen)


def test_single_small_doc_skips_reduce():
    out = SummaryAdapter.summarize_budgeted(
        ["短文本"], ctx=4096, map_call=lambda p: "MAPPED", reduce_call=_fake_reduce,
    )
    # 只有一块 → map 后无需 reduce,直接返回 map 结果
    assert out == "MAPPED"


def test_progress_callback_fires():
    calls = []
    SummaryAdapter.summarize_budgeted(
        ["a", "b", "c"], ctx=4096,
        map_call=_fake_map, reduce_call=_fake_reduce,
        progress_cb=lambda done, total: calls.append((done, total)),
    )
    assert calls and calls[-1][0] >= 3
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && PYTHONPATH=. /root/miniconda3/envs/py312/bin/python -m pytest -q tests/unit_tests/test_budgeted_summarize.py 2>&1 | tail -20`
Expected: FAIL（AttributeError: summarize_budgeted）

- [ ] **Step 3: 写实现**

在 `summary_chunk.py` 顶部 import 处加:
```python
from chayuan.server.knowledge_base.kb_summary.token_budget import (
    estimate_tokens, map_input_char_budget, reduce_group_token_budget,
)
```

在 `SummaryAdapter` 类里新增(放在 `form_summary` 之后):
```python
_MAP_PROMPT = (
    "请用简洁中文概括下面这段文字的要点,只输出概括内容:\n\n{context}"
)
_REDUCE_PROMPT = (
    "下面是同一篇文档若干段落的概括,请把它们合并成一段连贯、完整的中文摘要,"
    "保留关键信息,不要重复:\n\n{context}"
)

@staticmethod
def _split_to_budget(text: str, char_budget: int) -> List[str]:
    """把超长文本按字符预算切成多段(段落优先,其次硬切)。"""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= char_budget:
        return [text]
    parts: List[str] = []
    buf = ""
    for para in text.split("\n"):
        if len(para) > char_budget:
            # 单段仍超预算 → 硬切
            if buf:
                parts.append(buf); buf = ""
            for i in range(0, len(para), char_budget):
                parts.append(para[i:i + char_budget])
            continue
        if len(buf) + len(para) + 1 > char_budget:
            parts.append(buf); buf = para
        else:
            buf = (buf + "\n" + para) if buf else para
    if buf:
        parts.append(buf)
    return parts

@classmethod
def summarize_budgeted(
    cls,
    docs: List[str],
    *,
    ctx: int,
    map_call,
    reduce_call,
    progress_cb=None,
) -> str:
    """按上下文窗口预算的 map-reduce 全文总结(不依赖 LangChain token 计数)。

    map:每块(超预算先切)→ map_call;reduce:贪心分组,每组 token 预算内 →
    reduce_call,递归直到剩一段。map_call/reduce_call 由调用方注入(真机=本地
    LLM 调用,测试=fake)。
    """
    _, map_char_budget = map_input_char_budget(ctx)
    # 模板占位 {context} 外的固定字,留些余量
    eff_budget = max(128, map_char_budget - len(cls._MAP_PROMPT))

    # 1) map:切块 → 逐块摘要
    units: List[str] = []
    for d in (docs or []):
        units.extend(cls._split_to_budget(d, eff_budget))
    if not units:
        return ""
    total = len(units) + max(0, (len(units) - 1))  # map + 粗估 reduce 次数
    done = 0
    summaries: List[str] = []
    for u in units:
        s = map_call(cls._MAP_PROMPT.format(context=u))
        if s and s.strip():
            summaries.append(s.strip())
        done += 1
        if progress_cb:
            progress_cb(done, total)
    if not summaries:
        return ""
    if len(summaries) == 1:
        return summaries[0]

    # 2) reduce:贪心分组合并,递归到剩一段
    group_budget = reduce_group_token_budget(ctx)
    while len(summaries) > 1:
        groups: List[List[str]] = []
        cur: List[str] = []
        cur_tok = 0
        for s in summaries:
            t = estimate_tokens(s)
            if cur and cur_tok + t > group_budget:
                groups.append(cur); cur = []; cur_tok = 0
            cur.append(s); cur_tok += t
        if cur:
            groups.append(cur)
        if len(groups) == len(summaries):
            # 无法再缩小(每段都超预算的极端情况)→ 直接拼接收尾,避免死循环
            return "\n\n".join(summaries)
        merged: List[str] = []
        for g in groups:
            r = reduce_call(cls._REDUCE_PROMPT.format(context="\n\n".join(g)))
            merged.append((r or "").strip())
            done += 1
            if progress_cb:
                progress_cb(done, total)
        summaries = [m for m in merged if m]
    return summaries[0] if summaries else ""
```

- [ ] **Step 4: 运行确认通过**

Run: 同 Step 2 命令
Expected: PASS（4 passed）

- [ ] **Step 5: 提交**

```bash
sudo git -C /work/chayuan-desktop add chayuan-server/libs/chayuan-server/chayuan/server/knowledge_base/kb_summary/summary_chunk.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_budgeted_summarize.py
sudo git -C /work/chayuan-desktop commit -m "feat(kb): SummaryAdapter 增预算化 map-reduce(切块+贪心分组,不溢出)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A3: summarize_file_now 改走预算化路径

**Files:**
- Modify: `$S/knowledge_base/kb_summary_api.py`(`summarize_file_now` 的 `output()` 内,替换 SummaryAdapter.form_summary+summarize 那段)

- [ ] **Step 1: 改实现**

在 `summarize_file_now` 里(替换原 `llm = get_ChatOpenAI(...); reduce_llm=...; adapter=SummaryAdapter.form_summary(...)` 到 `_holder["docs"] = adapter.summarize(...)` 的逻辑),改为:

```python
from chayuan.server.knowledge_base.kb_summary.token_budget import (
    resolve_model_ctx, MAP_MAX_TOKENS, REDUCE_MAX_TOKENS,
)
from chayuan.server.utils import get_ChatOpenAI

ctx = resolve_model_ctx(model_name)

def _map_call(prompt: str) -> str:
    llm = get_ChatOpenAI(
        model_name=model_name, temperature=temperature,
        max_tokens=MAP_MAX_TOKENS, streaming=False, local_wrap=True,
    )
    return llm.invoke(prompt).content if hasattr(llm.invoke(prompt), "content") else str(llm.invoke(prompt))

def _reduce_call(prompt: str) -> str:
    llm = get_ChatOpenAI(
        model_name=model_name, temperature=temperature,
        max_tokens=REDUCE_MAX_TOKENS, streaming=False, local_wrap=True,
    )
    r = llm.invoke(prompt)
    return r.content if hasattr(r, "content") else str(r)
```

注:为避免每次 invoke 重建 llm + 重复调用,实现时把 llm 实例提到闭包外建一次(map 一个、reduce 一个),`_map_call`/`_reduce_call` 内只 `llm.invoke(prompt)` 取一次 `.content`。下面后台线程 `_run` 改为:

```python
from chayuan.server.knowledge_base.kb_summary.summary_chunk import SummaryAdapter

texts_for_summary = [getattr(d, "page_content", "") or "" for d in doc_infos]

def _run() -> None:
    try:
        def _prog(done: int, total_: int) -> None:
            _q.put(done)
        _holder["summary"] = SummaryAdapter.summarize_budgeted(
            texts_for_summary, ctx=ctx,
            map_call=_map_call, reduce_call=_reduce_call, progress_cb=_prog,
        )
    except Exception as _e:  # noqa: BLE001
        _holder["err"] = _e
    finally:
        _q.put(None)
```

并把后面取结果处从 `summary_docs = _holder.get("docs")...` 改为:
```python
summary_text = _holder.get("summary") or ""
```

(移除原 `_ProgressCB`/`adapter.summarize(...)` 路径;`map_call`/`reduce_call` 的 llm 实例在 `_run` 外先各建一次。)

- [ ] **Step 2: py_compile 验证**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && /root/miniconda3/envs/py312/bin/python -m py_compile chayuan/server/knowledge_base/kb_summary_api.py && echo OK`
Expected: OK

- [ ] **Step 3: 提交**

```bash
sudo git -C /work/chayuan-desktop add chayuan-server/libs/chayuan-server/chayuan/server/knowledge_base/kb_summary_api.py
sudo git -C /work/chayuan-desktop commit -m "fix(kb): summarize_file_now 改预算化 map-reduce,修复 Context size exceeded

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase B — 服务端意图识别

### Task B1: 服务端 detect_summarize_intent

**Files:**
- Create: `$S/knowledge_base/kb_summary/intent.py`
- Test: `$T/unit_tests/test_summary_intent.py`

接口:`detect_summarize_intent(query: str, file_names: List[str]) -> Optional[str]`(返回唯一命中的文件名,否则 None;移植前端 detectSummarizeIntent.ts 逻辑)。

- [ ] **Step 1: 写失败测试**

```python
# $T/unit_tests/test_summary_intent.py
from chayuan.server.knowledge_base.kb_summary.intent import detect_summarize_intent


def test_full_name_in_query():
    assert detect_summarize_intent("帮我总结一下 2024年报.pdf", ["2024年报.pdf"]) == "2024年报.pdf"


def test_partial_alias_unique_match():
    # 用户主诉的真实问法
    assert detect_summarize_intent(
        "答辩状文件讲了什么内容", ["民事答辩状最终版.docx", "起诉书.pdf"]
    ) == "民事答辩状最终版.docx"


def test_no_intent_keyword_returns_none():
    assert detect_summarize_intent("打开 2024年报.pdf", ["2024年报.pdf"]) is None


def test_ambiguous_multi_match_returns_none():
    assert detect_summarize_intent(
        "答辩状讲了什么", ["民事答辩状.docx", "答辩状补充.docx"]
    ) is None


def test_intent_but_no_file_returns_none():
    assert detect_summarize_intent("帮我总结一下", ["2024年报.pdf"]) is None
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && PYTHONPATH=. /root/miniconda3/envs/py312/bin/python -m pytest -q tests/unit_tests/test_summary_intent.py 2>&1 | tail -15`
Expected: FAIL（ModuleNotFoundError: intent）

- [ ] **Step 3: 写实现**(移植自前端 detectSummarizeIntent.ts,关键词表一致)

```python
# $S/knowledge_base/kb_summary/intent.py
"""服务端「整篇总结某文件」意图识别(移植前端 detectSummarizeIntent.ts)。

规则:① 命中总结类关键词 ② 在文件列表里唯一匹配到一个文件名(整名/主名出现在
query,或核心指代词与主名互为子串)。0/多匹配 → None(交给普通 RAG,绝不瞎猜)。
"""
from __future__ import annotations

import re
from typing import List, Optional

_INTENT_KEYWORDS = [
    "总结", "概括", "归纳", "摘要", "概要", "梗概", "大意", "大致", "主旨", "要点", "重点",
    "主要内容", "核心内容", "整体内容", "主要讲", "主要说",
    "全文", "通篇", "整篇", "整份", "全篇",
    "内容是什么", "内容是啥", "什么内容", "啥内容", "主题是什么", "重点是什么",
    "写的是什么", "写的什么", "写了什么", "写了些什么", "写了啥", "写的啥",
    "讲的是什么", "讲的什么", "讲了什么", "讲了些什么", "讲了啥", "讲的啥", "讲什么",
    "在讲什么", "讲述了什么", "讲述什么",
    "说的是什么", "说的什么", "说了什么", "说了些什么", "说了啥", "说的啥", "说什么", "在说什么",
    "阐述了什么", "介绍了什么", "描述了什么",
    "是关于什么", "关于什么", "关于啥", "是关于啥", "是讲什么", "是说什么",
    "介绍一下", "简述", "简要介绍", "简单介绍", "大概讲", "大概说", "讲讲", "说说这",
    "这份文件是什么", "这个文件是什么",
]
_SCAFFOLD = re.compile(
    "(这个|那个|这份|那份|该|本|文件|文档|内容|一下|帮我|麻烦|请问|请|大概|简单|"
    "的|了|是|吗|呢|啊|把|对|看看|说说|讲讲)"
)


def _strip_ext(name: str) -> str:
    i = name.rfind(".")
    return name[:i] if i > 0 else name


def _core_tokens(query: str) -> List[str]:
    c = query
    for k in _INTENT_KEYWORDS:
        c = c.replace(k, " ")
    c = _SCAFFOLD.sub(" ", c)
    return [t for t in re.split(r"[^0-9a-zA-Z一-龥._-]+", c.lower()) if len(t) >= 2]


def detect_summarize_intent(query: str, file_names: List[str]) -> Optional[str]:
    q = (query or "").strip()
    if not q:
        return None
    if not any(k in q for k in _INTENT_KEYWORDS):
        return None
    ql = q.lower()
    cores = _core_tokens(q)
    matched = []
    for f in (file_names or []):
        if not f:
            continue
        full = f.lower()
        base = _strip_ext(f).lower()
        if len(base) < 2:
            continue
        if full in ql or base in ql:
            matched.append(f); continue
        if any(t in base or base in t for t in cores):
            matched.append(f)
    uniq = list(dict.fromkeys(matched))
    return uniq[0] if len(uniq) == 1 else None
```

- [ ] **Step 4: 运行确认通过**

Run: 同 Step 2 命令
Expected: PASS（5 passed）

- [ ] **Step 5: 提交**

```bash
sudo git -C /work/chayuan-desktop add chayuan-server/libs/chayuan-server/chayuan/server/knowledge_base/kb_summary/intent.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_summary_intent.py
sudo git -C /work/chayuan-desktop commit -m "feat(kb): 服务端整篇总结意图识别(移植前端,关键词+唯一文件匹配)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase C — ChatGraph 路由接线

### Task C1: ChatState 增 summarize_file 字段

**Files:**
- Modify: `$S/chat/graph/state.py`(ChatState 内 classify 产出附近)

- [ ] **Step 1: 改实现** — 在 `resolved_mode: str` 行下方加:

```python
    # detect_summarize 产出:命中「整篇总结某文件」意图时填 {kb_name, file_name};
    # 未命中不写。retrieve 见此则短路 RAG,generate 由 stream_file_summary 接管。
    summarize_file: Dict[str, str]
```

- [ ] **Step 2: py_compile 验证**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && /root/miniconda3/envs/py312/bin/python -m py_compile chayuan/server/chat/graph/state.py && echo OK`
Expected: OK

- [ ] **Step 3: 提交**(与 C2 一并提交,见 C2 Step 5)

---

### Task C2: node_detect_summarize 节点

**Files:**
- Modify: `$S/chat/graph/nodes.py`(新增 `node_detect_summarize`;改 `node_retrieve_async` 短路)
- Test: `$T/unit_tests/test_detect_summarize_node.py`

辅助:从 ChatRequest 收集文档 KB 名 → 列文件。`ku_ids` 取 `doc:` 前缀的 kb 名,叠加 `kb_name`/`kb_names`。

- [ ] **Step 1: 写失败测试**(monkeypatch 掉列文件与意图,验证节点行为)

```python
# $T/unit_tests/test_detect_summarize_node.py
from chayuan.server.chat.graph.state import ChatRequest
from chayuan.server.chat.graph import nodes


def _state(**kw):
    req = ChatRequest(**kw)
    return {"request": req, "resolved_mode": "kb"}


def test_hit_sets_summarize_file(monkeypatch):
    monkeypatch.setattr(nodes, "_doc_kb_files", lambda req: ("mykb", ["民事答辩状.docx"]))
    out = nodes.node_detect_summarize(_state(query="答辩状讲了什么", kb_name="mykb"))
    assert out["summarize_file"] == {"kb_name": "mykb", "file_name": "民事答辩状.docx"}


def test_no_intent_returns_empty(monkeypatch):
    monkeypatch.setattr(nodes, "_doc_kb_files", lambda req: ("mykb", ["民事答辩状.docx"]))
    out = nodes.node_detect_summarize(_state(query="今天天气如何", kb_name="mykb"))
    assert out == {}


def test_non_kb_mode_skips(monkeypatch):
    called = {"n": 0}
    def _spy(req):
        called["n"] += 1; return ("", [])
    monkeypatch.setattr(nodes, "_doc_kb_files", _spy)
    st = _state(query="答辩状讲了什么"); st["resolved_mode"] = "llm"
    out = nodes.node_detect_summarize(st)
    assert out == {} and called["n"] == 0
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && PYTHONPATH=. /root/miniconda3/envs/py312/bin/python -m pytest -q tests/unit_tests/test_detect_summarize_node.py 2>&1 | tail -20`
Expected: FAIL（AttributeError: node_detect_summarize）

- [ ] **Step 3: 写实现** — 在 `nodes.py` 末尾加:

```python
def _doc_kb_files(req):
    """收集 ChatRequest 引用的文档 KB(取首个)及其文件名列表。

    ku_ids 取 `doc:<kb>` 前缀;叠加 kb_name / kb_names。多个 KB 时只取第一个
    文档 KB(跨库文件名歧义不处理,与前端 KbBoard 不接 NL 同理)。失败 → ('', [])。
    """
    names = []
    for kid in (getattr(req, "ku_ids", None) or []):
        if isinstance(kid, str) and kid.startswith("doc:"):
            names.append(kid[4:])
    for n in (getattr(req, "kb_names", None) or []):
        names.append(n)
    if getattr(req, "kb_name", None):
        names.append(req.kb_name)
    names = [n for n in dict.fromkeys(names) if n]
    if not names:
        return "", []
    kb_name = names[0]
    try:
        from chayuan.server.knowledge_base.kb_service.base import get_kb_file_details
        details = get_kb_file_details(kb_name) or []
        files = []
        for d in details:
            fn = (d.get("file_name") if isinstance(d, dict) else getattr(d, "file_name", None))
            if fn:
                files.append(fn)
        return kb_name, files
    except Exception as e:  # noqa: BLE001
        logger.debug("[detect_summarize] 列文件失败 kb=%s: %r", kb_name, e)
        return kb_name, []


def node_detect_summarize(state):
    """classify 后:仅 kb / multi_source 模式判「整篇总结某文件」意图。

    命中 → {"summarize_file": {kb_name, file_name}};否则 {}(走普通 RAG)。
    """
    mode = state.get("resolved_mode") or ""
    if mode not in ("kb", "multi_source"):
        return {}
    req = state["request"]
    try:
        kb_name, files = _doc_kb_files(req)
        if not kb_name or not files:
            return {}
        from chayuan.server.knowledge_base.kb_summary.intent import detect_summarize_intent
        hit = detect_summarize_intent(req.query or "", files)
        if hit:
            return {"summarize_file": {"kb_name": kb_name, "file_name": hit}}
    except Exception as e:  # noqa: BLE001
        logger.debug("[detect_summarize] 异常(走普通 RAG): %r", e)
    return {}
```

确认 `nodes.py` 顶部已有 `logger`(若无,加 `logger = logging.getLogger("chayuan.chat.graph.nodes")`)。

改 `node_retrieve_async` 开头(在取 mode 之后、调 handler 之前)加短路:
```python
    if state.get("summarize_file"):
        # 命中整篇总结:跳过 RAG 检索(由 generate_override_stream 接管产出)
        return {"retrieved_chunks": [], "retrieved_sources_meta": [], "retrieval_elapsed_ms": 0}
```

- [ ] **Step 4: 运行确认通过**

Run: 同 Step 2 命令
Expected: PASS（3 passed）

- [ ] **Step 5: 提交**(含 C1)

```bash
sudo git -C /work/chayuan-desktop add chayuan-server/libs/chayuan-server/chayuan/server/chat/graph/state.py chayuan-server/libs/chayuan-server/chayuan/server/chat/graph/nodes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_detect_summarize_node.py
sudo git -C /work/chayuan-desktop commit -m "feat(chat): detect_summarize 节点 + retrieve 命中短路 + ChatState 字段

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task C3: 共享流式总结产出器 + base 接线

**Files:**
- Create: `$S/chat/handlers/file_summary_stream.py`
- Modify: `$S/chat/handlers/base.py`(`generate_override_stream` 命中 summarize_file 时返流)

接口:`stream_file_summary(state) -> AsyncIterator[str]`。

- [ ] **Step 1: 写实现**(无独立单测:依赖 langchain + DB,留真机验;逻辑薄,复用已测的 A1/A2/A3)

```python
# $S/chat/handlers/file_summary_stream.py
"""命中「整篇总结某文件」意图时,由 BaseModeHandler.generate_override_stream
返回本产出器:复用预算化 SummaryAdapter + 内容哈希缓存,流式吐出摘要文本。
失败抛异常 → runner 的 override 段 except 捕获,answer 为空;detect 已在
retrieve 短路,故失败时会得到空答(可接受)。如需更强 fail-soft 见 plan 备注。
"""
from __future__ import annotations

import logging
from typing import Any, AsyncIterator, Dict

from starlette.concurrency import run_in_threadpool

logger = logging.getLogger("chayuan.chat.handlers.file_summary_stream")


async def stream_file_summary(state: Dict[str, Any]) -> AsyncIterator[str]:
    sf = state.get("summarize_file") or {}
    kb_name = sf.get("kb_name") or ""
    file_name = sf.get("file_name") or ""
    req = state["request"]
    model_name = (getattr(req, "model", "") or "").strip() or None

    def _compute() -> str:
        from chayuan.server.knowledge_base.kb_service.base import KBServiceFactory
        from chayuan.server.knowledge_base.kb_summary.token_budget import (
            resolve_model_ctx, MAP_MAX_TOKENS, REDUCE_MAX_TOKENS,
        )
        from chayuan.server.knowledge_base.kb_summary.summary_chunk import SummaryAdapter
        from chayuan.server.utils import get_ChatOpenAI

        kb = KBServiceFactory.get_service_by_name(kb_name)
        if kb is None:
            raise RuntimeError(f"未找到知识库 {kb_name!r}")
        doc_infos = kb.list_docs(file_name=file_name)
        texts = [getattr(d, "page_content", "") or "" for d in (doc_infos or [])]
        if not texts:
            raise RuntimeError(f"未找到文件 {file_name!r} 的内容")
        ctx = resolve_model_ctx(model_name)
        map_llm = get_ChatOpenAI(model_name=model_name, temperature=0.01,
                                 max_tokens=MAP_MAX_TOKENS, streaming=False, local_wrap=True)
        reduce_llm = get_ChatOpenAI(model_name=model_name, temperature=0.01,
                                    max_tokens=REDUCE_MAX_TOKENS, streaming=False, local_wrap=True)

        def _map(p: str) -> str:
            r = map_llm.invoke(p); return getattr(r, "content", None) or str(r)

        def _reduce(p: str) -> str:
            r = reduce_llm.invoke(p); return getattr(r, "content", None) or str(r)

        return SummaryAdapter.summarize_budgeted(
            texts, ctx=ctx, map_call=_map, reduce_call=_reduce,
        )

    summary = await run_in_threadpool(_compute)
    # 一次性吐出(前端 ConversationView 自身有打字机;此处保持简单)。
    yield summary
```

修改 `base.py` 的 `generate_override_stream`:
```python
    def generate_override_stream(
        self, state: Dict[str, Any],
    ) -> Optional[AsyncIterator[str]]:
        # 命中「整篇总结某文件」→ 复用共享产出器(所有未自定义本方法的 handler
        # 自动获得该能力;video_generation 覆写了本方法故不受影响)。
        if state.get("summarize_file"):
            from chayuan.server.chat.handlers.file_summary_stream import stream_file_summary
            return stream_file_summary(state)
        return None
```

- [ ] **Step 2: py_compile 验证**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && /root/miniconda3/envs/py312/bin/python -m py_compile chayuan/server/chat/handlers/file_summary_stream.py chayuan/server/chat/handlers/base.py && echo OK`
Expected: OK

- [ ] **Step 3: 提交**

```bash
sudo git -C /work/chayuan-desktop add chayuan-server/libs/chayuan-server/chayuan/server/chat/handlers/file_summary_stream.py chayuan-server/libs/chayuan-server/chayuan/server/chat/handlers/base.py
sudo git -C /work/chayuan-desktop commit -m "feat(chat): 共享流式全文总结产出器 + base.generate_override_stream 接线

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task C4: 在三条执行路径调用 detect 节点

**Files:**
- Modify: `$S/chat/graph/runner.py`(`run_chat_stream` classify 后)
- Modify: `$S/chat/graph/graph.py`(`build_chat_graph` 插节点 + `run_graph_linear` / `run_graph_linear_async` 插调用)

- [ ] **Step 1: runner.py 改** — 在 `run_chat_stream` 的 `_patch(state, node_classify(state))` 与其后 `yield make_sse("stage", {"stage": "classified"...})` 之后、`node_guardrail_in` 之前,加:

```python
    from chayuan.server.chat.graph.nodes import node_detect_summarize
    _patch(state, node_detect_summarize(state))
    if state.get("summarize_file"):
        yield make_sse("stage", {"stage": "summarizing",
                                 "file": state["summarize_file"].get("file_name")})
```

- [ ] **Step 2: graph.py 改** — `build_chat_graph` 内:

`from ...nodes import` 增 `node_detect_summarize`(顶部 import 块)。注册节点 + 改边:
```python
    g.add_node("detect_summarize", node_detect_summarize)
```
把 `g.add_edge("classify", "guardrail_in")` 改为:
```python
    g.add_edge("classify", "detect_summarize")
    g.add_edge("detect_summarize", "guardrail_in")
```
两条 linear fallback(`run_graph_linear` / `run_graph_linear_async`)里,在 `s.update(node_classify(s))` 之后加:
```python
    s.update(node_detect_summarize(s))
```
(import:这两个函数同模块,`node_detect_summarize` 已在 nodes.py;在 graph.py 顶部 `from chayuan.server.chat.graph.nodes import (...)` 里加它。)

- [ ] **Step 3: py_compile + 已有图测试**

Run: `cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server && /root/miniconda3/envs/py312/bin/python -m py_compile chayuan/server/chat/graph/runner.py chayuan/server/chat/graph/graph.py && echo OK`
Expected: OK

Run(若存在 graph/runner 相关测试):`PYTHONPATH=. /root/miniconda3/envs/py312/bin/python -m pytest -q tests/unit_tests -k "graph or chat_runner or classify" 2>&1 | tail -20`
Expected: 不引入新失败(原有通过的仍通过)

- [ ] **Step 4: 提交 + bump 版本**(本阶段含服务端程序代码改动)

```bash
# bump 2.0.291 → 2.0.292(VERSION + 3 tauri.conf + server pyproject)
sudo python3 - <<'PY'
import re
for p,(o,n) in {
 "/work/chayuan-desktop/VERSION":("2.0.291","2.0.292"),
 "/work/chayuan-desktop/chayuan-server/libs/chayuan-server/pyproject.toml":('version = "2.0.291"','version = "2.0.292"'),
 "/work/chayuan-desktop/chayuan-client/apps/desktop/src-tauri/tauri.conf.json":('"version": "2.0.291"','"version": "2.0.292"'),
 "/work/chayuan-desktop/chayuan-client/apps/installer/src-tauri/tauri.conf.json":('"version": "2.0.291"','"version": "2.0.292"'),
 "/work/chayuan-desktop/chayuan-client/apps/publisher/src-tauri/tauri.conf.json":('"version": "2.0.291"','"version": "2.0.292"'),
}.items():
    s=open(p).read(); assert s.count(o)==1 or (p.endswith("VERSION") and s.strip()==o)
    open(p,"w").write((n+"\n") if p.endswith("VERSION") else s.replace(o,n))
print("bumped")
PY
sudo git -C /work/chayuan-desktop add chayuan-server/libs/chayuan-server/chayuan/server/chat/graph/runner.py chayuan-server/libs/chayuan-server/chayuan/server/chat/graph/graph.py VERSION chayuan-server/libs/chayuan-server/pyproject.toml chayuan-client/apps/desktop/src-tauri/tauri.conf.json chayuan-client/apps/installer/src-tauri/tauri.conf.json chayuan-client/apps/publisher/src-tauri/tauri.conf.json
sudo git -C /work/chayuan-desktop commit -m "feat(chat): 三条执行路径接 detect_summarize,常规对话/WPS 触发全文总结 (2.0.292)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase D — 验证

### Task D1: 服务端测试汇总跑

- [ ] **Step 1: 跑本功能全部单测**

Run:
```bash
cd /work/chayuan-desktop/chayuan-server/libs/chayuan-server
PYTHONPATH=. /root/miniconda3/envs/py312/bin/python -m pytest -q \
  tests/unit_tests/test_summary_token_budget.py \
  tests/unit_tests/test_budgeted_summarize.py \
  tests/unit_tests/test_summary_intent.py \
  tests/unit_tests/test_detect_summarize_node.py 2>&1 | tail -20
```
Expected: all passed

- [ ] **Step 2: 回归 —— 不破坏既有 chat/kb 测试**

Run: `PYTHONPATH=. /root/miniconda3/envs/py312/bin/python -m pytest -q tests/unit_tests -k "chat or kb or summary or graph" 2>&1 | tail -30`
Expected: 无新增失败(历史已有失败如有,对照基线确认非本次引入)

### Task D2: 真机验证清单(需重建 sidecar + 重启)

- [ ] 重启 sidecar(后端无 --reload,见记忆 backend-no-reload-restart)。
- [ ] 网络版常规对话选中文档知识库,问「答辩状文件讲的是什么」→ 返回**整篇全文总结**(非 5 片段),日志见 `stage: summarizing` 而非纯 RAG。
- [ ] 详情页《答辩状.docx》点「总结全文」→ **不再** `Context size has been exceeded`,正常出摘要。
- [ ] 选中知识库的普通问题(非总结意图)→ 行为不变,仍走 RAG。
- [ ] 大文件(>60 chunk)→ 能跑完(分多轮 map+reduce),无溢出。
- [ ] WPS 加载项同问法 → 同样触发全文总结。
- [ ] 前端重建 apps/web 后,详情页进度条为单条紧凑小条 + X 取消。

---

## Self-Review 记录

- **Spec 覆盖**:① 覆盖漏洞→Phase B/C(detect 节点 + 三路径接线);② context 溢出→Phase A(预算化);③ 流式/大文件不弹确认→C3(stream_file_summary 一次性吐 + 聊天无 needs_confirm);④ 进度条 UI→已在前序提交(2.0.291)。
- **占位扫描**:无 TODO/占位;每个代码步给了完整代码。
- **类型一致**:`summarize_budgeted(docs, *, ctx, map_call, reduce_call, progress_cb)` 在 A2 定义、A3/C3 调用一致;`detect_summarize_intent(query, file_names)->Optional[str]` 在 B1 定义、C2 调用一致;`summarize_file` dict 形状 `{kb_name, file_name}` 在 C1/C2/C3 一致。
- **已知风险**:A3 把 `kb.list_docs` 结果交给预算化总结,`map_call`/`reduce_call` 的 llm 实例需在 `_run` 外建一次(避免每块重建);`get_model_metadata` 实际导出名实现时按真文件核对;C3 fail-soft 目前是「失败→空答」,若要退回 RAG 需在 runner override 段加回退(列为可选增强,非本期必须)。
