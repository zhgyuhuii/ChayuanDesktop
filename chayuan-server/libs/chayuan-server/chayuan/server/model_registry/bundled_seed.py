"""把项目内 ``vendor/bundled_models/`` 种到 ``<CHAYUAN_ROOT>/models/bundled/``。

设计目标
========
* **首启自动**: ``first_launch.run_first_launch_hooks`` 会调本模块在
  ``scan_once`` 之前跑一次,确保自带模型出现在用户数据目录里;
* **幂等 + 用户优先**: 目标文件已存在且 ``size`` 一致(或 ``mtime`` 更新)
  时跳过,保留用户在数据目录里手动替换 / 覆盖的版本;
* **不污染源目录**: bundled 是只读约定(打包时来自 ``_MEIPASS``,无法写回),
  本模块只从 bundled 读,只往 ``<CHAYUAN_ROOT>/models/bundled/`` 写;
* **目录结构对齐**: 与 ``vendor/bundled_models/<cap>/...`` 一致,
  ``local_index`` 扫描时会拿到 ``source_tag = "bundled"``。

返回 :class:`SeedReport`,首启钩子据此填 ``FirstLaunchReport.seeded*``;
所有失败被吞,写入 ``report.errors``。
"""
from __future__ import annotations

import logging
import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger("chayuan.model_registry.bundled_seed")


@dataclass
class SeedReport:
    """``seed_bundled_models`` 的返回快照。"""

    source: Optional[str] = None       # bundled_models_dir() 解析到的源根
    target: Optional[str] = None       # <CHAYUAN_ROOT>/models/bundled
    copied: List[str] = field(default_factory=list)
    skipped: List[str] = field(default_factory=list)   # 目标已存在且未变
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "target": self.target,
            "copied": list(self.copied),
            "skipped": list(self.skipped),
            "errors": list(self.errors),
        }


def _should_replace(src: Path, dst: Path) -> bool:
    """目标存在时,是否需要覆盖。

    用户手动替换过的文件(``size`` 与 bundled 不一致 / ``mtime`` 比 bundled
    新)一律保留,不动。仅在目标确实是 bundled 的旧拷贝(``size`` 一致且
    ``mtime`` 未被改动)时,且 bundled 内容真的变了(``size`` 不一致),才考虑替换。
    保守策略:**只在 ``size`` 不一致 且 用户没改过 ``mtime``** 时才覆盖。
    """
    try:
        ss = src.stat()
        ds = dst.stat()
    except OSError:
        return False
    if ss.st_size != ds.st_size and ds.st_mtime <= ss.st_mtime:
        return True
    return False


def _copy_tree(src_root: Path, dst_root: Path, tag: str, report: SeedReport) -> None:
    """把 ``src_root`` 整树拷贝到 ``dst_root``,逐项判 skip / replace。"""
    if not src_root.is_dir():
        return
    for src in src_root.rglob("*"):
        try:
            rel = src.relative_to(src_root)
        except ValueError:
            continue
        dst = dst_root / rel
        try:
            if src.is_dir():
                dst.mkdir(parents=True, exist_ok=True)
                continue
            if not src.is_file():
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            if dst.exists():
                if not _should_replace(src, dst):
                    report.skipped.append(f"{tag}/{rel}")
                    continue
            shutil.copy2(src, dst)
            report.copied.append(f"{tag}/{rel}")
        except OSError as e:
            report.errors.append(f"{tag}/{rel}: {type(e).__name__}: {e}")


def seed_bundled_models(*, target_dir: Optional[Path] = None) -> SeedReport:
    """把 ``vendor/bundled_models/`` 种到 ``<CHAYUAN_ROOT>/models/bundled/``。

    Args:
        target_dir: 显式指定目标根(测试用)。默认
            ``<CHAYUAN_ROOT>/models/bundled``。

    Returns:
        :class:`SeedReport` 描述本次拷贝结果;源不存在时返回空 report,
        ``source / target`` 仍记录用于诊断。
    """
    from chayuan.server.model_registry.local_index import (
        BUNDLED_CAPABILITY_DIRS,
        bundled_models_dir,
        models_dir,
    )

    report = SeedReport()
    src = bundled_models_dir()
    if src is None:
        logger.debug("[bundled-seed] bundled_models_dir 未找到,跳过")
        return report
    report.source = str(src)

    dst_root = Path(target_dir) if target_dir is not None else (models_dir() / "bundled")
    report.target = str(dst_root)

    try:
        dst_root.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        msg = f"create target dir {dst_root}: {type(e).__name__}: {e}"
        report.errors.append(msg)
        logger.warning("[bundled-seed] %s", msg)
        return report

    for cap in BUNDLED_CAPABILITY_DIRS:
        sub_src = src / cap
        if not sub_src.is_dir():
            continue
        # 空目录(只有 .gitkeep)直接跳过,不在用户数据目录里复制空壳
        try:
            real_children = [
                p for p in sub_src.iterdir()
                if not p.name.startswith(".") and p.name not in ("__pycache__",)
            ]
        except OSError:
            real_children = []
        if not real_children:
            continue
        _copy_tree(sub_src, dst_root / cap, f"bundled/{cap}", report)

    if report.copied or report.errors:
        logger.info(
            "[bundled-seed] src=%s -> dst=%s copied=%d skipped=%d errors=%d",
            report.source, report.target,
            len(report.copied), len(report.skipped), len(report.errors),
        )
    return report


__all__ = ["SeedReport", "seed_bundled_models"]
