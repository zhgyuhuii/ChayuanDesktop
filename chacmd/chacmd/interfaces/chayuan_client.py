from __future__ import annotations

from typing import Any, Protocol

import httpx


class ChayuanClient(Protocol):
    """I1 — ALL 察元 dependencies via HTTP. Default Http (localhost=形态B / remote=形态C).

    Because it is HTTP, ChaCMD never needs 察元 in-process; enables 轻量挂载 (§3.9).
    """

    async def chat_completions(self, model: str, messages: list[dict], **kw: Any) -> dict: ...
    async def kb_query(self, ku_ids: list[str], query: str, **kw: Any) -> dict: ...
    async def authorize(self, subject: str, resource: str, action: str) -> bool: ...
    async def whoami(self, token: str) -> dict: ...
    def web_url(self) -> str: ...


class HttpChayuanClient:
    """Default: talk to a deployed 察元 over HTTP (localhost or remote)."""

    def __init__(self, base_url: str, web_url: str, *, timeout: float = 30.0) -> None:
        self._base = base_url.rstrip("/")
        self._web = web_url.rstrip("/")
        self._client = httpx.AsyncClient(base_url=self._base, timeout=timeout)

    async def chat_completions(self, model: str, messages: list[dict], **kw: Any) -> dict:
        resp = await self._client.post("/v1/chat/completions", json={"model": model, "messages": messages, **kw})
        resp.raise_for_status()
        return resp.json()

    async def kb_query(self, ku_ids: list[str], query: str, **kw: Any) -> dict:
        resp = await self._client.post("/api/v1/kb-query/search", json={"ku_ids": ku_ids, "query": query, **kw})
        resp.raise_for_status()
        return resp.json()

    async def authorize(self, subject: str, resource: str, action: str) -> bool:
        # 察元没有资源级 authz-check 端点：其鉴权是 scope-based（require_scopes，
        # openapi_routes.py），whoami 返回的是 App scope，不是用户/资源 RBAC。
        # container-dispatch RBAC（谁能派活给哪个工位）是 ChaCMD 自己的域，
        # 不得在防腐层伪造一个不存在的察元端点。P0 默认放行，P1 由 ChaCMD 的
        # AuthProvider 按 dept 做真 RBAC（见 chacmd/interfaces/auth.py）。
        return True

    async def whoami(self, token: str) -> dict:
        # 察元真实端点：openapi_router prefix /openapi/v1 + /whoami（需 admin:read scope）。
        resp = await self._client.get("/openapi/v1/whoami", headers={"Authorization": f"Bearer {token}"})
        resp.raise_for_status()
        return resp.json()

    def web_url(self) -> str:
        return self._web

    async def aclose(self) -> None:
        await self._client.aclose()


class FakeChayuanClient:
    """Test double: no network. Records calls, allow-by-default authz."""

    def __init__(self, web_url: str = "http://chayuan.test") -> None:
        self._web = web_url
        self._denied: set[tuple[str, str, str]] = set()
        self.calls: list[dict] = []

    def deny(self, subject: str, resource: str, action: str) -> None:
        self._denied.add((subject, resource, action))

    async def chat_completions(self, model: str, messages: list[dict], **kw: Any) -> dict:
        self.calls.append({"model": model, "messages": messages, **kw})
        return {"choices": [{"message": {"role": "assistant", "content": "[fake reply]"}}]}

    async def kb_query(self, ku_ids: list[str], query: str, **kw: Any) -> dict:
        self.calls.append({"kb": ku_ids, "query": query})
        return {"hits": []}

    async def authorize(self, subject: str, resource: str, action: str) -> bool:
        return (subject, resource, action) not in self._denied

    async def whoami(self, token: str) -> dict:
        return {"subject": "test-user", "dept": "test-dept"}

    def web_url(self) -> str:
        return self._web
