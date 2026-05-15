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
    """vendor 二进制找不到时,find_llama_server_exe 返回 None"""
    from chayuan.server.model_registry.local_runtime import LlamaRuntimeManager
    m = LlamaRuntimeManager(chayuan_root=tmp_path)
    # 没真 vendor 二进制
    assert m.find_llama_server_exe() is None


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
    assert m.find_llama_server_exe() == exe


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


@pytest.mark.asyncio
async def test_manager_start_spawns_subprocess(tmp_path, monkeypatch):
    """start() 成功 spawn 时,状态变 starting → ready (mock health 200)"""
    from chayuan.server.model_registry import local_runtime
    services = tmp_path / "services" / "llama-server"
    services.mkdir(parents=True)
    exe = services / "llama-server.exe"
    exe.write_bytes(b"stub")
    monkeypatch.setattr(local_runtime, "_INSTALL_SERVICES_DIRS", [tmp_path / "services"])

    # mock resolve_llamacpp_args 返回 fake args
    fake_resolution = mock.MagicMock(
        missing=[],
        args=["--model", "/tmp/fake.gguf", "--ctx-size", "8192"],
        resolved_models={"chat": "fake-chat-model"},
        reason="",
    )
    monkeypatch.setattr(
        local_runtime, "_resolve_args_for",
        lambda *a, **kw: (fake_resolution, "/tmp/fake.gguf"),
    )

    # mock Popen + httpx
    fake_proc = mock.MagicMock(pid=12345, poll=mock.MagicMock(return_value=None))
    monkeypatch.setattr(local_runtime.subprocess, "Popen", mock.MagicMock(return_value=fake_proc))
    async def fake_health(url, **kw):
        return mock.MagicMock(status_code=200)
    monkeypatch.setattr(local_runtime, "_probe_health", fake_health)

    m = local_runtime.LlamaRuntimeManager(chayuan_root=tmp_path)
    status = await m.start()

    assert status.state == "ready"
    assert status.pid == 12345
    assert status.endpoint == "http://127.0.0.1:62582"
    assert status.model_id == "fake-chat-model"


@pytest.mark.asyncio
async def test_manager_start_missing_exe_fails(tmp_path):
    """vendor 二进制缺失时,start() 状态 → failed"""
    from chayuan.server.model_registry.local_runtime import LlamaRuntimeManager
    m = LlamaRuntimeManager(chayuan_root=tmp_path)
    status = await m.start()
    assert status.state == "failed"
    assert "llama-server" in (status.last_error or "").lower()


@pytest.mark.asyncio
async def test_manager_stop_kills_process(tmp_path, monkeypatch):
    """stop() 调 terminate + wait,状态 → stopped"""
    from chayuan.server.model_registry import local_runtime

    fake_proc = mock.MagicMock(pid=12345)
    fake_proc.poll.return_value = None  # 进程还活着
    fake_proc.terminate = mock.MagicMock()
    fake_proc.wait = mock.MagicMock(return_value=0)

    m = local_runtime.LlamaRuntimeManager(chayuan_root=tmp_path)
    m._process = fake_proc
    m._status = local_runtime.RuntimeStatus(state="ready", pid=12345)

    await m.stop()

    fake_proc.terminate.assert_called_once()
    fake_proc.wait.assert_called_once()
    assert m._status.state == "stopped"
    assert m._status.pid is None


