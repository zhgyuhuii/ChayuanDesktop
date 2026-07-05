"""#21 Nacos 服务注册发现 + 配置中心 provider（契约/映射，mock httpx）。

后台可切"服务发现/配置源 = 内置 | Nacos"。逻辑句柄(reverse-WS session/subject)非 IP，
经 metadata 携带（支撑 OpenFeign-by-service-name，§6.23）。真注册需 Nacos，端到端留冒烟。
"""

import json

import pytest

from chacmd.interfaces.nacos_registry import (
    NacosConfigSource,
    NacosServiceRegistry,
    select_registry,
)
from chacmd.interfaces.registry import InProcessServiceRegistry, ServiceInstance


class _Resp:
    def __init__(self, data):
        self._d = data

    def json(self):
        return self._d

    def raise_for_status(self):
        pass


class _FakeHttp:
    def __init__(self, list_hosts=None, config_text=None):
        self.calls = []
        self._hosts = list_hosts or []
        self._config = config_text

    async def post(self, url, params=None):
        self.calls.append(("POST", url, params))
        return _Resp({})

    async def delete(self, url, params=None):
        self.calls.append(("DELETE", url, params))
        return _Resp({})

    async def get(self, url, params=None):
        self.calls.append(("GET", url, params))
        if "configs" in url:
            return _Resp(self._config)
        return _Resp({"hosts": self._hosts})


@pytest.mark.asyncio
async def test_register_constructs_nacos_call_with_handle_in_metadata():
    http = _FakeHttp()
    reg = NacosServiceRegistry(http, namespace="deptA", group="G1")
    await reg.register(ServiceInstance(name="orchestrator", handle="sess-123", meta={"port": 8100}))
    method, url, params = http.calls[0]
    assert method == "POST"
    assert "/ns/instance" in url
    assert params["serviceName"] == "orchestrator"
    assert params["namespaceId"] == "deptA"
    assert params["groupName"] == "G1"
    assert json.loads(params["metadata"])["handle"] == "sess-123"


@pytest.mark.asyncio
async def test_resolve_parses_hosts_to_instances():
    http = _FakeHttp(list_hosts=[{"ip": "logical", "port": 8100, "metadata": {"handle": "sess-9"}}])
    reg = NacosServiceRegistry(http, namespace="public")
    got = await reg.resolve("orchestrator")
    assert len(got) == 1
    assert got[0].handle == "sess-9"
    assert got[0].name == "orchestrator"


@pytest.mark.asyncio
async def test_deregister_uses_handle_as_ip():
    http = _FakeHttp()
    reg = NacosServiceRegistry(http)
    await reg.deregister("orchestrator", "sess-123")
    method, url, params = http.calls[0]
    assert method == "DELETE"
    assert params["ip"] == "sess-123"


@pytest.mark.asyncio
async def test_config_source_loads_and_gets():
    http = _FakeHttp(config_text=json.dumps({"budget": 1000}))
    cfg = NacosConfigSource(http, namespace="deptA")
    assert cfg.get("budget", 0) == 0  # 未 load 前回 default
    await cfg.load("chacmd.yaml", group="G1")
    assert cfg.get("budget") == 1000


@pytest.mark.asyncio
async def test_switch_builtin_vs_nacos():
    # 后台开关：builtin → InProcess；nacos → Nacos
    builtin = select_registry("builtin")
    assert isinstance(builtin, InProcessServiceRegistry)
    nacos = select_registry("nacos", http=_FakeHttp(), namespace="public")
    assert isinstance(nacos, NacosServiceRegistry)
    # 切回内置仍可用
    await builtin.register(ServiceInstance("svc", "h1"))
    assert (await builtin.resolve("svc"))[0].handle == "h1"
