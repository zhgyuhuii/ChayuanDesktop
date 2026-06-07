"""HuggingFace Hub 适配器。

实测接口（见 docs/superpowers/notes/2026-06-02-hub-api-probe.md）：
* 搜索：``GET /api/models?search=&sort=downloads&direction=-1&limit=&offset=&full=false``
  - 返回顶层 JSON 数组；每项含 ``id`` / ``pipeline_tag`` / ``siblings[{rfilename}]`` 等。
  - ``siblings`` 无 size，文件大小要走 tree 接口。
  - 分页用原生 ``offset``（实测 HF 支持 limit+offset）。
* 文件树：``GET /api/models/{model_id}/tree/{revision}?recursive=true``
  - 每项 ``path`` / ``type`` / ``size`` / ``lfs``；取大小 ``lfs.size if lfs else size``。

route：``"mirror"``（默认，hf-mirror.com）/ ``"official"``（huggingface.co）。
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from chayuan.server.model_registry.hub_catalog import _SERVEABLE_CAPS
from chayuan.server.model_registry.hub_catalog.base import (
    HubAdapter,
    HubFile,
    NormalizedModelCard,
    SearchPage,
)
from chayuan.server.model_registry.hub_catalog.capability import (
    capability_from_hf_pipeline,
    is_runnable_format,
    parse_param_size,
    parse_param_size_from_tags,
)

_HOST_MIRROR = "https://hf-mirror.com"
_HOST_OFFICIAL = "https://huggingface.co"

# capability -> 一个代表性 pipeline_tag，用于服务端按能力过滤（可选）。
_CAP_TO_PIPELINE = {
    "chat": "text-generation",
    "text-embedding": "feature-extraction",
    "rerank": "text-ranking",
    "image-to-text": "image-text-to-text",
    "text-to-image": "text-to-image",
    "text-to-video": "text-to-video",
    "text-to-audio": "text-to-speech",
    "speech-to-text": "automatic-speech-recognition",
    "image-embedding": "image-feature-extraction",
}


def _ext(path: str) -> str:
    base = path.rsplit("/", 1)[-1]
    dot = base.rfind(".")
    return base[dot:].lower() if dot >= 0 else ""


class HuggingFaceAdapter(HubAdapter):
    """HuggingFace 归一适配器。"""

    def _host(self, route: Optional[str]) -> str:
        return _HOST_OFFICIAL if route == "official" else _HOST_MIRROR

    def _get_json(self, url: str, *, token: Optional[str] = None, **kw: Any) -> Any:
        """单独抽出便于单测 monkeypatch（不联网时整体替换此方法）。"""
        import httpx

        headers: Dict[str, str] = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        params = kw.pop("params", None)
        resp = httpx.get(
            url,
            params=params,
            headers=headers,
            follow_redirects=True,
            timeout=10,
            **kw,
        )
        resp.raise_for_status()
        return resp.json()

    def _get_text(self, url: str, *, token: Optional[str] = None, **kw: Any) -> str:
        """GET 纯文本（README raw 用），抽出便于单测 monkeypatch。"""
        import httpx

        headers: Dict[str, str] = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        resp = httpx.get(url, headers=headers, follow_redirects=True, timeout=10, **kw)
        resp.raise_for_status()
        return resp.text

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
        host = self._host(route)
        page = max(1, int(page or 1))
        page_size = max(1, int(page_size or 20))

        # HF 的 offset 实测已失效(每页都返回相同 top；HF 仅支持 Link 头 cursor 游标),
        # 但 limit 无上限。故改为「一次取 page*page_size+1 条、本地切到第 page 页」:
        # 既避开坏掉的 offset,又不必把 cursor 契约透到前端(模型广场浏览深度浅,够用)。
        offset = (page - 1) * page_size
        fetch_limit = page * page_size + 1

        # HF 原生支持 sort=downloads / sort=lastModified（实测）。
        hf_sort = "lastModified" if sort == "updated" else "downloads"
        params: Dict[str, Any] = {
            "sort": hf_sort,
            "direction": -1,
            "limit": fetch_limit,
            "full": "false",
        }
        if query:
            params["search"] = query
        # 按类型(capability)服务端过滤:**无论 runnable_only 都下发 pipeline_tag**。
        # 不再用 filter=gguf 顶替 pipeline_tag —— 嵌入/重排/语音的 gguf 仓极少,
        # 强制 gguf 会把这些类目筛空(这正是「点了类型一片空白」的元凶);
        # 可运行性留到 detail/下载阶段按实际文件后缀判定。
        if capability and capability in _CAP_TO_PIPELINE:
            params["pipeline_tag"] = _CAP_TO_PIPELINE[capability]

        data = self._get_json(f"{host}/api/models", params=params, token=token)
        rows = data if isinstance(data, list) else []

        window = rows[offset : offset + page_size]
        items: List[NormalizedModelCard] = [self._normalize(r) for r in window]

        return SearchPage(
            items=items,
            page=page,
            page_size=page_size,
            has_more=len(rows) > offset + page_size,
            total=None,
        )

    def _normalize(self, r: Dict[str, Any]) -> NormalizedModelCard:
        model_id = str(r.get("id") or r.get("modelId") or "")
        owner = model_id.split("/")[0] if "/" in model_id else (r.get("author") or "")
        display_name = model_id.split("/")[-1] if model_id else (r.get("author") or "")
        pipeline_tag = r.get("pipeline_tag")
        capability = capability_from_hf_pipeline(pipeline_tag)

        siblings = r.get("siblings") or []
        exts = []
        for s in siblings:
            rf = (s or {}).get("rfilename") if isinstance(s, dict) else None
            if rf:
                exts.append(_ext(rf))
        runnable = is_runnable_format(exts)
        # 主格式：可跑后缀优先，否则取出现过的第一个有意义后缀。
        fmt: Optional[str] = None
        for cand in (".gguf", ".onnx", ".safetensors"):
            if cand in exts:
                fmt = cand.lstrip(".")
                break

        # 参数量：先从 model_id 抠；抠不到再从 tags 兜底（HF tags 常含 7B/13B）。
        param_size = parse_param_size(model_id) or parse_param_size_from_tags(
            r.get("tags") or []
        )
        return NormalizedModelCard(
            source="huggingface",
            model_id=model_id,
            display_name=display_name,
            owner=owner,
            capability=capability,
            param_size=param_size,
            file_size_bytes=None,  # 列表页无 size，detail 再求和
            format=fmt,
            runnable=runnable,
            serveable=capability in _SERVEABLE_CAPS,
            downloads=int(r.get("downloads") or 0),
            likes=int(r.get("likes") or 0),
            updated_at=r.get("lastModified"),
            tags=list(r.get("tags") or []),
        )

    def detail(
        self,
        *,
        model_id: str,
        revision: Optional[str] = None,
        route: Optional[str] = None,
        token: Optional[str] = None,
    ) -> List[HubFile]:
        host = self._host(route)
        rev = revision or "main"
        url = f"{host}/api/models/{model_id}/tree/{rev}"
        data = self._get_json(url, params={"recursive": "true"}, token=token)
        rows = data if isinstance(data, list) else []

        files: List[HubFile] = []
        for r in rows:
            if (r.get("type") or "") == "directory":
                continue
            path = str(r.get("path") or "")
            if not path:
                continue
            lfs = r.get("lfs")
            size = lfs.get("size") if isinstance(lfs, dict) else r.get("size")
            files.append(
                HubFile(
                    rfilename=path,
                    size_bytes=int(size) if size is not None else None,
                    runnable=is_runnable_format([_ext(path)]),
                )
            )
        return files

    def readme(
        self,
        *,
        model_id: str,
        route: Optional[str] = None,
        token: Optional[str] = None,
    ) -> str:
        """取 HF 仓库 README 原文：``{host}/{model_id}/raw/main/README.md``。

        host 由 route 决定（mirror=hf-mirror.com / official=huggingface.co）。
        仓库无 README / 不可达 / 401 等任何异常都吞掉返回 ""。
        """
        host = self._host(route)
        url = f"{host}/{model_id}/raw/main/README.md"
        try:
            return self._get_text(url, token=token) or ""
        except Exception:  # noqa: BLE001 — README 取不到不应打断 UI
            return ""


__all__ = ["HuggingFaceAdapter"]
