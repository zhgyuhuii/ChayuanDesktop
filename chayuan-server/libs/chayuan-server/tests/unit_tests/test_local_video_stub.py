"""LocalVideoConnector(P1 桩) 单元测试。

验证:
  - (T2V, "local") 注册表查得到
  - generate() yield 至少一个 error 事件,且携带 code=local_video_runtime_not_installed
"""
from __future__ import annotations

import pytest

from chayuan.server.modality.router.protocol import Capability, GenerateReq


async def test_local_t2v_yields_not_implemented_error():
    # 触发注册
    from chayuan.server.modality.router.connectors.video_gen import local_stub  # noqa: F401
    from chayuan.server.modality.router.connectors.video_gen.local_stub import LocalVideoConnector

    req = GenerateReq(
        capability=Capability.T2V,
        model="local-ltx-video",
        platform_name="local",
        platform_type="local",
        api_base="",
        api_key="",
        prompt="a cat walking in the park",
    )
    events = [ev async for ev in LocalVideoConnector().generate(req)]
    assert len(events) >= 1
    error_events = [ev for ev in events if ev.get("type") == "error"]
    assert error_events, f"期望至少一个 error 事件,实际得到: {events}"
    assert error_events[0].get("code") == "local_video_runtime_not_installed"


async def test_local_t2v_registered_in_connector_table():
    # 确认注册表里有 (T2V, "local")
    from chayuan.server.modality.router.connectors.video_gen import local_stub  # noqa: F401
    from chayuan.server.modality.router.connectors.base import get_connector

    cls = get_connector(Capability.T2V, "local")
    assert cls is not None, "(T2V, 'local') 未在注册表中找到"
    from chayuan.server.modality.router.connectors.video_gen.local_stub import LocalVideoConnector
    assert cls is LocalVideoConnector
