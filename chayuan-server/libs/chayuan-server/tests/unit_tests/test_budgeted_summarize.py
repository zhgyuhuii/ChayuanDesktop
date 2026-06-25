from chayuan.server.knowledge_base.kb_summary.budgeted_reduce import summarize_budgeted


def _fake_map(prompt: str) -> str:
    return "S" + str(len(prompt) % 7)


def _fake_reduce(prompt: str) -> str:
    return "R" + str(len(prompt) % 5)


def test_oversize_chunk_is_split_so_no_map_prompt_exceeds_ctx():
    seen = []

    def cap_map(prompt: str) -> str:
        seen.append(len(prompt))
        return _fake_map(prompt)

    huge = "答" * 20000
    out = summarize_budgeted(
        [huge], ctx=4096, map_call=cap_map, reduce_call=_fake_reduce,
    )
    assert out
    assert seen and max(seen) <= 4096


def test_small_chunks_are_repacked_into_few_map_calls():
    # 整篇超过单次预算(强制走 map-reduce)时,大量小 chunk 应被合并成极少数 map
    # 调用(而不是逐块各调一次),这是 map-reduce 路径的性能修复核心。
    calls = []

    def cap_map(prompt: str) -> str:
        calls.append(prompt)
        return "S"

    # 100 块、整篇 4000 CJK token 远超 ctx=4096 的单次预算 → 走 map-reduce
    docs = ["答" * 40 for _ in range(100)]
    out = summarize_budgeted(docs, ctx=4096, map_call=cap_map, reduce_call=lambda p: "R")
    assert out
    assert calls, "应触发 map 阶段"
    assert len(calls) < 10


def test_many_large_chunks_reduce_groups_keep_each_reduce_prompt_in_budget():
    # 大块 + 大 map 摘要 → 触发 reduce 分组;每次 reduce prompt 不超 ctx。
    seen = []

    def big_map(prompt: str) -> str:
        return "概要" * 250

    def cap_reduce(prompt: str) -> str:
        seen.append(len(prompt))
        return "概要" * 100

    docs = ["答" * 2500 for _ in range(12)]
    out = summarize_budgeted(
        docs, ctx=4096, map_call=big_map, reduce_call=cap_reduce,
    )
    assert out
    assert seen
    assert all(n <= 4096 for n in seen)


def test_single_pass_when_doc_fits_uses_one_reduce_call_no_map():
    # 整篇能塞进 ctx(云端大 ctx 模型几乎总是如此)→ 单次整篇快路径:只调一次
    # reduce_call(整篇 prompt),完全不走 map,避免多次 map-reduce 往返(慢的根因)。
    map_calls = []
    reduce_calls = []

    def cap_map(p: str) -> str:
        map_calls.append(p)
        return "MAP"

    def cap_reduce(p: str) -> str:
        reduce_calls.append(p)
        return "FULL_SUMMARY"

    out = summarize_budgeted(
        ["这是一段短文本。"], ctx=4096, map_call=cap_map, reduce_call=cap_reduce,
    )
    assert out == "FULL_SUMMARY"
    assert map_calls == [], "单次整篇路径不应调用 map"
    assert len(reduce_calls) == 1, "单次整篇路径只调一次 reduce"


def test_single_pass_large_ctx_fits_whole_doc():
    # 云端大 ctx(如 64K):即便文档不小,整篇也能一次塞下 → 1 次调用。
    calls = []

    def cap_reduce(p: str) -> str:
        calls.append(p)
        return "OK"

    docs = ["答" * 2500 for _ in range(12)]  # 30000 CJK token,4096 装不下但 64000 装得下
    out = summarize_budgeted(
        docs, ctx=64000, map_call=lambda p: "M", reduce_call=cap_reduce,
    )
    assert out == "OK"
    assert len(calls) == 1


def test_progress_callback_fires_single_pass():
    calls = []
    summarize_budgeted(
        ["a", "b", "c"], ctx=4096,
        map_call=_fake_map, reduce_call=_fake_reduce,
        progress_cb=lambda done, total: calls.append((done, total)),
    )
    # 单次整篇路径也要报进度:(0,1) → (1,1)
    assert calls and calls[-1] == (1, 1)


def test_progress_callback_fires_map_reduce():
    # 强制走 map-reduce(整篇超 ctx),进度回调仍触发且最终 done>=1。
    calls = []
    docs = ["答" * 40 for _ in range(100)]
    summarize_budgeted(
        docs, ctx=4096,
        map_call=_fake_map, reduce_call=_fake_reduce,
        progress_cb=lambda done, total: calls.append((done, total)),
    )
    assert calls and calls[-1][0] >= 1
