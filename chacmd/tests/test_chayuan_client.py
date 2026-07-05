import httpx
import pytest

from chacmd.interfaces.chayuan_client import ChayuanClient, FakeChayuanClient, HttpChayuanClient


class _RecordingTransport(httpx.AsyncBaseTransport):
    """记录请求路径，返回预设响应。"""

    def __init__(self) -> None:
        self.paths: list[str] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.paths.append(request.url.path)
        if request.url.path == "/openapi/v1/whoami":
            return httpx.Response(200, json={"app_id": "a1", "name": "chacmd", "scopes": ["admin:read"]})
        return httpx.Response(404, json={"detail": "not found"})


@pytest.mark.asyncio
async def test_whoami_hits_openapi_v1_path():
    # 察元真实端点：openapi_router prefix /openapi/v1 + /whoami（openapi_routes.py:36,242）
    transport = _RecordingTransport()
    c = HttpChayuanClient(base_url="http://chayuan.test", web_url="http://web.test")
    c._client = httpx.AsyncClient(base_url="http://chayuan.test", transport=transport)
    out = await c.whoami("tok")
    assert "/openapi/v1/whoami" in transport.paths
    assert "/api/v1/whoami" not in transport.paths
    assert out["app_id"] == "a1"


@pytest.mark.asyncio
async def test_authorize_makes_no_http_call_to_nonexistent_endpoint():
    # 察元无资源级 authz-check 端点（鉴权是 scope-based require_scopes）。
    # container-dispatch RBAC 是 ChaCMD 自己的域，防腐层不得伪造察元端点。
    transport = _RecordingTransport()
    c = HttpChayuanClient(base_url="http://chayuan.test", web_url="http://web.test")
    c._client = httpx.AsyncClient(base_url="http://chayuan.test", transport=transport)
    allowed = await c.authorize(subject="u1", resource="container:x", action="dispatch")
    assert allowed is True  # 默认放行（P1 接 ChaCMD dept-RBAC）
    assert transport.paths == []  # 未发起任何 HTTP 调用
    assert "/api/v1/authz/check" not in transport.paths


@pytest.mark.asyncio
async def test_fake_chayuan_client_authz_and_weburl():
    c: ChayuanClient = FakeChayuanClient(web_url="http://chayuan.local")
    assert await c.authorize(subject="u1", resource="container:pm", action="dispatch") is True
    c.deny("u1", "container:secret", "dispatch")
    assert await c.authorize(subject="u1", resource="container:secret", action="dispatch") is False
    assert c.web_url() == "http://chayuan.local"


@pytest.mark.asyncio
async def test_fake_chayuan_client_chat_records_calls():
    c = FakeChayuanClient()
    out = await c.chat_completions(model="deepseek", messages=[{"role": "user", "content": "hi"}])
    assert out["choices"][0]["message"]["content"]  # non-empty stub reply
    assert c.calls[-1]["model"] == "deepseek"