@pytest.mark.asyncio
async def test_manager_restart_stop_then_start(tmp_path, monkeypatch):
    """restart() 应该等价于 stop + start"""
    from chayuan.server.model_registry import local_runtime
    services = tmp_path / "services" / "llama-server"
    services.mkdir(parents=True)
    (services / "llama-server.exe").write_bytes(b"stub")
    monkeypatch.setattr(local_runtime, "_INSTALL_SERVICES_DIRS", [tmp_path / "services"])

    fake_resolution = mock.MagicMock(
        missing=[],
        args=["--model", "/tmp/fake.gguf"],
        resolved_models={"chat": "m1"},
        reason="",
    )
    monkeypatch.setattr(local_runtime, "_resolve_args_for", lambda *a, **kw: (fake_resolution, "/tmp/fake.gguf"))

    proc1 = mock.MagicMock(pid=111, poll=mock.MagicMock(return_value=None), wait=mock.MagicMock(return_value=0))
    proc2 = mock.MagicMock(pid=222, poll=mock.MagicMock(return_value=None), wait=mock.MagicMock(return_value=0))
    popen_mock = mock.MagicMock(side_effect=[proc1, proc2])
    monkeypatch.setattr(local_runtime.subprocess, "Popen", popen_mock)
    async def fake_health(url, **kw):
        return mock.MagicMock(status_code=200)
    monkeypatch.setattr(local_runtime, "_probe_health", fake_health)

    m = local_runtime.LlamaRuntimeManager(chayuan_root=tmp_path)
    s1 = await m.start()
    assert s1.pid == 111
    s2 = await m.restart()
    assert s2.pid == 222


def test_get_manager_singleton(tmp_path, monkeypatch):
    """get_manager() 返回 registry 里的 chat manager。"""
    from chayuan.server.model_registry import local_runtime
    from chayuan.server.model_registry import local_runtime_registry as lrr
    monkeypatch.setattr(local_runtime, "_singleton", None)
    monkeypatch.setattr(lrr, "_registry_singleton", None)
    monkeypatch.setattr("chayuan.settings.CHAYUAN_ROOT", str(tmp_path))

    m1 = local_runtime.get_manager()
    m2 = local_runtime.get_manager()
    assert m1 is m2
    assert m1.capability == "chat"


@pytest.mark.asyncio
async def test_manager_start_llama_early_exit_captured(tmp_path, monkeypatch):
    """llama-server spawn 后立即退出(如 AVX2 不支持),stderr 应被捕获到 last_error"""
    from chayuan.server.model_registry import local_runtime
    services = tmp_path / "services" / "llama-server"
    services.mkdir(parents=True)
    (services / "llama-server.exe").write_bytes(b"stub")
    monkeypatch.setattr(local_runtime, "_INSTALL_SERVICES_DIRS", [tmp_path / "services"])

    fake_resolution = mock.MagicMock(
        missing=[],
        args=["--model", "/tmp/fake.gguf"],
        resolved_models={"chat": "fake-chat-model"},
        reason="",
    )
    monkeypatch.setattr(
        local_runtime, "_resolve_args_for",
        lambda *a, **kw: (fake_resolution, "/tmp/fake.gguf"),
    )

    # 进程 spawn 即 exit,stderr 有 AVX2 报错
    fake_proc = mock.MagicMock()
    fake_proc.pid = 12345
    fake_proc.poll = mock.MagicMock(return_value=1)  # 进程已退出
    fake_proc.stderr = mock.MagicMock()
    fake_proc.stderr.read = mock.MagicMock(return_value=b"AVX2 instruction not supported by CPU\n")
    monkeypatch.setattr(local_runtime.subprocess, "Popen", mock.MagicMock(return_value=fake_proc))

    # health 不应被调到(因为 poll 立即捕获)
    health_called = []
    async def fake_health(url, **kw):
        health_called.append(url)
        return mock.MagicMock(status_code=200)
    monkeypatch.setattr(local_runtime, "_probe_health", fake_health)

    m = local_runtime.LlamaRuntimeManager(chayuan_root=tmp_path)
    status = await m.start()

    assert status.state == "failed"
    assert "AVX2" in (status.last_error or "")
    assert health_called == []  # 进程退出后不再探 health


