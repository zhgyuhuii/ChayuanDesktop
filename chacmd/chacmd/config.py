"""ChaCMD 配置：分层 defaults < yaml < env（对齐察元 chayuan_core.config 模式）。

yaml 搜索顺序（首个命中即用）：
    1. 显式传入的 config_path
    2. $CHACMD_CONFIG（若设置且文件存在）
    3. ./chacmd.yaml（当前工作目录，开发态最方便）
env（CHACMD_* / CHAYUAN_BASE_URL 等）覆盖 yaml，yaml 覆盖字段默认值。
样例见 chacmd.example.yaml。
"""

from __future__ import annotations

import os
from dataclasses import dataclass, fields
from pathlib import Path

import yaml

# 字段 → 环境变量名（env 覆盖 yaml；名字不规整，显式映射，不用前缀魔法）
_ENV: dict[str, str] = {
    "db_url": "CHACMD_DB_URL",
    "chayuan_base_url": "CHAYUAN_BASE_URL",
    "chayuan_web_url": "CHAYUAN_WEB_URL",
    "gateway_host": "CHACMD_GATEWAY_HOST",
    "gateway_port": "CHACMD_GATEWAY_PORT",
    "api_host": "CHACMD_API_HOST",
    "api_port": "CHACMD_API_PORT",
    "workspace_root": "CHACMD_WORKSPACE_ROOT",
    "nats_url": "CHACMD_NATS_URL",
    "event_bus": "CHACMD_EVENT_BUS",
    "sandbox": "CHACMD_SANDBOX",
    "sandbox_image": "CHACMD_SANDBOX_IMAGE",
    "agent_adapter": "CHACMD_AGENT_ADAPTER",
    "default_token_budget": "CHACMD_JOB_TOKEN_BUDGET",
}
_INT_FIELDS = {"gateway_port", "api_port", "default_token_budget"}


@dataclass
class Settings:
    db_url: str = "postgresql+asyncpg://chacmd:chacmd@127.0.0.1:5432/chacmd"
    chayuan_base_url: str = "http://127.0.0.1:8000"
    chayuan_web_url: str = "http://127.0.0.1:5173"
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

    # 只读：本次配置来源（yaml 路径或 None），仅供启动日志展示
    config_source: str | None = None

    @classmethod
    def load(cls, config_path: str | Path | None = None) -> Settings:
        """分层加载：默认值 < yaml < env。"""
        field_names = {f.name for f in fields(cls)}
        raw: dict = {}

        p = _resolve_yaml(config_path)
        if p is not None:
            loaded = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
            if isinstance(loaded, dict):
                raw.update({k: v for k, v in loaded.items() if k in field_names})
            raw["config_source"] = str(p)

        for field, env in _ENV.items():
            if env in os.environ:
                raw[field] = os.environ[env]

        for f in _INT_FIELDS:
            if f in raw and raw[f] is not None:
                raw[f] = int(raw[f])

        return cls(**{k: v for k, v in raw.items() if k in field_names})

    @staticmethod
    def from_env() -> Settings:
        """纯 env 加载（向后兼容；不读 yaml）。"""
        field_names = {f.name for f in fields(Settings)}
        raw: dict = {}
        for field, env in _ENV.items():
            if env in os.environ:
                raw[field] = os.environ[env]
        for f in _INT_FIELDS:
            if f in raw and raw[f] is not None:
                raw[f] = int(raw[f])
        return Settings(**{k: v for k, v in raw.items() if k in field_names})


def _resolve_yaml(config_path: str | Path | None) -> Path | None:
    if config_path is not None:
        p = Path(config_path).expanduser()
        return p if p.is_file() else None
    env = os.environ.get("CHACMD_CONFIG")
    if env:
        p = Path(env).expanduser()
        return p if p.is_file() else None
    cwd_yaml = Path.cwd() / "chacmd.yaml"
    return cwd_yaml if cwd_yaml.is_file() else None


__all__ = ["Settings"]
