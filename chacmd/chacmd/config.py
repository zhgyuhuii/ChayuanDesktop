from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass
class Settings:
    db_url: str
    chayuan_base_url: str
    chayuan_web_url: str
    gateway_host: str = "0.0.0.0"
    gateway_port: int = 8767
    api_host: str = "0.0.0.0"
    api_port: int = 8100
    workspace_root: str = "/workspace"
    nats_url: str = "nats://127.0.0.1:4222"
    event_bus: str = "memory"  # memory | nats
    sandbox: str = "fake"  # fake | docker
    sandbox_image: str = "chatop-ai:latest"
    agent_adapter: str = "fake"  # fake | openhands
    default_token_budget: int = 100_000  # per-job token 硬预算，0=不限

    @staticmethod
    def from_env() -> Settings:
        return Settings(
            db_url=os.environ.get("CHACMD_DB_URL", "postgresql+asyncpg://chacmd:chacmd@127.0.0.1:5432/chacmd"),
            chayuan_base_url=os.environ.get("CHAYUAN_BASE_URL", "http://127.0.0.1:8000"),
            chayuan_web_url=os.environ.get("CHAYUAN_WEB_URL", "http://127.0.0.1:5173"),
            api_port=int(os.environ.get("CHACMD_API_PORT", "8100")),
            gateway_port=int(os.environ.get("CHACMD_GATEWAY_PORT", "8767")),
            nats_url=os.environ.get("CHACMD_NATS_URL", "nats://127.0.0.1:4222"),
            event_bus=os.environ.get("CHACMD_EVENT_BUS", "memory"),
            sandbox=os.environ.get("CHACMD_SANDBOX", "fake"),
            sandbox_image=os.environ.get("CHACMD_SANDBOX_IMAGE", "chatop-ai:latest"),
            agent_adapter=os.environ.get("CHACMD_AGENT_ADAPTER", "fake"),
            default_token_budget=int(os.environ.get("CHACMD_JOB_TOKEN_BUDGET", "100000")),
        )
