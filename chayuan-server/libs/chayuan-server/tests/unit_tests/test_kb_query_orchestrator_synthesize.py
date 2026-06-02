from __future__ import annotations

"""数字人 grounding 性能回归:options.synthesize=False 时,统一检索 orchestrator
不得触发综合 LLM 调用(synthesize_answer)。默认 True 时仍照旧综合,保证其它
kb_query 调用方行为不变。

注:沙箱 py3.6 跑不了 pytest(本仓依赖 pydantic v2 / py3.12),需在 py312 下:
    PYTHONPATH=".../libs/chayuan-server" pytest -q .../tests/unit_tests/test_kb_query_orchestrator_synthesize.py
"""

from chayuan.server.kb_query.authz import Subject
from chayuan.server.kb_query.schemas import SearchRequest
from chayuan.server.retrieval.query import orchestrator
from chayuan.server.retrieval.query import synthesis as synthesis_mod


class _FakeRef:
    def __init__(self):
        self.kb_id = "doc:samples"
        self.name = "samples"
        self.display_name = "samples"
        self.kind = "document"
        self.sub_kind = ""


def _patch_common(monkeypatch, synth_calls):
    ref = _FakeRef()
    monkeypatch.setattr(orchestrator, "resolve_refs", lambda *a, **k: [ref])
    monkeypatch.setattr(orchestrator, "assert_readable", lambda *a, **k: "reader")
    # 任何意图都返回固定值,避免触发真实 LLM/规则推断
    monkeypatch.setattr(orchestrator, "infer_intent", lambda *a, **k: "document_qa")
    # document adapter 直接返回一条命中,使 items 非空、有可综合证据

    def fake_search_document(_ref, _text, _options):
        return {
            "ok": True,
            "kind": "document",
            "results": [{"text": "命中片段正文", "citation": {"file_name": "a.pdf"}}],
        }

    monkeypatch.setattr(orchestrator, "search_document", fake_search_document)

    # 监控 synthesize_answer 是否被调用(orchestrator 内是 lazy import 该模块属性)
    def spy_synthesize_answer(query, evidence, **kwargs):
        synth_calls.append((query, len(evidence)))
        return "综合答案"

    monkeypatch.setattr(synthesis_mod, "synthesize_answer", spy_synthesize_answer)


def test_grounding_synthesize_false_skips_llm_synthesis(monkeypatch):
    synth_calls = []
    _patch_common(monkeypatch, synth_calls)

    req = SearchRequest(
        ku_ids=["doc:samples"],
        contents=[{"text": "主题文案 grounding"}],
        options={"top_k": 3, "synthesize": False},
    )
    res = orchestrator.search(Subject(user=None, mode="guest"), req)

    # 关键断言:综合 LLM 一次都没被调用
    assert synth_calls == []
    # 命中仍可被取用(原始 results 不受影响)
    assert res["data"]["items"][0]["results"][0]["text"] == "命中片段正文"
    # summary 为空(没有综合)
    assert res["data"]["summary"]["text"] == ""
    assert res["data"]["summary"]["ok"] is False


def test_default_still_synthesizes(monkeypatch):
    """默认 synthesize=True 的调用方行为不变:仍会调用综合并产出 summary。"""
    synth_calls = []
    _patch_common(monkeypatch, synth_calls)

    req = SearchRequest(
        ku_ids=["doc:samples"],
        contents=[{"text": "主题文案 grounding"}],
        options={"top_k": 3},
    )
    res = orchestrator.search(Subject(user=None, mode="guest"), req)

    assert len(synth_calls) == 1
    assert res["data"]["summary"]["text"] == "综合答案"
    assert res["data"]["summary"]["ok"] is True