@pytest.mark.asyncio
async def test_manager_start_health_timeout_kills(tmp_path, monkeypatch):
    """/health 60s 内不返 200,start 应 kill 进程并报 failed"""
    from chayuan.server.model_registry import local_runtime
    services = tmp_path / "services" / "llama-server"
    services.mkdir(parents=True)
    (services / "llama-server.exe").write_bytes(b"stub")
    monkeypatch.setattr(local_runtime, "_INSTALL_SERVICES_DIRS", [tmp_path / "services"])

    fake_resolution = mock.MagicMock(
        missing=[],
        args=["--model", "/tmp/fake.gguf"],
        resolved_models={"chat": "fake-chat-model"},
        reason="",
    )
    monkeypatch.setattr(
        local_runtime, "_resolve_args_for",
        lambda *a, **kw: (fake_resolution, "/tmp/fake.gguf"),
    )

    # 进程活着但 health 永远 raise(连不上)
    fake_proc = mock.MagicMock()
    fake_proc.pid = 12345
    fake_proc.poll = mock.MagicMock(return_value=None)
    fake_proc.terminate = mock.MagicMock()
    fake_proc.wait = mock.MagicMock(return_value=0)
    monkeypatch.setattr(local_runtime.subprocess, "Popen", mock.MagicMock(return_value=fake_proc))

    async def fake_health(url, **kw):
        raise ConnectionError("refused")
    monkeypatch.setattr(local_runtime, "_probe_health", fake_health)

    # 把 deadline 拉到 0.3 秒避免测试卡 60s
    monkeypatch.setattr(local_runtime, "HEALTH_READY_TIMEOUT_SEC", 0.3)
    monkeypatch.setattr(local_runtime, "HEALTH_PROBE_INTERVAL_SEC", 0.05)

    m = local_runtime.LlamaRuntimeManager(chayuan_root=tmp_path)
    status = await m.start()

    assert status.state == "failed"
    assert "health" in (status.last_error or "").lower() or "200" in (status.last_error or "")
    # 超时后必须 kill 进程别留尸
    fake_proc.terminate.assert_called_once()


def test_local_runtime_settings_new_capability_fields_defaults():
    """新加的 4 个字段有默认值,旧测试不破。"""
    s = LocalRuntimeSettings()
    assert s.preload_embedding is False
    assert s.preload_rerank is False
    assert s.default_embedding_model == ""
    assert s.default_rerank_model == ""


def test_local_runtime_settings_new_fields_round_trip(tmp_path):
    """新字段 yaml round-trip 正确。"""
    yaml_path = tmp_path / "lr.yaml"
    s = LocalRuntimeSettings(
        preload_embedding=True,
        preload_rerank=True,
        default_embedding_model="bge-small-zh",
        default_rerank_model="bge-rerank-m3",
    )
    s.save(yaml_path)
    s2 = LocalRuntimeSettings.load(yaml_path)
    assert s2.preload_embedding is True
    assert s2.preload_rerank is True
    assert s2.default_embedding_model == "bge-small-zh"
    assert s2.default_rerank_model == "bge-rerank-m3"


def test_local_runtime_settings_old_yaml_compat(tmp_path):
    """没有新字段的旧 yaml 加载时新字段取默认。"""
    yaml_path = tmp_path / "lr.yaml"
    yaml_path.write_text(
        "preload_on_startup: true\nhost: 127.0.0.1\nport: 62582\n",
        encoding="utf-8",
    )
    s = LocalRuntimeSettings.load(yaml_path)
    assert s.preload_embedding is False
    assert s.preload_rerank is False
    assert s.default_embedding_model == ""


def test_manager_capability_defaults_to_chat(tmp_path):
    """构造器不传 capability 时默认 chat (向后兼容)。"""
    from chayuan.server.model_registry.local_runtime import LlamaRuntimeManager
    m = LlamaRuntimeManager(chayuan_root=tmp_path)
    assert m.capability == "chat"
    assert m.port_offset == 0


