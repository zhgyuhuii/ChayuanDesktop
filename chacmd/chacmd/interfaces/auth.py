from __future__ import annotations

import json
import uuid
from typing import Any, Protocol


class AuthProvider(Protocol):
    """I8 — identity/auth. Default 察元-internal (via I1) / swap OIDC/LDAP/SSO + 一次性token(形态C) + 三员."""

    async def issue_token(self, subject: str, dept: str) -> str: ...
    async def verify(self, token: str) -> dict[str, Any]: ...


class FakeAuthProvider:
    """Test double: opaque token → in-memory claim store."""

    def __init__(self) -> None:
        self._store: dict[str, dict] = {}

    async def issue_token(self, subject: str, dept: str) -> str:
        token = uuid.uuid5(uuid.NAMESPACE_OID, f"{subject}:{dept}").hex
        self._store[token] = {"subject": subject, "dept": dept}
        return token

    async def verify(self, token: str) -> dict[str, Any]:
        if token not in self._store:
            raise ValueError("invalid token")
        return dict(self._store[token])


class ChayuanAuthProvider:
    """Default prod impl: delegate to 察元 whoami via I1 (imported lazily to avoid cycles)."""

    def __init__(self, chayuan_client: Any) -> None:
        self._c = chayuan_client

    async def issue_token(self, subject: str, dept: str) -> str:
        # P0: 察元 issues tokens; ChaCMD does not mint its own. Placeholder passes through dept-scoped id.
        return json.dumps({"subject": subject, "dept": dept})

    async def verify(self, token: str) -> dict[str, Any]:
        return await self._c.whoami(token)
