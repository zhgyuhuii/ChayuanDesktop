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
    # 100 个小 chunk 应被合并成极少数 map 调用(而不是 100 次),性能修复核心。
    calls = []

    def cap_map(prompt: str) -> str:
        calls.append(prompt)
        return "S"

    docs = ["答辩状片段%d" % i for i in range(100)]
    out = summarize_budgeted(docs, ctx=4096, map_call=cap_map, reduce_call=lambda p: "R")
    assert out
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


def test_single_small_doc_skips_reduce():
    out = summarize_budgeted(
        ["短文本"], ctx=4096, map_call=lambda p: "MAPPED", reduce_call=_fake_reduce,
    )
    assert out == "MAPPED"


def test_progress_callback_fires():
    calls = []
    summarize_budgeted(
        ["a", "b", "c"], ctx=4096,
        map_call=_fake_map, reduce_call=_fake_reduce,
        progress_cb=lambda done, total: calls.append((done, total)),
    )
    assert calls and calls[-1][0] >= 1