def test_manager_capability_embedding_uses_port_offset(tmp_path):
    """embedding manager port_offset=1,allocate_port preferred = settings.port + 1。"""
    from chayuan.server.model_registry.local_runtime import LlamaRuntimeManager
    m = LlamaRuntimeManager(chayuan_root=tmp_path, capability="embedding", port_offset=1)
    assert m.capability == "embedding"
    assert m.port_offset == 1


def test_manager_persist_status_uses_capability_key(tmp_path):
    """_persist_status 写 runtime.json 时按 capability 分 key,
    多个 manager 写不互覆盖。"""
    import json
    from chayuan.server.model_registry.local_runtime import LlamaRuntimeManager, RuntimeStatus

    m_chat = LlamaRuntimeManager(chayuan_root=tmp_path, capability="chat", port_offset=0)
    m_embed = LlamaRuntimeManager(chayuan_root=tmp_path, capability="embedding", port_offset=1)

    m_chat._status = RuntimeStatus(state="ready", endpoint="http://127.0.0.1:62582", pid=111)
    m_chat._persist_status()
    m_embed._status = RuntimeStatus(state="ready", endpoint="http://127.0.0.1:62583", pid=222)
    m_embed._persist_status()

    data = json.loads((tmp_path / "runtime.json").read_text(encoding="utf-8"))
    # llama key 下含 chat 和 embedding 两个子 key,不互覆盖
    assert data["llama"]["chat"]["pid"] == 111
    assert data["llama"]["embedding"]["pid"] == 222


def test_manager_find_llama_server_exe_unchanged(tmp_path, monkeypatch):
    """find_llama_server_exe 行为不受 capability 影响。"""
    from chayuan.server.model_registry import local_runtime
    services = tmp_path / "services" / "llama-server"
    services.mkdir(parents=True)
    exe = services / "llama-server.exe"
    exe.write_bytes(b"stub")
    monkeypatch.setattr(local_runtime, "_INSTALL_SERVICES_DIRS", [tmp_path / "services"])

    m_chat = local_runtime.LlamaRuntimeManager(chayuan_root=tmp_path, capability="chat")
    m_embed = local_runtime.LlamaRuntimeManager(chayuan_root=tmp_path, capability="embedding", port_offset=1)
    assert m_chat.find_llama_server_exe() == exe
    assert m_embed.find_llama_server_exe() == exe


@pytest.mark.asyncio
async def test_manager_start_embedding_uses_embedding_resolver(tmp_path, monkeypatch):
    """embedding manager 调 start 时用 resolve_llamacpp_args(capability='embedding')。"""
    from chayuan.server.model_registry import local_runtime as lr
    from chayuan.server.model_registry import process_args

    services = tmp_path / "services" / "llama-server"
    services.mkdir(parents=True)
    (services / "llama-server.exe").write_bytes(b"stub")
    monkeypatch.setattr(lr, "_INSTALL_SERVICES_DIRS", [tmp_path / "services"])

    captured_capability = []

    def fake_resolve(**kw):
        captured_capability.append(kw.get("capability", "<missing>"))
        return process_args.Resolution(
            process="llamacpp",
            args=["--model", "/tmp/embed.gguf", "--embedding", "--pooling", "cls"],
            resolved_models={"embedding": "bge"},
        )

    monkeypatch.setattr(lr.process_args, "resolve_llamacpp_args", fake_resolve)

    # mock Popen + health
    fake_proc = mock.MagicMock(pid=999, poll=mock.MagicMock(return_value=None))
    monkeypatch.setattr(lr.subprocess, "Popen", mock.MagicMock(return_value=fake_proc))
    async def fake_health(url, **kw):
        return mock.MagicMock(status_code=200)
    monkeypatch.setattr(lr, "_probe_health", fake_health)

    m = lr.LlamaRuntimeManager(chayuan_root=tmp_path, capability="embedding", port_offset=1)
    status = await m.start()
    assert status.state == "ready"
    assert captured_capability == ["embedding"]


