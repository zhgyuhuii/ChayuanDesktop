"""LlamaRuntimeManager 单元测试。

mock subprocess.Popen + httpx 不真起 llama-server,只验证状态机 + yaml 持久化。
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from unittest import mock

import pytest

from chayuan.server.model_registry.local_runtime import (
    LocalRuntimeSettings,
    RuntimeStatus,
)


def test_local_runtime_settings_defaults():
    s = LocalRuntimeSettings()
    assert s.preload_on_startup is True
    assert s.host == "127.0.0.1"
    assert s.port == 62582
    assert s.api_key == ""
    assert s.expose_lan is False
    assert s.default_chat_model == ""


def test_local_runtime_settings_load_save(tmp_path):
    """yaml round-trip:写 → 读 → 值一致"""
    yaml_path = tmp_path / "local_runtime.yaml"
    s = LocalRuntimeSettings(
        preload_on_startup=False,
        host="0.0.0.0",
        port=62590,
        api_key="secret123",
        expose_lan=True,
        default_chat_model="Qwen3-4B-Instruct-2507-Q3_K_S",
    )
    s.save(yaml_path)
    assert yaml_path.is_file()

    s2 = LocalRuntimeSettings.load(yaml_path)
    assert s2.preload_on_startup is False
    assert s2.host == "0.0.0.0"
    assert s2.port == 62590
    assert s2.api_key == "secret123"
    assert s2.expose_lan is True
    assert s2.default_chat_model == "Qwen3-4B-Instruct-2507-Q3_K_S"


def test_local_runtime_settings_load_missing_returns_default(tmp_path):
    """yaml 文件不存在时,load 返回 default 配置而非 raise"""
    yaml_path = tmp_path / "nope.yaml"
    s = LocalRuntimeSettings.load(yaml_path)
    assert s.preload_on_startup is True
    assert s.port == 62582


def test_runtime_status_default():
    st = RuntimeStatus(state="stopped")
    assert st.state == "stopped"
    assert st.endpoint is None
    assert st.pid is None
    assert st.last_error is None
