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


def test_manager_init_paths(tmp_path):
    """manager 构造时定位 runtime_yaml / vendor exe / runtime.json 路径"""
    from chayuan.server.model_registry.local_runtime import LlamaRuntimeManager
    m = LlamaRuntimeManager(chayuan_root=tmp_path)
    assert m.settings_path == tmp_path / "model_registry" / "local_runtime.yaml"
    assert m.status_path == tmp_path / "runtime.json"


def test_manager_find_llama_server_exe_missing(tmp_path):
    """vendor 二进制找不到时,_find_llama_server_exe 返回 None"""
    from chayuan.server.model_registry.local_runtime import LlamaRuntimeManager
    m = LlamaRuntimeManager(chayuan_root=tmp_path)
    # 没真 vendor 二进制
    assert m._find_llama_server_exe() is None


def test_manager_find_llama_server_exe_present(tmp_path, monkeypatch):
    """vendor/services/llama-server/llama-server.exe 存在时,返回该路径"""
    from chayuan.server.model_registry import local_runtime
    services = tmp_path / "services" / "llama-server"
    services.mkdir(parents=True)
    exe = services / "llama-server.exe"
    exe.write_bytes(b"stub")

    # mock 装机后的搜索路径
    monkeypatch.setattr(local_runtime, "_INSTALL_SERVICES_DIRS", [tmp_path / "services"])

    m = local_runtime.LlamaRuntimeManager(chayuan_root=tmp_path)
    assert m._find_llama_server_exe() == exe


def test_manager_allocate_port_default_free(tmp_path):
    """端口默认 62582 没被占用时,_allocate_port 返回 62582"""
    from chayuan.server.model_registry.local_runtime import LlamaRuntimeManager
    m = LlamaRuntimeManager(chayuan_root=tmp_path)
    # 假定测试机 62582 没占(很大概率)
    port = m._allocate_port(preferred=62582)
    assert 62582 <= port <= 62600


def test_manager_allocate_port_bumps_on_conflict(tmp_path, monkeypatch):
    """端口被占时往上 bump,直到找到空闲"""
    import socket
    from chayuan.server.model_registry.local_runtime import LlamaRuntimeManager
    m = LlamaRuntimeManager(chayuan_root=tmp_path)

    # 占住 62582-62584
    occupied = []
    for p in (62582, 62583, 62584):
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", p))
            s.listen(1)
            occupied.append(s)
        except OSError:
            s.close()

    try:
        port = m._allocate_port(preferred=62582)
        # 应该是 62585 或后面 (受是否占成功影响)
        assert port not in (s.getsockname()[1] for s in occupied)
    finally:
        for s in occupied:
            s.close()
