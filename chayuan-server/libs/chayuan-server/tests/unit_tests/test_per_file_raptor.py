from chayuan.server.knowledge_base.kb_summary.per_file_raptor import (
    summarize_file_hierarchical,
)


def _fake_embed(texts):
    return [[float(len(t))] for t in texts]


def _fake_cluster_two(vectors, target_cluster_size=5):
    n = len(vectors)
    labels = [0 if i < n // 2 else 1 for i in range(n)]
    return labels, (2 if n >= 2 else 1)


def _fake_cluster_converged(vectors, target_cluster_size=5):
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
    assert calls == ["only one"]


def test_hierarchical_recurses_then_reduces_to_root():
    def summ(text):
        return "SUM(" + text.replace("\n\n", "|") + ")"
    out = summarize_file_hierarchical(
        ["a", "b", "c", "d"], embed_fn=_fake_embed,
        cluster_fn=_fake_cluster_two, summarize_fn=summ,
        target_cluster_size=1, max_levels=3,
    )
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
    assert seen and seen[-1] >= 1
