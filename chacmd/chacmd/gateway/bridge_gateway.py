from __future__ import annotations

import json
import uuid
from collections.abc import Awaitable, Callable

import websockets

from chacmd.domain.repository import ContainerRepository
from chacmd.gateway.protocol import Envelope
from chacmd.orchestrator.registrar import Registrar


class BridgeGateway:
    """Stateless connection tier: terminates reverse-WS, registers nickname→session, no IP.

    Sessions are logical ids; the gateway holds nickname→ws so the core can send by nickname.
    """

    def __init__(self, containers: ContainerRepository, host: str = "0.0.0.0", port: int = 8767) -> None:
        self._registrar = Registrar(containers)
        self._host = host
        self._port = port
        self._server: websockets.WebSocketServer | None = None
        self._sessions: dict[str, websockets.WebSocketServerProtocol] = {}   # nickname → ws
        self._event_sink: Callable[[Envelope], Awaitable[None]] | None = None

    def on_event(self, sink: Callable[[Envelope], Awaitable[None]]) -> None:
        self._event_sink = sink

    async def send_to(self, nickname: str, env: Envelope) -> None:
        ws = self._sessions.get(nickname)
        if ws is None:
            raise KeyError(f"no live session for nickname {nickname}")
        await ws.send(json.dumps(env.to_json()))

    async def _handle(self, ws: websockets.WebSocketServerProtocol) -> None:
        session = uuid.uuid4().hex
        try:
            async for raw in ws:
                env = Envelope.from_json(json.loads(raw))
                if env.type in ("register", "heartbeat"):
                    if env.type == "register":
                        self._sessions[env.nickname] = ws
                    await self._registrar.handle(env, session=session)
                elif env.type in ("event", "result") and self._event_sink:
                    await self._event_sink(env)
        finally:
            for nick, sock in list(self._sessions.items()):
                if sock is ws:
                    del self._sessions[nick]

    async def start(self) -> None:
        self._server = await websockets.serve(self._handle, self._host, self._port, subprotocols=None)

    async def stop(self) -> None:
        if self._server:
            self._server.close()
            await self._server.wait_closed()
