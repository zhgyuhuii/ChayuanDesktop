from chayuan.server.knowledge_base.kb_summary.summary_chunk import SummaryAdapter


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
    out = SummaryAdapter.summarize_budgeted(
        [huge], ctx=4096, map_call=cap_map, reduce_call=_fake_reduce,
    )
    assert out
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
    assert out == "MAPPED"


def test_progress_callback_fires():
    calls = []
    SummaryAdapter.summarize_budgeted(
        ["a", "b", "c"], ctx=4096,
        map_call=_fake_map, reduce_call=_fake_reduce,
        progress_cb=lambda done, total: calls.append((done, total)),
    )
    assert calls and calls[-1][0] >= 3
