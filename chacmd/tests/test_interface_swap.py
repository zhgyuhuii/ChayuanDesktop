"""Per-interface "swap without changing callers" tests (plan interface-principle gap).

Each test defines a tiny in-test conforming implementation (no new production
files) and asserts a caller-style usage works against the Protocol/ABC, the
same pattern as test_crypto.py's NullCrypto. I3/I4 already have coverage
elsewhere; this file adds I1, I5, I6, I7, I8, I10.
"""

from __future__ import annotations

import pytest

from chacmd.domain.events import Event
from chacmd.interfaces.agent_adapter import AgentAdapter, DispatchSpec
from chacmd.interfaces.auth import AuthProvider
from chacmd.interfaces.chayuan_client import ChayuanClient
from chacmd.interfaces.eventbus import EventBus
from chacmd.interfaces.sandbox import Sandbox, SandboxSpec
from chacmd.interfaces.transport import InProcessTransport, LogicalAddress, Transport


# I1 — ChayuanClient
class StubChayuanClient:
    async def chat_completions(self, model, messages, **kw):
        return {"choices": []}

    async def kb_query(self, ku_ids, query, **kw):
        return {"hits": []}

    async def authorize(self, subject: str, resource: str, action: str) -> bool:
        return True

    async def whoami(self, token: str) -> dict:
        return {"subject": "s"}

    def web_url(self) -> str:
        return "http://stub.test"


@pytest.mark.asyncio
async def test_chayuan_client_is_swappable_protocol():
    async def use(c: ChayuanClient) -> bool:
        return await c.authorize(subject="u", resource="r", action="a")

    stub = StubChayuanClient()
    assert isinstance(await use(stub), bool)


# I5 — AgentAdapter
class StubAdapter(AgentAdapter):
    async def dispatch(self, spec: DispatchSpec):
        yield Event(spec.job_id, spec.task_id, spec.nickname, "succeeded", 0, {})

    async def health(self) -> bool:
        return True

    async def cancel(self, job_id: str, task_id: str) -> None:
        return None

    def manifest(self) -> dict:
        return {"name": "stub"}


@pytest.mark.asyncio
async def test_agent_adapter_is_swappable_abc():
    adapter: AgentAdapter = StubAdapter()
    spec = DispatchSpec(job_id="j1", task_id="t1", nickname="dev", goal="g", system_prompt="p")
    events = [e async for e in adapter.dispatch(spec)]
    assert len(events) == 1
    assert isinstance(events[0], Event)


# I6 — EventBus
class StubBus:
    def __init__(self) -> None:
        self.published: list[tuple[str, dict]] = []

    async def publish(self, subject: str, message: dict) -> None:
        self.published.append((subject, message))

    def subscribe(self, subject: str):
        raise NotImplementedError


@pytest.mark.asyncio
async def test_eventbus_is_swappable_protocol():
    async def use(bus: EventBus) -> None:
        await bus.publish("job.1.started", {"kind": "started"})

    stub = StubBus()
    await use(stub)
    assert stub.published == [("job.1.started", {"kind": "started"})]


# I7 — Sandbox
class StubSandbox:
    async def create(self, spec: SandboxSpec):
        return type("Handle", (), {"nickname": spec.nickname})()

    async def destroy(self, handle_id: str) -> None:
        return None


@pytest.mark.asyncio
async def test_sandbox_is_swappable_protocol():
    async def use(s: Sandbox):
        return await s.create(SandboxSpec(nickname="dev", image="img"))

    handle = await use(StubSandbox())
    assert handle.nickname == "dev"


# I8 — AuthProvider
class StubAuth:
    def __init__(self) -> None:
        self._store: dict[str, dict] = {}

    async def issue_token(self, subject: str, dept: str) -> str:
        token = f"{subject}:{dept}"
        self._store[token] = {"subject": subject, "dept": dept}
        return token

    async def verify(self, token: str) -> dict:
        return self._store[token]


@pytest.mark.asyncio
async def test_auth_provider_is_swappable_protocol():
    async def use(a: AuthProvider):
        token = await a.issue_token(subject="u1", dept="d1")
        return await a.verify(token)

    claims = await use(StubAuth())
    assert claims == {"subject": "u1", "dept": "d1"}


# I10 — Transport
class StubTransport:
    def __init__(self) -> None:
        self._handlers: dict[tuple[str, str], object] = {}

    async def bind(self, addr: LogicalAddress, handler) -> None:
        self._handlers[(addr.kind, addr.value)] = handler

    async def send(self, addr: LogicalAddress, message: dict) -> None:
        handler = self._handlers[(addr.kind, addr.value)]
        result = handler(message)
        if result is not None:
            await result


@pytest.mark.asyncio
async def test_transport_is_swappable_protocol():
    received: list[dict] = []

    async def handler(message: dict) -> None:
        received.append(message)

    async def use(t: Transport) -> None:
        addr = LogicalAddress.nickname("dev")
        await t.bind(addr, handler)
        await t.send(addr, {"hello": "world"})

    await use(StubTransport())
    assert received == [{"hello": "world"}]
    # sanity: the real default impl also satisfies the same Transport usage.
    await use(InProcessTransport())
