"""server 首次启动钩子 — "装机即用"链路的最后一公里。

集成版(standard / pro)装机自带模型,但 capability defaults 在 yaml 里还
是空的;轻量版若用户手动放模型到 ``<CHAYUAN_ROOT>/models/``,也存在同样
"已装但未指派"的过渡态。

本钩子在每次 server 启动时跑一次:

1. ``seed_bundled_models`` 把项目/打包内 ``vendor/bundled_models/`` 拷到
   ``<CHAYUAN_ROOT>/models/bundled/``(用户已替换的文件不动)
2. ``scan_once`` 刷新 :mod:`local_index`
3. ``promote_defaults_from_local`` 为空 default 的 capability 自动指首选
4. ``deploy_user_manuals`` 把包内手册资源部署到 ``<CHAYUAN_ROOT>/manuals/``

幂等保证:四个步骤都是 idempotent。bundled 已存在且未变会跳过;yaml 已有
default 不会被覆盖;手册已是最新版本会跳过。

调用方:
* :func:`chayuan.server.api_server.server_app.create_app` 的 startup
  事件;失败仅记日志,不阻塞启动。
* 也可直接 ``python -c "from ... import run_first_launch_hooks;
  run_first_launch_hooks()"`` 手动重跑。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional

logger = logging.getLogger("chayuan.first_launch")


@dataclass
class FirstLaunchReport:
    """``run_first_launch_hooks`` 的返回快照。"""

    seeded_source: Optional[str] = None
    seeded_target: Optional[str] = None
    seeded_copied: List[str] = field(default_factory=list)
    seeded_skipped: List[str] = field(default_factory=list)
    scanned: bool = False
    scan_added: int = 0
    scan_updated: int = 0
    scan_removed: int = 0
    promoted: Dict[str, str] = field(default_factory=dict)
    manuals_md: List[str] = field(default_factory=list)
    manuals_docx: List[str] = field(default_factory=list)
    manuals_skipped: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "seeded_source": self.seeded_source,
            "seeded_target": self.seeded_target,
            "seeded_copied": list(self.seeded_copied),
            "seeded_skipped": list(self.seeded_skipped),
            "scanned": self.scanned,
            "scan_added": self.scan_added,
            "scan_updated": self.scan_updated,
            "scan_removed": self.scan_removed,
            "promoted": dict(self.promoted),
            "manuals_md": list(self.manuals_md),
            "manuals_docx": list(self.manuals_docx),
            "manuals_skipped": list(self.manuals_skipped),
            "errors": list(self.errors),
        }


def run_first_launch_hooks() -> FirstLaunchReport:
    """跑一次完整首启序列。所有失败都被吞并写到 :class:`FirstLaunchReport.errors`,
    任何环节挂掉不会向上抛。
    """
    report = FirstLaunchReport()

    # 1) seed bundled_models -> <CHAYUAN_ROOT>/models/bundled
    try:
        from chayuan.server.model_registry.bundled_seed import seed_bundled_models
        seed = seed_bundled_models()
        report.seeded_source = seed.source
        report.seeded_target = seed.target
        report.seeded_copied = list(seed.copied)
        report.seeded_skipped = list(seed.skipped)
        for err in seed.errors:
            report.errors.append(f"seed_bundled: {err}")
    except Exception as e:  # noqa: BLE001
        logger.warning("[first_launch] seed_bundled_models 失败: %r", e)
        report.errors.append(f"seed_bundled_models: {type(e).__name__}: {e}")

    # 2) scan local_index
    try:
        from chayuan.server.model_registry.local_index import scan_once
        delta = scan_once()
        report.scanned = True
        report.scan_added = len(delta.added)
        report.scan_updated = len(delta.updated)
        report.scan_removed = len(delta.removed)
    except Exception as e:  # noqa: BLE001
        logger.warning("[first_launch] scan_once 失败: %r", e)
        report.errors.append(f"scan_once: {type(e).__name__}: {e}")

    # 3) auto-assign capability defaults from local_index
    try:
        from chayuan.server.model_registry.auto_assign import (
            promote_defaults_from_local,
        )
        report.promoted = promote_defaults_from_local()
    except Exception as e:  # noqa: BLE001
        logger.warning("[first_launch] promote_defaults 失败: %r", e)
        report.errors.append(f"promote_defaults: {type(e).__name__}: {e}")

    # 4) deploy user manuals
    try:
        from chayuan.server.manuals.deploy import deploy_user_manuals
        dep = deploy_user_manuals()
        report.manuals_md = list(dep.md_written)
        report.manuals_docx = list(dep.docx_written)
        report.manuals_skipped = list(dep.skipped)
        for err in dep.errors:
            report.errors.append(f"manuals: {err}")
    except Exception as e:  # noqa: BLE001
        logger.warning("[first_launch] deploy_user_manuals 失败: %r", e)
        report.errors.append(f"deploy_user_manuals: {type(e).__name__}: {e}")

    # 5) 按 LocalRuntimeSettings.preload_* 异步拉起本地 runtime (chat / embedding / rerank)
    try:
        import asyncio
        from chayuan.server.model_registry.local_runtime_registry import get_registry
        reg = get_registry()
        # settings 共享，从 chat manager 拿一次即可
        settings = reg.get("chat").settings
        loop = asyncio.get_event_loop()
        if not loop.is_running():
            logger.info("[first_launch] 不在 event loop 中，跳过 runtime 预热")
        else:
            preload_map = {
                "chat": settings.preload_on_startup,
                "embedding": settings.preload_embedding,
                "rerank": settings.preload_rerank,
                "asr": settings.preload_asr,
                "image-embedding": settings.preload_image_embedding,
            }
            for cap, on in preload_map.items():
                if on:
                    loop.create_task(reg.get(cap).start())
                    logger.info("[first_launch] 启动本地 runtime: %s (preload=True)", cap)
                else:
                    logger.info("[first_launch] 跳过预热 %s (preload=False)", cap)
    except Exception as e:  # noqa: BLE001
        logger.warning("[first_launch] 本地 runtime 预热失败: %r", e)
        report.errors.append(f"local_runtime preload: {type(e).__name__}: {e}")

    if report.seeded_copied or report.promoted or report.manuals_md or report.manuals_docx:
        logger.info(
            "[first_launch] seeded=%d/skip=%d promoted=%s manuals_md=%s docx=%s skipped=%s",
            len(report.seeded_copied), len(report.seeded_skipped),
            report.promoted, report.manuals_md, report.manuals_docx,
            report.manuals_skipped,
        )
    return report


__all__ = ["FirstLaunchReport", "run_first_launch_hooks"]
