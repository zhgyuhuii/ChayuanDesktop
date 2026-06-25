import pytest
from chayuan.server.file_service import registry
from chayuan.server.file_service.base import FileRequestError


def test_dispatch_unknown_kind_raises():
    with pytest.raises(FileRequestError) as ei:
        registry.dispatch("nope", {}, user=None, download=False)
    assert ei.value.status_code == 400


def test_register_and_dispatch_calls_adapter():
    calls = {}

    class _Stub:
        kind = "stub"
        def handle(self, params, user, *, download):
            calls["params"] = params
            calls["download"] = download
            return "RESP"

    registry.register(_Stub())
    out = registry.dispatch("stub", {"a": "1"}, user={"id": "u"}, download=True)
    assert out == "RESP"
    assert calls == {"params": {"a": "1"}, "download": True}