@pytest.mark.asyncio
async def test_manager_start_rerank_uses_rerank_resolver(tmp_path, monkeypatch):
    """rerank manager 调 start 时用 resolve_llamacpp_args(capability='rerank')。"""
    from chayuan.server.model_registry import local_runtime as lr
    from chayuan.server.model_registry import process_args

    services = tmp_path / "services" / "llama-server"
    services.mkdir(parents=True)
    (services / "llama-server.exe").write_bytes(b"stub")
    monkeypatch.setattr(lr, "_INSTALL_SERVICES_DIRS", [tmp_path / "services"])

    captured = []

    def fake_resolve(**kw):
        captured.append(kw.get("capability"))
        return process_args.Resolution(
            process="llamacpp",
            args=["--model", "/tmp/r.gguf", "--reranking"],
            resolved_models={"rerank": "bge-r"},
        )

    monkeypatch.setattr(lr.process_args, "resolve_llamacpp_args", fake_resolve)

    fake_proc = mock.MagicMock(pid=888, poll=mock.MagicMock(return_value=None))
    monkeypatch.setattr(lr.subprocess, "Popen", mock.MagicMock(return_value=fake_proc))
    async def fake_health(url, **kw):
        return mock.MagicMock(status_code=200)
    monkeypatch.setattr(lr, "_probe_health", fake_health)

    m = lr.LlamaRuntimeManager(chayuan_root=tmp_path, capability="rerank", port_offset=2)
    status = await m.start()
    assert status.state == "ready"
    assert "rerank" in captured


def test_sidecar_runtime_manager_default_engine_is_llama(tmp_path):
    """SidecarRuntimeManager 默认 engine='llama'(向后兼容)。"""
    from chayuan.server.model_registry.local_runtime import SidecarRuntimeManager
    m = SidecarRuntimeManager(chayuan_root=tmp_path)
    assert m.engine == "llama"
    assert m.capability == "chat"


def test_sidecar_runtime_manager_whisper_engine(tmp_path):
    """SidecarRuntimeManager(engine='whisper') 字段正确。"""
    from chayuan.server.model_registry.local_runtime import SidecarRuntimeManager
    m = SidecarRuntimeManager(
        chayuan_root=tmp_path, engine="whisper", capability="asr", port_offset=3
    )
    assert m.engine == "whisper"
    assert m.capability == "asr"
    assert m.port_offset == 3


def test_llama_runtime_manager_alias_inherits_sidecar(tmp_path):
    """LlamaRuntimeManager 是 SidecarRuntimeManager 子类,默认 engine='llama'。"""
    from chayuan.server.model_registry.local_runtime import (
        LlamaRuntimeManager, SidecarRuntimeManager,
    )
    m = LlamaRuntimeManager(chayuan_root=tmp_path)
    assert isinstance(m, SidecarRuntimeManager)
    assert m.engine == "llama"


def test_llama_runtime_manager_alias_with_capability_kw(tmp_path):
    """Plan 3B 已有写法 LlamaRuntimeManager(chayuan_root=..., capability='embedding', port_offset=1) 仍 work。"""
    from chayuan.server.model_registry.local_runtime import LlamaRuntimeManager
    m = LlamaRuntimeManager(chayuan_root=tmp_path, capability="embedding", port_offset=1)
    assert m.engine == "llama"
    assert m.capability == "embedding"
    assert m.port_offset == 1


# ---------------------------------------------------------------------------
# Plan 3C Task 3: find_server_exe 按 engine 找 binary
# ---------------------------------------------------------------------------

def test_find_server_exe_llama_engine(tmp_path, monkeypatch):
    """engine='llama' 找 llama-server[.exe]。"""
    from chayuan.server.model_registry import local_runtime as lr
    services = tmp_path / "services" / "llama-server"
    services.mkdir(parents=True)
    exe = services / "llama-server.exe"
    exe.write_bytes(b"stub")
    monkeypatch.setattr(lr, "_INSTALL_SERVICES_DIRS", [tmp_path / "services"])

    m = lr.SidecarRuntimeManager(chayuan_root=tmp_path, engine="llama")
    assert m.find_server_exe() == exe


