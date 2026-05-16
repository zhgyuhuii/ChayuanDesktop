"""OCR 客户端:成功 / sidecar 不可用 / 超时。"""
from __future__ import annotations

import base64
import pytest


class _FakeResp:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self._payload = payload or {}
        self.text = ""
    def json(self): return self._payload
    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx
            raise httpx.HTTPStatusError("bad", request=None, response=self)


@pytest.mark.asyncio
async def test_ocr_happy(monkeypatch):
    from chayuan.server.image_source import ocr_client

    async def _fake_post(self, url, json, timeout):
        assert "/v1/ocr" in url
        assert "image" in json
        return _FakeResp(200, {
            "boxes": [
                {"box": [[0, 0], [100, 0], [100, 30], [0, 30]],
                 "text": "hello", "score": 0.98},
                {"box": [[0, 40], [100, 40], [100, 70], [0, 70]],
                 "text": "world", "score": 0.95},
            ],
            "elapsed_ms": 120,
        })
    import httpx
    monkeypatch.setattr(httpx.AsyncClient, "post", _fake_post)

    result = await ocr_client.run_ocr(b"\x89PNG fake-bytes", port=18380)
    assert result.text == "hello\nworld"
    assert result.lang in ("ch", "en", "unknown")
    assert 0.9 <= result.confidence <= 1.0


@pytest.mark.asyncio
async def test_ocr_sidecar_unavailable(monkeypatch):
    from chayuan.server.image_source import ocr_client

    async def _fake_post(self, url, json, timeout):
        return _FakeResp(503, {"detail": "rapidocr 未安装"})
    import httpx
    monkeypatch.setattr(httpx.AsyncClient, "post", _fake_post)

    result = await ocr_client.run_ocr(b"x", port=18380)
    assert result.text == ""
    assert result.error and "503" in result.error


@pytest.mark.asyncio
async def test_ocr_timeout(monkeypatch):
    from chayuan.server.image_source import ocr_client
    import httpx

    async def _fake_post(self, url, json, timeout):
        raise httpx.ReadTimeout("timeout")
    monkeypatch.setattr(httpx.AsyncClient, "post", _fake_post)

    result = await ocr_client.run_ocr(b"x", port=18380)
    assert result.text == ""
    assert "timeout" in (result.error or "").lower()
