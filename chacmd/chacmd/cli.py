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
    await container.db.create_all()  # 幂等建表，首跑不再空库崩
    gateway = BridgeGateway(container.containers, host=settings.gateway_host, port=settings.gateway_port)
    gateway.on_event(lambda env: container.ingest.handle(_env_to_event(env)))
    await gateway.start()
    _print_banner(settings)
    try:
        app = create_app(container.db, chayuan=container.chayuan, stream_hub=container.stream_hub)
        config = uvicorn.Config(app, host=settings.api_host, port=settings.api_port, log_level="info")
        await uvicorn.Server(config).serve()
    finally:
        await gateway.stop()
        if hasattr(container.chayuan, "aclose"):
            await container.chayuan.aclose()


def _print_banner(s: Settings) -> None:
    src = s.config_source or "(默认值 + 环境变量，未用 yaml)"
    print(
        "\n".join(
            [
                "",
                "  ChaCMD Orchestrator 启动",
                f"    配置来源 : {src}",
                f"    API      : http://{s.api_host}:{s.api_port}   (根 / 有状态页, /healthz, /docs)",
                f"    反连网关 : ws://{s.gateway_host}:{s.gateway_port}/bridge",
                f"    察元后端 : {s.chayuan_base_url}",
                f"    数据库   : {s.db_url}",
                f"    事件总线 : {s.event_bus}   沙箱: {s.sandbox}   适配器: {s.agent_adapter}",
                "",
            ]
        ),
        flush=True,
    )


def _env_to_event(env):
    from chacmd.domain.events import Event
    d = env.data
    return Event(d["job_id"], d["task_id"], env.nickname, d["kind"], d["seq"], d.get("payload", {}))


def main() -> None:
    parser = argparse.ArgumentParser(prog="chacmd")
    sub = parser.add_subparsers(dest="command", required=True)
    start = sub.add_parser("start", help="start the ChaCMD orchestrator + gateway + API")
    start.add_argument(
        "-c", "--config", default=None,
        help="配置 yaml 路径（不传则按 $CHACMD_CONFIG → ./chacmd.yaml 搜索；env 覆盖 yaml）",
    )
    args = parser.parse_args()
    if args.command == "start":
        asyncio.run(_serve(Settings.load(args.config)))


if __name__ == "__main__":
    main()
