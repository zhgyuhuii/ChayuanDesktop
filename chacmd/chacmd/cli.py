from __future__ import annotations

import argparse
import asyncio

import uvicorn

from chacmd.api.app import create_app
from chacmd.config import Settings
from chacmd.container import build_container
from chacmd.gateway.bridge_gateway import BridgeGateway


async def _serve(settings: Settings) -> None:
    container = await build_container(settings, use_fakes=False)
    gateway = BridgeGateway(container.containers, host=settings.gateway_host, port=settings.gateway_port)
    gateway.on_event(lambda env: container.ingest.handle(_env_to_event(env)))
    await gateway.start()
    try:
        app = create_app(container.db, chayuan=container.chayuan)
        config = uvicorn.Config(app, host=settings.api_host, port=settings.api_port, log_level="info")
        await uvicorn.Server(config).serve()
    finally:
        await gateway.stop()
        if hasattr(container.chayuan, "aclose"):
            await container.chayuan.aclose()


def _env_to_event(env):
    from chacmd.domain.events import Event
    d = env.data
    return Event(d["job_id"], d["task_id"], env.nickname, d["kind"], d["seq"], d.get("payload", {}))


def main() -> None:
    parser = argparse.ArgumentParser(prog="chacmd")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("start", help="start the ChaCMD orchestrator + gateway + API")
    args = parser.parse_args()
    if args.command == "start":
        asyncio.run(_serve(Settings.from_env()))


if __name__ == "__main__":
    main()
