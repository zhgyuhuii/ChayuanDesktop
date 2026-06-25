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
