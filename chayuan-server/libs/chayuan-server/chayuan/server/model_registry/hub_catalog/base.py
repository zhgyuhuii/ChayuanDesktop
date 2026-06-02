"""Hub 归一契约（Pydantic v2）+ 适配器抽象基类。

* :class:`HubFile` —— detail 接口返回的单文件。
* :class:`NormalizedModelCard` —— 跨 HF / ModelScope 统一的模型卡。
* :class:`SearchPage` —— 分页搜索结果。
* :class:`HubAdapter` —— 适配器抽象基类（HuggingFace / ModelScope 各实现一份）。
"""
from __future__ import annotations

import abc
from typing import List, Optional

from pydantic import BaseModel, Field


class HubFile(BaseModel):
    """模型仓库里的一个文件（来自 detail/tree 接口）。"""

    rfilename: str
    size_bytes: Optional[int] = None
    runnable: bool = False


class NormalizedModelCard(BaseModel):
    """跨 Hub 统一的模型卡。

    Attributes:
        source: ``"huggingface"`` / ``"modelscope"``。
        model_id: ``owner/repo`` 形式。
        display_name: 展示名（HF 取 repo 名，MS 优先 ChineseName）。
        owner: 所有者 / 组织。
        capability: identifier 对齐的 capability（``chat`` / ``text-embedding`` / ...）。
        param_size: 如 ``"7B"``；解析不出为 None。
        file_size_bytes: 列表页通常为 None（需 detail 求和）。
        format: 主要权重格式（如 ``"gguf"``）；未知 None。
        runnable: 是否可被本地引擎直接跑（gguf/onnx）。
        serveable: capability 是否在可服务集合内（text-to-image/video 等为 False）。
        downloads / likes: 热度。
        updated_at: ISO-8601 字符串（MS 的 unix 时间会被转成 ISO）。
        tags: 自由标签。
        installed: 本地是否已安装（由上层填充，默认 False）。
    """

    source: str
    model_id: str
    display_name: str
    owner: str
    capability: str
    param_size: Optional[str] = None
    file_size_bytes: Optional[int] = None
    format: Optional[str] = None
    runnable: bool = False
    serveable: bool = True
    downloads: int = 0
    likes: int = 0
    updated_at: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    installed: bool = False


class SearchPage(BaseModel):
    """分页搜索结果。"""

    items: List[NormalizedModelCard] = Field(default_factory=list)
    page: int = 1
    page_size: int = 20
    has_more: bool = False
    total: Optional[int] = None


class HubAdapter(abc.ABC):
    """Hub 适配器抽象基类。

    子类实现具体 Hub 的搜索 / 详情接口，统一返回归一结构。
    """

    @abc.abstractmethod
    def search(
        self,
        *,
        query: Optional[str] = None,
        capability: Optional[str] = None,
        runnable_only: bool = False,
        page: int = 1,
        page_size: int = 20,
        route: Optional[str] = None,
        token: Optional[str] = None,
        sort: str = "downloads",
    ) -> SearchPage:
        """搜索模型，返回一页 :class:`NormalizedModelCard`。

        ``sort``：``"downloads"``（默认，按下载量）/ ``"updated"``（按最近更新）。
        不支持 ``updated`` 的源（如 ModelScope）按下载量返回并由上层兜底排序。
        """
        raise NotImplementedError

    @abc.abstractmethod
    def detail(
        self,
        *,
        model_id: str,
        revision: Optional[str] = None,
        route: Optional[str] = None,
        token: Optional[str] = None,
    ) -> List[HubFile]:
        """返回该模型仓库的文件清单。"""
        raise NotImplementedError

    @abc.abstractmethod
    def readme(
        self,
        *,
        model_id: str,
        route: Optional[str] = None,
        token: Optional[str] = None,
    ) -> str:
        """返回该模型仓库的 README（Markdown 源文本）。

        取不到（仓库无 README / 不可达 / 鉴权失败等）一律返回空串 ""，
        交由上层「无 README」处理，不抛异常打断 UI。
        """
        raise NotImplementedError


__all__ = [
    "HubFile",
    "NormalizedModelCard",
    "SearchPage",
    "HubAdapter",
]
