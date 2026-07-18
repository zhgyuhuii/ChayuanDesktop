"""把 :mod:`local_index` 扫到的本地模型桥接到 ``capability_defaults`` 候选列表。

为什么需要
==========

``GET /admin/capability_defaults`` 的 candidates 原本**只**来自
:mod:`model_platform_repository`（用户在 GUI 上配的云端厂商 + 模型）。
但 chayuan-desktop 装机后，``layout.yaml`` 把 GGUF 文件释放到本地，
由 :mod:`local_index` 扫盘发现 —— 这些条目原来**没有**进入 candidates 列表。

结果：用户安装完后在 GUI 看不到自家随包的本地模型，没法选为 default，
启动也起不来。

本模块负责把 local_index 的条目按 capability 映射成与 admin_routes 已有
candidates 同形状的字典，由 ``get_capability_defaults`` 在汇总阶段合并进去。

映射约定
========

* :mod:`identifier` 的 capability 词遵循 *kebab-case*（``text-embedding``）；
* :mod:`config_panel.runtime_framework_panel.CAPABILITY_LABELS` 用的是 panel
  侧短名（``embedding`` / ``clip`` / ``asr`` / ``ocr`` / ``t2i`` / ``t2v`` / ``tts``）。

这里给出一个**单向**映射 :data:`LOCAL_TO_PANEL_CAP`，反向查取（同一 panel cap
可能对应多个 local cap）由 :func:`local_candidates_for` 处理。
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from chayuan.server.model_registry.local_index import get_local_index, scan_once

logger = logging.getLogger("chayuan.model_registry.candidates_bridge")


#: local_index ``identifier`` 的 capability 词 → ``CAPABILITY_LABELS`` panel cap。
LOCAL_TO_PANEL_CAP: Dict[str, str] = {
    "chat":            "chat",
    "text-embedding":  "embedding",
    "image-embedding": "clip",
    "rerank":          "rerank",
    "speech-to-text":  "asr",
    "image-to-text":   "ocr",
    "text-to-image":   "t2i",
    "text-to-video":   "t2v",
    "text-to-audio":   "tts",
}


def _local_caps_for_panel(panel_cap: str) -> List[str]:
    """panel 短名 → local_index 全名（可能 1-N，例如未来同一 panel cap 对应多个）。"""
    return [
        local for local, panel in LOCAL_TO_PANEL_CAP.items() if panel == panel_cap
    ]


def local_candidates_for(panel_cap: str, *, do_scan: bool = True) -> List[Dict[str, Any]]:
    """返回 ``panel_cap`` 对应的本地候选模型，格式与 ``get_capability_defaults``
    已有的 candidates 字段一致。

    输出形状
    --------
    每条记录::

        {
            "id":          str,        # local_index entry.model_id
            "runtime":     "local",    # 标识"非云端厂商"
            "format":      str,        # gguf / hf_transformers / onnx / ...
            "size_bytes":  int,
            "is_default":  False,      # 由调用方根据 defaults dict 后置改写
            "source":      "local_index",
            "path":        str,
            "family":      str,
        }

    Args:
        panel_cap: ``CAPABILITY_LABELS`` 的 cap 短名（``chat`` / ``embedding`` / ...）。
        do_scan: ``True`` 时先 ``scan_once`` 刷新本地索引；``False`` 直接读现有索引。

    Returns:
        本地候选列表；无对应映射或无候选时返回空列表。
    """
    local_caps = _local_caps_for_panel(panel_cap)
    if not local_caps:
        return []

    if do_scan:
        try:
            scan_once()
        except Exception as e:  # noqa: BLE001
            logger.debug("[candidates_bridge] scan_once 失败，沿用现有索引: %r", e)

    idx = get_local_index()
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for local_cap in local_caps:
        for e in idx.by_capability(local_cap):
            if e.model_id in seen:
                continue
            seen.add(e.model_id)
            out.append({
                "id": e.model_id,
                "runtime": "local",
                # platform_name 让前端按厂商分组时把 scanner 直出条目归到「本地模型」
                "platform_name": f"local-{panel_cap}",
                "format": e.format,
                "size_bytes": int(e.size_bytes),
                "is_default": False,
                "source": "local_index",
                "path": e.path,
                "family": e.family,
            })
    return out


def _display_basename(model_id: Any) -> str:
    """model_id → 前端展示用的 basename(小写),与 local_index
    ``_canonical_dedupe`` 第二遍 (capability, basename) 的口径一致。"""
    s = str(model_id or "").replace("\\", "/").rstrip("/")
    return s.rsplit("/", 1)[-1].lower()


def _is_local_candidate(c: Dict[str, Any]) -> bool:
    """本条候选是否指向本地 sidecar / local_index(而非云厂商)。

    与 ``/v1/models`` 去重 band-aid 的判定一致:``platform_name`` 为 ``local``
    或 ``local-<cap>``;另兜住 bridge 自产条目的 ``source='local_index'``。
    """
    pn = str(c.get("platform_name") or "")
    return pn == "local" or pn.startswith("local-") or c.get("source") == "local_index"


def _dedupe_local_by_basename(
    items: List[Dict[str, Any]], *, default_id: Any = None
) -> None:
    """就地折叠「同一物理本地模型的多条候选」。

    背景:``_register_local_platform``(local_runtime.py)把本地平台 DB 行的
    模型清单写成「local_index 全路径 + basename 别名」两份(别名用于
    ``get_config_models(basename)`` 路由命中,不能从 DB 行里去掉)。别名 id
    与全路径 id 不同,精确 id 去重抓不住 → 「默认模型」每个下拉多一条。
    这里按 basename(物理模型同一性,与 local_index ``_canonical_dedupe``、
    ``/v1/models`` 的 basename 去重口径统一)只保留一条。

    保留优先级:``id == default_id``(别把用户已选默认折没,否则上层会误判
    默认失效并自动重设)> id 更长(全路径条,可路由,与 ``_entry_preference``
    一致)。被丢条目的 ``is_default`` 合并到保留条上。**只折叠本地条**,
    云厂商同名模型绝不误伤。
    """
    groups: Dict[str, List[int]] = {}
    for i, c in enumerate(items):
        if not _is_local_candidate(c):
            continue
        key = _display_basename(c.get("id"))
        if key:
            groups.setdefault(key, []).append(i)

    drop: set = set()
    for members in groups.values():
        if len(members) < 2:
            continue

        def _pref(j: int) -> tuple:
            cid = str(items[j].get("id") or "")
            return (1 if (default_id and cid == default_id) else 0, len(cid), cid)

        keep = max(members, key=_pref)
        for j in members:
            if j == keep:
                continue
            if items[j].get("is_default"):
                items[keep]["is_default"] = True
            drop.add(j)
    if drop:
        items[:] = [c for i, c in enumerate(items) if i not in drop]


def merge_local_into_candidates(
    candidates: Dict[str, List[Dict[str, Any]]],
    *,
    defaults: Dict[str, Any] | None = None,
    do_scan: bool = True,
) -> Dict[str, List[Dict[str, Any]]]:
    """就地把 ``local_candidates_for`` 的结果合并到现有 ``candidates`` 字典里。

    Args:
        candidates: ``{panel_cap: [候选 dict, ...]}``；本函数会**就地**追加本地条目。
        defaults: 可选；``{panel_cap: model_id}``。如果某条本地候选 ``id`` 等于
            ``defaults[panel_cap]``，把它的 ``is_default`` 置为 True。
        do_scan: 透传给 :func:`local_candidates_for`；多 cap 合并时只在第一次扫
            （内部缓存让后续调用免扫）。

    Returns:
        同一个 ``candidates`` 字典（方便链式调用）。

    去重策略
    --------
    1. 追加阶段:``id`` 精确匹配已存在则跳过;此外若已有**本地**候选与本条
       basename 相同(同一物理模型,只是路径前缀不同,如平台行是旧根前缀、
       local_index 是新前缀),也跳过 —— 平台行的 id 是路由真源,优先保留。
       例外:本条 id 恰是 ``defaults[panel_cap]`` 时仍追加,交给第 2 步按
       默认优先折叠,保证用户已选默认不丢。
    2. 收尾对每个 cap 跑 :func:`_dedupe_local_by_basename`,把平台行自带的
       「全路径 + basename 别名」双条折成一条(根治「默认模型」下拉每个
       本地模型多一条 / rerank 多几条)。
    """
    defaults = defaults or {}
    scan_done = False
    for panel_cap in list(candidates.keys()):
        ds = do_scan and not scan_done
        local = local_candidates_for(panel_cap, do_scan=ds)
        scan_done = scan_done or ds
        default_id = defaults.get(panel_cap)
        existing_ids = {c.get("id") for c in candidates[panel_cap]}
        existing_local_bns = {
            _display_basename(c.get("id"))
            for c in candidates[panel_cap]
            if _is_local_candidate(c)
        }
        for entry in local:
            if entry["id"] in existing_ids:
                continue
            if (
                _display_basename(entry["id"]) in existing_local_bns
                and entry["id"] != default_id
            ):
                continue
            if default_id and entry["id"] == default_id:
                entry["is_default"] = True
            candidates[panel_cap].append(entry)
        # 平台行自带的「全路径 + basename 别名」重复不依赖 local 是否为空,
        # 一律收尾折叠。
        _dedupe_local_by_basename(candidates[panel_cap], default_id=default_id)
    return candidates


__all__ = [
    "LOCAL_TO_PANEL_CAP",
    "local_candidates_for",
    "merge_local_into_candidates",
    "_dedupe_local_by_basename",
]
