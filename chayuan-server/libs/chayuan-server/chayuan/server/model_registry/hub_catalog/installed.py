"""「已安装集合」—— 扫描本地各模型目录的 manifest origin,判定 Hub 卡片是否已装。

P2 Task 2.2:模型广场搜索结果里每张 :class:`NormalizedModelCard` 的 ``installed``
字段,靠把卡片的 ``(source, model_id)`` 跟本地已安装的 ``(origin.source,
origin.repo_id)`` 集合做匹配来填充。

实现要点
========
* **真源是 manifest**:下载安装(install_model)在模型目录写 ``.chayuan-manifest.json``
  且记 ``origin{source,repo_id,revision}``(Task 2.1)。本模块 rglob 扫
  ``<CHAYUAN_ROOT>/models/`` 下所有 manifest,取 origin 组成集合。
* **老模型回退**:Task 2.1 之前下载 / 手动放置的模型 manifest 无 origin(或根本
  没 manifest)。对有 manifest 但 origin 缺失的,用所在目录名(``owner--name``)
  还原 ``owner/name``,以 ``("unknown", repo_id)`` 记入 —— ``mark_installed``
  会同时按精确 source 和 ``unknown`` 两路匹配,保证老模型也能标已装。
* **CHAYUAN_ROOT 复用 local_index 同款来源**:``chayuan.settings.CHAYUAN_ROOT``,
  延迟求值尊重用户 root 切换(与 ``local_index.models_dir`` 一致)。
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import List, Set, Tuple

logger = logging.getLogger("chayuan.model_registry.hub_catalog.installed")

MANIFEST_NAME = ".chayuan-manifest.json"


def _models_root() -> Path:
    """``<CHAYUAN_ROOT>/models``;与 local_index.models_dir 同源(延迟求值)。"""
    from chayuan.settings import CHAYUAN_ROOT
    return Path(CHAYUAN_ROOT) / "models"


def _repo_from_dirname(dirname: str) -> str:
    """把落盘目录名 ``owner--name`` 还原成 ``owner/name``。

    install_model._repo_safe_name 用 ``repo.replace("/","--")`` 落盘,这里反向。
    目录名里没有 ``--`` 时原样返回(单段模型名,如裸 gguf 目录)。
    """
    if "--" in dirname:
        return dirname.replace("--", "/", 1)
    return dirname


def installed_repo_set() -> Set[Tuple[str, str]]:
    """扫描 ``<CHAYUAN_ROOT>/models/**`` 下所有 manifest,返回已安装 ``(source, repo_id)`` 集合。

    * 有 origin → ``(origin["source"], origin["repo_id"])``。
    * 无 origin(老模型 / 手动放置)→ 用 manifest 所在目录名还原 repo_id,
      记 ``("unknown", repo_id)``。

    扫盘异常(目录不存在 / 单个 manifest 损坏)均静默跳过,返回已收集部分 —
    判定已安装态是辅助 UI,不应阻塞搜索主流程。
    """
    out: Set[Tuple[str, str]] = set()
    root = _models_root()
    try:
        if not root.is_dir():
            return out
        for mf in root.rglob(MANIFEST_NAME):
            try:
                data = json.loads(mf.read_text(encoding="utf-8"))
            except (OSError, ValueError) as e:
                logger.debug("[installed] 跳过损坏 manifest %s: %r", mf, e)
                continue
            origin = data.get("origin") if isinstance(data, dict) else None
            if isinstance(origin, dict) and origin.get("repo_id"):
                src = str(origin.get("source") or "unknown")
                out.add((src, str(origin["repo_id"])))
            else:
                # 无 origin 回退:manifest 所在目录名 → repo_id
                repo_id = _repo_from_dirname(mf.parent.name)
                if repo_id:
                    out.add(("unknown", repo_id))
    except OSError as e:  # noqa: BLE001 — 扫盘失败不阻塞搜索
        logger.warning("[installed] 扫描 %s 失败: %r", root, e)
    return out


def mark_installed(cards: List["NormalizedModelCard"], repo_set: Set[Tuple[str, str]]) -> None:  # noqa: F821
    """原地把已安装卡片的 ``installed`` 置 True。

    匹配规则(任一命中即视为已装):
      * ``(card.source, card.model_id)`` 在集合内(精确溯源);
      * ``("unknown", card.model_id)`` 在集合内(老模型回退,跨源宽松匹配)。
    """
    if not repo_set:
        return
    for card in cards:
        try:
            mid = card.model_id
            if (card.source, mid) in repo_set or ("unknown", mid) in repo_set:
                card.installed = True
        except AttributeError:
            continue


__all__ = ["installed_repo_set", "mark_installed", "MANIFEST_NAME"]
