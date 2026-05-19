"""Connector ABC + 注册表。

Connector 是 ``(capability, platform_type)`` 对应的协议适配器;一个 Connector
只懂一种上游协议形态(如 DashScope native multimodal-generation,
OpenAI /v1/images/generations,字节 visual.volcengineapi.com 等)。

Router 在 dispatch 时按 ``get_connector(cap, platform_type)`` 查表;
未注册 → router 返友好错误,不打上游。

设计要点
--------
- **无状态实例**:Connector 不持长连接;httpx.AsyncClient 通过 caller 注入
  (router 持单例池,所有 Connector 共享,享受 keep-alive + HTTP/2)
- **取消信号**:Connector 在长循环 / 轮询里 check ``req.cancelled.is_set()``
- **错误翻译**:Connector 抛出的异常由 router 兜底翻译;Connector 也可
  自己 yield ``error_event`` 给更精准的提示
- **流式**:``generate`` 是 ``AsyncIterator[dict]``,每个 dict 是一个 v5 事件
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import AsyncIterator, Dict, Optional, Tuple, Type

from chayuan.server.modality.router.protocol import Capability, GenerateReq

logger = logging.getLogger("chayuan.modality.connectors")


# ──────────────────────────────────────────────────────────────
# Connector 抽象基类
# ──────────────────────────────────────────────────────────────


class Connector(ABC):
    """单个 ``(capability, platform_type)`` 的协议适配器。

    子类必须设 ``capability`` 和 ``platform_type`` 两个类属性,然后实现
    ``generate``。可选实现 ``cancel`` / ``estimate_cost``。
    """

    capability: Capability = Capability.CHAT
    platform_type: str = "*"

    @abstractmethod
    async def generate(self, req: GenerateReq) -> AsyncIterator[Dict]:
        """执行生成,yield Vercel v5 事件(纯 dict)。

        典型流程(以 t2i 为例):
            yield text_start("0")
            # 调上游 → 拿 image bytes
            saved = artifacts.save_bytes(img, "image/png")
            yield file_part("image/png", saved["url"], {"width": w, "height": h, "sha256": saved["sha256"]})
            yield text_end("0")
            yield finish_step_event()
        """
        if False:
            yield  # pragma: no cover  - make this an async generator
        raise NotImplementedError

    async def cancel(self, task_id: str) -> None:
        """可选:取消异步任务(t2v 需要)。"""
        return

    async def estimate_cost(self, req: GenerateReq) -> Optional[Dict]:
        """可选:估算单次调用成本(同步返回)。返 ``None`` 表示不支持估算。"""
        return None


# ──────────────────────────────────────────────────────────────
# 注册表(模块加载时被 @register 装饰器写入)
# ──────────────────────────────────────────────────────────────

_CONNECTORS: Dict[Tuple[Capability, str], Type[Connector]] = {}


def register(cap: Capability, platform_type: str):
    """``@register(Capability.T2I, 'dashscope')`` — 在类定义时落表。

    ``platform_type='*'`` 是通配,优先级低于具体匹配。
    """
    def deco(cls: Type[Connector]) -> Type[Connector]:
        key = (cap, platform_type)
        if key in _CONNECTORS and _CONNECTORS[key] is not cls:
            logger.warning(
                "[connectors] %s/%s 已注册为 %s,正在被 %s 覆盖",
                cap.value, platform_type, _CONNECTORS[key].__name__, cls.__name__,
            )
        _CONNECTORS[key] = cls
        # 反向写到类上方便调试 / 日志
        cls.capability = cap
        cls.platform_type = platform_type
        logger.debug("[connectors] registered %s/%s → %s", cap.value, platform_type, cls.__name__)
        return cls
    return deco


def get_connector(cap: Capability, platform_type: str) -> Optional[Type[Connector]]:
    """查表:精确匹配优先,落空时退化到通配 ``*``,再落空返 None。"""
    cls = _CONNECTORS.get((cap, platform_type))
    if cls is not None:
        return cls
    return _CONNECTORS.get((cap, "*"))


def list_registered() -> Dict[Tuple[Capability, str], Type[Connector]]:
    """给 admin / 诊断接口看当前都注册了什么。"""
    return dict(_CONNECTORS)