def test_find_server_exe_whisper_engine(tmp_path, monkeypatch):
    """engine='whisper' 找 whisper-server[.exe]。"""
    from chayuan.server.model_registry import local_runtime as lr
    services = tmp_path / "services" / "whisper-server"
    services.mkdir(parents=True)
    exe = services / "whisper-server.exe"
    exe.write_bytes(b"stub")
    monkeypatch.setattr(lr, "_INSTALL_SERVICES_DIRS", [tmp_path / "services"])

    m = lr.SidecarRuntimeManager(chayuan_root=tmp_path, engine="whisper", capability="asr", port_offset=3)
    assert m.find_server_exe() == exe


def test_find_server_exe_missing_returns_none(tmp_path, monkeypatch):
    """vendor 目录里没装,返回 None。"""
    from chayuan.server.model_registry import local_runtime as lr
    monkeypatch.setattr(lr, "_INSTALL_SERVICES_DIRS", [tmp_path / "services"])
    m = lr.SidecarRuntimeManager(chayuan_root=tmp_path, engine="whisper")
    assert m.find_server_exe() is None


def test_find_llama_server_exe_back_compat(tmp_path, monkeypatch):
    """Plan 3B 已有 find_llama_server_exe 方法名,保留可调(返同一结果)。"""
    from chayuan.server.model_registry import local_runtime as lr
    services = tmp_path / "services" / "llama-server"
    services.mkdir(parents=True)
    exe = services / "llama-server.exe"
    exe.write_bytes(b"stub")
    monkeypatch.setattr(lr, "_INSTALL_SERVICES_DIRS", [tmp_path / "services"])

    m = lr.LlamaRuntimeManager(chayuan_root=tmp_path)
    assert m.find_llama_server_exe() == exe
    assert m.find_server_exe() == exe


# ---------------------------------------------------------------------------
# Plan 3C Task 4: _resolve_args_for 按 engine 派发 + start() 传 self.engine
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_sidecar_whisper_start_uses_whisper_resolver(tmp_path, monkeypatch):
    """engine='whisper' 启动时调 resolve_whisper_args(capability='asr')。"""
    from chayuan.server.model_registry import local_runtime as lr
    from chayuan.server.model_registry import process_args

    services = tmp_path / "services" / "whisper-server"
    services.mkdir(parents=True)
    (services / "whisper-server.exe").write_bytes(b"stub")
    monkeypatch.setattr(lr, "_INSTALL_SERVICES_DIRS", [tmp_path / "services"])

    captured = []

    def fake_whisper_resolve(**kw):
        captured.append(("whisper", kw.get("capability", "<missing>")))
        return process_args.Resolution(
            process="whispercpp",
            args=["--model", "/tmp/ggml-tiny.bin"],
            resolved_models={"asr": "whisper-tiny"},
        )

    monkeypatch.setattr(lr.process_args, "resolve_whisper_args", fake_whisper_resolve)

    fake_proc = mock.MagicMock(pid=777, poll=mock.MagicMock(return_value=None))
    monkeypatch.setattr(lr.subprocess, "Popen", mock.MagicMock(return_value=fake_proc))
    async def fake_health(url, **kw):
        return mock.MagicMock(status_code=200)
    monkeypatch.setattr(lr, "_probe_health", fake_health)

    m = lr.SidecarRuntimeManager(chayuan_root=tmp_path, engine="whisper", capability="asr", port_offset=3)
    status = await m.start()
    assert status.state == "ready"
    assert captured == [("whisper", "asr")]


