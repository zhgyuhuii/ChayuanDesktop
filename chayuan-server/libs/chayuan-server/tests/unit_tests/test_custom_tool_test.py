from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, List
from chayuan.server.tools import custom_tool_test as M


@dataclass
class _P:
    name: str
    type: str = "string"
    required: bool = False
    default: Any = None
    enum: list = field(default_factory=list)


@dataclass
class _Spec:
    url: str
    method: str = "GET"
    params: List[_P] = field(default_factory=list)
    headers: dict = field(default_factory=dict)
    body_template: Any = None
    timeout: float = 15.0


class _FakeRes:
    def to_dict(self):
        return {"ok": True, "status_code": 200}


def test_get_url_format_and_query(monkeypatch):
    calls = {}
    def fake_run(method, url, **kw):
        calls.update(method=method, url=url, **kw)
        return _FakeRes()
    monkeypatch.setattr(M, "run_request", fake_run)
    spec = _Spec(url="http://x/u/{uid}", method="GET",
                 params=[_P("uid", required=True), _P("q", default="hi")])
    out = M.build_and_run(spec, {"uid": "42"})
    assert calls["url"] == "http://x/u/42"          # uid 代入路径
    assert calls["params"] == {"q": "hi"}            # 非路径参数进 query
    assert out["url"] == "http://x/u/42" and out["ok"] is True


def test_post_body_template(monkeypatch):
    calls = {}
    monkeypatch.setattr(M, "run_request", lambda method, url, **kw: (calls.update(method=method, url=url, **kw) or _FakeRes()))
    spec = _Spec(url="http://x/p", method="POST",
                 params=[_P("n", required=True)], body_template='{"n": "{n}"}')
    M.build_and_run(spec, {"n": "5"})
    assert calls["json_body"] == {"n": "5"}          # body_template 代入+json 解析


def test_url_format_error_fallback(monkeypatch):
    monkeypatch.setattr(M, "run_request", lambda method, url, **kw: _FakeRes())
    spec = _Spec(url="http://x/{missing}", method="GET", params=[])
    out = M.build_and_run(spec, {})
    assert out["url"] == "http://x/{missing}"        # format 失败回退原 url
