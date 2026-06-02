"""ModelScope 适配器。

实测接口（见 docs/superpowers/notes/2026-06-02-hub-api-probe.md）：
* 搜索：``PUT /api/v1/dolphin/models``，JSON body
  ``{"PageSize":,"PageNumber":,"Name":,"SortBy":"Default"}``（SortBy 只能 Default）。
  - 结果在 ``Data.Model.Models[]``，总数 ``Data.Model.TotalCount``。
  - 每项：``Name`` / ``Path``(owner) / ``ChineseName`` / ``Downloads`` / ``Stars``
    / ``LastUpdatedTime``(unix) / ``Tasks``(可能 null)。model_id = ``f"{Path}/{Name}"``。
* 文件：``GET /api/v1/models/{owner}/{name}/repo/files?Revision=&Root=``
  - 结果 ``Data.Files[]``；每项 ``Name`` / ``Path`` / ``Size`` / ``Type``(blob/tree) / ``IsLFS``。

列表页拿不到文件后缀，``runnable`` 用 capability 是否在可服务集合做**粗判**
（detail 时再按文件精确判定）。
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from chayuan.server.model_registry.hub_catalog import _SERVEABLE_CAPS
from chayuan.server.model_registry.hub_catalog.base import (
    HubAdapter,
    HubFile,
    NormalizedModelCard,
    SearchPage,
)
from chayuan.server.model_registry.hub_catalog.capability import (
    capability_from_ms_tasks,
    is_runnable_format,
    parse_param_size,
    parse_param_size_from_tags,
)

_HOST = "https://www.modelscope.cn"


def _ext(path: str) -> str:
    base = path.rsplit("/", 1)[-1]
    dot = base.rfind(".")
    return base[dot:].lower() if dot >= 0 else ""


def _unix_to_iso(ts: Any) -> Optional[str]:
    try:
        if ts is None:
            return None
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
    except (ValueError, OSError, OverflowError, TypeError):
        return None


class ModelScopeAdapter(HubAdapter):
    """ModelScope 归一适配器。"""

    def _put_json(self, url: str, body: Dict[str, Any], *, token: Optional[str] = None, **kw: Any) -> Any:
        """PUT JSON，抽出便于单测 monkeypatch。"""
        import httpx

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        resp = httpx.put(url, json=body, headers=headers, follow_redirects=True, timeout=10, **kw)
        resp.raise_for_status()
        return resp.json()

    def _get_json(self, url: str, *, token: Optional[str] = None, **kw: Any) -> Any:
        """GET JSON（detail 用），抽出便于单测 monkeypatch。"""
        import httpx

        headers: Dict[str, str] = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        params = kw.pop("params", None)
        resp = httpx.get(url, params=params, headers=headers, follow_redirects=True, timeout=10, **kw)
        resp.raise_for_status()
        return resp.json()

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
        page = max(1, int(page or 1))
        page_size = max(1, int(page_size or 20))
        # ModelScope dolphin 接口实测 SortBy 只接受 "Default"（Downloads/lastModified
        # 会 400），故 sort 无法下发到服务端。sort=="updated" 时只能对**当前页**
        # 按 updated_at 本地排序（前端也会针对 ModelScope 隐藏排序切换，二者皆兜底）。
        body = {
            "PageSize": page_size,
            "PageNumber": page,
            "Name": query or "",
            "SortBy": "Default",
        }
        data = self._put_json(f"{_HOST}/api/v1/dolphin/models", body, token=token)
        model = ((data or {}).get("Data") or {}).get("Model") or {}
        rows = model.get("Models") or []
        total = model.get("TotalCount")

        items: List[NormalizedModelCard] = []
        for r in rows:
            card = self._normalize(r)
            # capability 过滤（如果上层传了 capability）。
            if capability and card.capability != capability:
                continue
            # runnable_only：列表页无文件信息，按 capability 粗判（serveable 即可能可跑）。
            if runnable_only and not card.runnable:
                continue
            items.append(card)

        # ModelScope 不支持服务端按更新时间排序，sort=="updated" 时对本页本地排序
        # （updated_at 为 None 的排到最后）。
        if sort == "updated":
            items.sort(key=lambda c: c.updated_at or "", reverse=True)

        return SearchPage(
            items=items,
            page=page,
            page_size=page_size,
            has_more=(page * page_size) < total if isinstance(total, int) else len(rows) == page_size,
            total=total if isinstance(total, int) else None,
        )

    def _normalize(self, r: Dict[str, Any]) -> NormalizedModelCard:
        owner = str(r.get("Path") or "")
        name = str(r.get("Name") or "")
        model_id = f"{owner}/{name}" if owner else name
        display_name = r.get("ChineseName") or name
        capability = capability_from_ms_tasks(r.get("Tasks"))
        # 列表页无文件后缀 -> runnable 粗判：capability 在可服务集合内即视为「可能可跑」，
        # detail 时再按实际文件精确判定。
        runnable = capability in _SERVEABLE_CAPS

        return NormalizedModelCard(
            source="modelscope",
            model_id=model_id,
            display_name=display_name,
            owner=owner,
            capability=capability,
            param_size=parse_param_size(name) or parse_param_size_from_tags(
                r.get("Tags") or []
            ),
            file_size_bytes=None,
            format=None,
            runnable=runnable,
            serveable=capability in _SERVEABLE_CAPS,
            downloads=int(r.get("Downloads") or 0),
            likes=int(r.get("Stars") or 0),
            updated_at=_unix_to_iso(r.get("LastUpdatedTime")),
            tags=list(r.get("Tags") or []),
        )

    def detail(
        self,
        *,
        model_id: str,
        revision: Optional[str] = None,
        route: Optional[str] = None,
        token: Optional[str] = None,
    ) -> List[HubFile]:
        owner, _, name = model_id.partition("/")
        if not name:
            # 没有 owner/name 形式时整体当 name（防御）。
            owner, name = "", model_id
        rev = revision or "master"
        url = f"{_HOST}/api/v1/models/{owner}/{name}/repo/files"
        data = self._get_json(url, params={"Revision": rev, "Root": ""}, token=token)
        rows = ((data or {}).get("Data") or {}).get("Files") or []

        files: List[HubFile] = []
        for r in rows:
            if (r.get("Type") or "") == "tree":
                continue
            rf = str(r.get("Path") or r.get("Name") or "")
            if not rf:
                continue
            size = r.get("Size")
            files.append(
                HubFile(
                    rfilename=rf,
                    size_bytes=int(size) if size is not None else None,
                    runnable=is_runnable_format([_ext(rf)]),
                )
            )
        return files


__all__ = ["ModelScopeAdapter"]
