"""枚举系统字体,供字幕字体下拉使用(替代随包 bundled_fonts)。

纯 stdlib 实现:扫各 OS 字体目录 + extra_dirs,收 .ttf/.ttc/.otf,按 family
去重(取文件名 stem 作 family;真 family 名解析留后续)。返回稳定排序的
``[{"family": str, "path": str}]``。
"""
from __future__ import annotations

import os
import platform
from pathlib import Path
from typing import Iterable, Optional

_FONT_EXTS = (".ttf", ".ttc", ".otf")


def _os_font_dirs() -> list[Path]:
    home = Path(os.path.expanduser("~"))
    sysname = platform.system()
    if sysname == "Darwin":
        return [Path("/System/Library/Fonts"), Path("/Library/Fonts"), home / "Library" / "Fonts"]
    if sysname == "Windows":
        win = Path(os.environ.get("WINDIR", r"C:\Windows"))
        return [win / "Fonts", home / "AppData" / "Local" / "Microsoft" / "Windows" / "Fonts"]
    # Linux / 其它
    return [Path("/usr/share/fonts"), Path("/usr/local/share/fonts"), home / ".fonts",
            home / ".local" / "share" / "fonts"]


def list_system_fonts(extra_dirs: Optional[Iterable[Path]] = None) -> list[dict]:
    """返回系统可用字体列表 ``[{"family","path"}]``,按 family 去重并排序。"""
    dirs = list(_os_font_dirs())
    if extra_dirs:
        dirs.extend(Path(d) for d in extra_dirs)

    by_family: dict[str, str] = {}
    for d in dirs:
        try:
            if not d.is_dir():
                continue
            for f in d.rglob("*"):
                if not f.is_file() or f.suffix.lower() not in _FONT_EXTS:
                    continue
                family = f.stem
                # 首次命中保留;不覆盖(稳定)
                by_family.setdefault(family, str(f))
        except OSError:
            continue

    return [{"family": fam, "path": by_family[fam]} for fam in sorted(by_family)]