@pytest.mark.asyncio
async def test_sidecar_llama_start_still_uses_llama_resolver(tmp_path, monkeypatch):
    """engine='llama'(Plan 3B 行为)仍走 resolve_llamacpp_args。"""
    from chayuan.server.model_registry import local_runtime as lr
    from chayuan.server.model_registry import process_args

    services = tmp_path / "services" / "llama-server"
    services.mkdir(parents=True)
    (services / "llama-server.exe").write_bytes(b"stub")
    monkeypatch.setattr(lr, "_INSTALL_SERVICES_DIRS", [tmp_path / "services"])

    captured = []
    monkeypatch.setattr(
        lr.process_args, "resolve_llamacpp_args",
        lambda **kw: (captured.append(("llama", kw.get("capability"))), process_args.Resolution(
            process="llamacpp",
            args=["--model", "/tmp/qwen.gguf", "--ctx-size", "8192"],
            resolved_models={"chat": "qwen"},
        ))[1],
    )

    fake_proc = mock.MagicMock(pid=111, poll=mock.MagicMock(return_value=None))
    monkeypatch.setattr(lr.subprocess, "Popen", mock.MagicMock(return_value=fake_proc))
    async def fake_health(url, **kw):
        return mock.MagicMock(status_code=200)
    monkeypatch.setattr(lr, "_probe_health", fake_health)

    m = lr.SidecarRuntimeManager(chayuan_root=tmp_path, engine="llama", capability="chat")
    status = await m.start()
    assert status.state == "ready"
    assert captured == [("llama", "chat")]


def test_local_runtime_settings_asr_fields_defaults():
    """Plan 3C: preload_asr / default_asr_model 默认值。"""
    s = LocalRuntimeSettings()
    assert s.preload_asr is False
    assert s.default_asr_model == ""


def test_local_runtime_settings_asr_round_trip(tmp_path):
    """Plan 3C: asr 字段 yaml round-trip。"""
    yaml_path = tmp_path / "lr.yaml"
    s = LocalRuntimeSettings(preload_asr=True, default_asr_model="whisper-tiny")
    s.save(yaml_path)
    s2 = LocalRuntimeSettings.load(yaml_path)
    assert s2.preload_asr is True
    assert s2.default_asr_model == "whisper-tiny"


def test_local_runtime_settings_old_yaml_no_asr_field(tmp_path):
    """Plan 3B 写的 yaml(无 asr 字段)加载时 asr 取默认值。"""
    yaml_path = tmp_path / "lr.yaml"
    yaml_path.write_text(
        "preload_on_startup: true\nhost: 127.0.0.1\nport: 62582\n"
        "preload_embedding: false\npreload_rerank: false\n",
        encoding="utf-8",
    )
    s = LocalRuntimeSettings.load(yaml_path)
    assert s.preload_asr is False
    assert s.default_asr_model == ""


# ---------------------------------------------------------------------------
# Plan 3D Task 2: find_server_exe(engine='infinity') 返 sys.executable
# ---------------------------------------------------------------------------

def test_find_server_exe_infinity_engine_returns_python(tmp_path):
    """engine='infinity' find_server_exe 返 sys.executable(Python 解释器)。"""
    import sys
    from chayuan.server.model_registry.local_runtime import SidecarRuntimeManager
    m = SidecarRuntimeManager(
        chayuan_root=tmp_path, engine="infinity", capability="image-embedding", port_offset=4
    )
    exe = m.find_server_exe()
    assert exe is not None
    assert exe == Path(sys.executable)


def test_find_server_exe_infinity_not_affected_by_install_dirs(tmp_path, monkeypatch):
    """engine='infinity' 不查 _INSTALL_SERVICES_DIRS,直接用 sys.executable。"""
    from chayuan.server.model_registry import local_runtime as lr
    # 即使 install dirs 为空,infinity 也能返 python 解释器
    monkeypatch.setattr(lr, "_INSTALL_SERVICES_DIRS", [tmp_path / "nonexistent"])
    m = lr.SidecarRuntimeManager(chayuan_root=tmp_path, engine="infinity", port_offset=4)
    exe = m.find_server_exe()
    assert exe is not None
