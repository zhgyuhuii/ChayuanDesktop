from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Dict, List

from fastapi import APIRouter, Body, Query, Request

from chayuan.server.utils import BaseResponse, get_tool, get_tool_config
from chayuan.utils import build_logger


logger = build_logger()

tool_router = APIRouter(prefix="/tools", tags=["Toolkits"])


@lru_cache(maxsize=1)
def _umbrella_map() -> Dict[str, str]:
    """返回 ``运行时工具名 -> yaml 里的伞型 key`` 映射。

    读取内置 ``chayuan/data/tools_catalog.json``：当某条目里声明 ``register_as``
    列表时，里面每个工具都 gate 到该卡片的 ``key`` 上。常见例子：
    ``amap`` 卡片管理 ``amap_poi_search / amap_weather`` 两个运行时工具。

    找不到文件或 key 时返回空 dict；缓存一次即可。
    """
    try:
        import chayuan as _c

        path = Path(_c.__file__).resolve().parent / "data" / "tools_catalog.json"
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:  # noqa: BLE001
        return {}

    out: Dict[str, str] = {}
    for t in data.get("tools") or []:
        umbrella = t.get("key")
        for child in (t.get("register_as") or []) or []:
            if umbrella and child:
                out[str(child)] = str(umbrella)
    return out


def _effective_config_key(tool_name: str) -> str:
    """给定运行时工具名，返回它在 ``tool_settings.yaml`` 里的配置 key。"""
    return _umbrella_map().get(tool_name, tool_name)


@tool_router.get("", response_model=BaseResponse)
async def list_tools(
    enabled: bool = Query(
        False,
        description="只返回 tool_settings.yaml 里 use=true 的工具；对话界面默认传 true。",
    ),
):
    """返回可用工具清单。

    - ``enabled=false``（默认）：沿用旧行为，列出所有已注册工具，适合运维排查；
    - ``enabled=true``：只返回 ``tool_settings.yaml`` 中 ``use: true`` 的工具，
      供对话界面「选择工具」下拉使用——关闭的工具不再展示给终端用户。

    伞型工具（如 ``amap_poi_search / amap_weather`` 共用 ``amap`` 配置）通过
    目录 JSON 里的 ``register_as`` 字段映射到伞型 key，再读 ``use``。
    """
    tools = get_tool()
    data = {}
    for t in tools.values():
        cfg_key = _effective_config_key(t.name)
        cfg = get_tool_config(cfg_key) or {}
        if enabled and not bool(cfg.get("use", False)):
            continue
        data[t.name] = {
            "name": t.name,
            "title": getattr(t, "title", t.name),
            "description": t.description,
            "args": t.args,
            "config": cfg,
        }
    return {"data": data}


@tool_router.post("/call", response_model=BaseResponse)
async def call_tool(
    name: str = Body(examples=["calculate"]),
    tool_input: dict = Body({}, examples=[{"text": "3+5/2"}]),
):
    import time
    from chayuan.server.observability.metrics import record_tool_call

    t0 = time.perf_counter()
    status = "error"
    try:
        if tool := get_tool(name):
            try:
                result = await tool.ainvoke(tool_input)
                status = "success"
                return {"data": result}
            except Exception:
                msg = f"failed to call tool '{name}'"
                logger.exception(msg)
                return {"code": 500, "msg": msg}
        else:
            status = "not_found"
            return {"code": 500, "msg": f"no tool named '{name}'"}
    finally:
        record_tool_call(name, status, time.perf_counter() - t0)
