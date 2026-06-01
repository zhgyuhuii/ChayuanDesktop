"""「模型广场」Hub 搜索 / 详情 HTTP 端点（``/v1/model-hub/*``）。

把 :mod:`chayuan.server.model_registry.hub_catalog` 的归一适配器
（HuggingFace / ModelScope）暴露成只读查询接口，供前端模型广场消费。

设计要点：
* **路由无关**：本模块只做协议适配（参数 -> 适配器调用 -> pydantic 序列化），
  搜索 / 解析 / 归一逻辑全在 hub_catalog 包内，不在这里堆业务。
* **单源错误隔离**：任一 Hub 不可达 / 接口变更时，适配器抛的异常在此被收敛成
  ``502``（``detail`` 带 source 名），不让 httpx / 上游栈直接冒泡成 500。
* ``installed`` 字段此刻保持适配器默认（False）；本地安装态由 P2 上层填充，
  这里不做安装态查询。
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from chayuan.server.model_registry.hub_catalog import HubFile, SearchPage
from chayuan.server.model_registry.hub_catalog.base import HubAdapter
from chayuan.server.model_registry.hub_catalog.huggingface import HuggingFaceAdapter
from chayuan.server.model_registry.hub_catalog.modelscope import ModelScopeAdapter

model_hub_router = APIRouter(prefix="/v1/model-hub", tags=["ModelHub"])


def _adapter(source: str) -> HubAdapter:
    """按 source 返回对应 Hub 适配器实例；未知 source 抛 400。"""
    if source == "modelscope":
        return ModelScopeAdapter()
    if source == "huggingface":
        return HuggingFaceAdapter()
    raise HTTPException(
        status_code=400,
        detail=f"未知模型源: {source!r}（仅支持 'modelscope' / 'huggingface'）",
    )


@model_hub_router.get("/search", response_model=SearchPage, summary="搜索 Hub 模型")
def search_models(
    source: str = Query(..., description="模型源：modelscope / huggingface"),
    query: str = Query("", description="关键字（空表示按热度浏览）"),
    capability: Optional[str] = Query(None, description="按 capability 过滤，如 chat / text-embedding"),
    runnable_only: bool = Query(True, description="只返回本地引擎可直接跑的模型（gguf/onnx）"),
    page: int = Query(1, ge=1, description="页码，从 1 开始"),
    page_size: int = Query(20, ge=1, le=100, description="每页条数"),
    route: str = Query("mirror", description="HF 线路：mirror / official；ModelScope 忽略"),
    token: Optional[str] = Query(None, description="可选鉴权 token（私有 / 限流）"),
) -> SearchPage:
    """搜索某个 Hub 的模型，返回一页归一模型卡。"""
    adapter = _adapter(source)
    try:
        page_result = adapter.search(
            query=query,
            capability=capability,
            runnable_only=runnable_only,
            page=page,
            page_size=page_size,
            route=route,
            token=token,
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — 单源错误隔离：收敛成 502，不让上游栈冒泡
        raise HTTPException(status_code=502, detail=f"{source} 源不可达: {e}")

    # P2 Task 2.2:用本地 manifest origin 扫描出的「已安装集合」回填 installed。
    # 扫盘失败不应让搜索 502 —— installed 仅是 UI 辅助,异常时退化为全 False。
    try:
        from chayuan.server.model_registry.hub_catalog.installed import (
            installed_repo_set,
            mark_installed,
        )
        mark_installed(page_result.items, installed_repo_set())
    except Exception as e:  # noqa: BLE001 — 已安装态填充失败不阻塞搜索
        # 不污染响应,只记日志(搜索结果 installed 保持适配器默认 False)
        import logging
        logging.getLogger("chayuan.api_server.model_hub_routes").warning(
            "[model-hub] 填充 installed 失败(不阻塞): %r", e
        )
    return page_result


@model_hub_router.get("/detail", response_model=List[HubFile], summary="Hub 模型文件清单")
def model_detail(
    source: str = Query(..., description="模型源：modelscope / huggingface"),
    model_id: str = Query(..., description="owner/repo 形式的模型 id"),
    revision: Optional[str] = Query(None, description="分支 / 版本；None 取默认"),
    route: str = Query("mirror", description="HF 线路：mirror / official；ModelScope 忽略"),
    token: Optional[str] = Query(None, description="可选鉴权 token"),
) -> List[HubFile]:
    """返回该模型仓库的文件清单（含 runnable 判定）。"""
    adapter = _adapter(source)
    try:
        return adapter.detail(
            model_id=model_id,
            revision=revision,
            route=route,
            token=token,
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 — 单源错误隔离：收敛成 502
        raise HTTPException(status_code=502, detail=f"{source} 源不可达: {e}")
