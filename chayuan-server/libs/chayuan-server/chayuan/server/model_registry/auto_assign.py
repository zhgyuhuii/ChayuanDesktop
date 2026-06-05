"""模型装完后的"默认值自动指派"钩子。

为什么需要
==========

当 ``chayuan_packaging`` 把模型释放到 ``<CHAYUAN_ROOT>/models/`` 之后:

* :mod:`local_index.scan_once` 能扫到 → 候选可见;
* 但 :mod:`config_panel` 的 ``DEFAULT_*_MODEL`` 还是空 →
  :func:`capability_router.resolve_model` 拿不到值 → retrieval / chat
  会跑空。

老路径上,只有 GUI 打开 ``GET /admin/capability_defaults`` 时,后端才会
"auto_assigned"——把第一个候选 promote 成默认。这意味着用户安装完直接打开
chat 会失败,必须先去设置页一次。

本模块把这个 promote 逻辑抽成纯函数,让 :mod:`install_job` 在下载成功后
立刻调一次,**装完即用**,不强求用户先走一遍设置页。
"""
from __future__ import annotations

import logging
from typing import Dict, Iterable, Optional

logger = logging.getLogger("chayuan.model_registry.auto_assign")


# panel capability → get_config_models(model_type=) 的类型串,用于判定"已设默认是否真可用"。
# 只对这三类做失效迁移(语义明确、用户最常踩 glm4-chat);其它 cap 维持"只补空默认"。
_CAP_TO_MODEL_TYPE = {"chat": "llm", "embedding": "embed", "rerank": "rerank"}


def _default_is_usable(panel_cap: str, current: str, local_ids) -> bool:
    """已设默认 current 是否真可用:在本地候选里(本地已装)或平台已注册模型里(远程配置)。
    都不在 → 失效残留(如旧 glm4-chat),返回 False。无法判定的 cap 一律按可用处理(不误删)。"""
    if current in local_ids:
        return True
    mt = _CAP_TO_MODEL_TYPE.get(panel_cap)
    if mt is None:
        return True  # 不在迁移白名单的 cap,保守保留
    try:
        from chayuan.server.utils import get_config_models
        avail = set(get_config_models(model_type=mt).keys())
    except Exception as e:  # noqa: BLE001
        logger.debug("[auto_assign] get_config_models(%s) 失败,保守保留默认: %r", mt, e)
        return True
    return current in avail


def promote_defaults_from_local(
    *,
    capabilities: Optional[Iterable[str]] = None,
    overwrite: bool = False,
    migrate_invalid: bool = True,
) -> Dict[str, str]:
    """为每个 panel capability,若当前无默认且本地有候选,promote 第一条。

    Args:
        capabilities: 限定要处理的 panel capability(``chat`` / ``embedding`` /
            ``rerank`` / ``asr`` / ``ocr`` / ``clip`` / ``t2i`` / ``t2v`` / ``tts``)。
            ``None`` 表示对 :data:`LOCAL_TO_PANEL_CAP` 里所有 panel cap 都尝试。
        overwrite: ``True`` 时即使有默认也覆写为本地首选(慎用)。默认 False。
        migrate_invalid: ``True``(默认)时,对 chat/embedding/rerank,若**已设默认指向
            既不在本地已装、也不在平台已注册的失效模型**(典型=历史残留 ``glm4-chat``),且
            本地有候选可替换,则清掉该失效默认改用本地候选。每次启动幂等执行
            (见 first_launch._model_first_launch),旧装机重启即自动从 glm4-chat 迁到本地模型。

    Returns:
        ``{panel_cap: 新写入的 model_id}``;无变更项不在返回里。

    实现要点:
    * 完全复用 :mod:`local_index` 的扫盘结果,不重新扫盘;
    * 写入走 :func:`config_panel.runtime_framework_panel._save_capability_default`,
      保持与 GUI 入口一致(同一 yaml + LocalIndexRepository 同步路径);
    * 任一 cap 失败不阻塞其它(逐条 try/except)。
    """
    from chayuan.server.model_registry.candidates_bridge import (
        LOCAL_TO_PANEL_CAP,
    )
    from chayuan.server.model_registry.local_index import get_local_index

    try:
        from chayuan.server.config_panel.runtime_framework_panel import (
            _load_capability_defaults,
            _save_capability_default,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("[auto_assign] config_panel 不可用: %r", e)
        return {}

    panel_caps_filter = set(capabilities) if capabilities else None
    defaults = _load_capability_defaults() or {}
    idx = get_local_index()

    promoted: Dict[str, str] = {}
    seen_panel_caps = set()
    for local_cap, panel_cap in LOCAL_TO_PANEL_CAP.items():
        if panel_caps_filter is not None and panel_cap not in panel_caps_filter:
            continue
        if panel_cap in seen_panel_caps:
            continue
        seen_panel_caps.add(panel_cap)

        candidates = idx.by_capability(local_cap)

        current = (defaults.get(panel_cap) or "").strip()
        if current and not overwrite:
            # 失效迁移:已设默认指向不存在的模型(如 glm4-chat)且本地有候选 → 清掉换本地候选;
            # 否则(合法模型 / 无本地候选可换)保留不动。
            local_ids = {c.model_id for c in candidates}
            if not (migrate_invalid and candidates
                    and not _default_is_usable(panel_cap, current, local_ids)):
                continue
            logger.info("[auto_assign] %s 默认 '%s' 失效(不在本地已装/平台已注册)"
                        "且本地有候选 → 迁移到本地模型", panel_cap, current)

        if not candidates:
            continue

        choice = candidates[0]
        try:
            ok, msg = _save_capability_default(panel_cap, choice.model_id)
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "[auto_assign] save_capability_default(%s, %s) 抛异常: %r",
                panel_cap, choice.model_id, e,
            )
            continue
        if not ok:
            logger.warning(
                "[auto_assign] save_capability_default(%s, %s) 失败: %s",
                panel_cap, choice.model_id, msg,
            )
            continue
        promoted[panel_cap] = choice.model_id
        logger.info(
            "[auto_assign] %s → %s (panel cap promoted from local_index)",
            panel_cap, choice.model_id,
        )

    return promoted


__all__ = ["promote_defaults_from_local"]
