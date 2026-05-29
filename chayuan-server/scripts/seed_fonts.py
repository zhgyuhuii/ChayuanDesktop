#!/usr/bin/env python3
"""下载开源 CJK 字体到 vendor/bundled_fonts/,供打包带上(装完即有中文字体)。

为什么不直接打包上游的 STHeiti / 微软雅黑:
  - STHeiti 是 Apple 平台字体、微软雅黑是 Windows 平台字体,**严格说不能
    跨平台分发**(vendor/bundled_fonts/README.md 自己也警告了)。
  - 两个华文黑体 .ttc 各 ~55MB,光这俩就 ~110MB,安装包太肿。

合规做法:随包带开源 OFL 字体(Noto Sans CJK SC),可自由分发、覆盖中文。
用户想用 STHeiti/雅黑/任意已装字体,走 /fonts 的 system 分组(扫 OS 字体目录)
即可 —— 用用户自己机器上的字体合法,且 Windows 用户本来就有几百个。

落地:vendor/bundled_fonts/<file>,desktop build sync 时拷进安装包
(CANONICAL 字体目录由 binaries.get_fonts_dir() 导出给 /fonts)。

源:jsDelivr CDN 反代 notofonts/noto-cjk(国内一般可达);失败可设
CHAYUAN_FONT_BASE 换源,或手动下载放进 vendor/bundled_fonts/。

用法:
    python scripts/seed_fonts.py            # 默认 Noto Sans SC Regular+Bold
    python scripts/seed_fonts.py --list
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# (文件名, 相对 base 的路径)。base 默认 jsDelivr 反代 notofonts/noto-cjk。
# NotoSansCJKsc-*.otf 各 ~16MB,在 jsDelivr 单文件限额内。
DEFAULT_FONTS = [
    ("NotoSansCJKsc-Regular.otf", "Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf"),
    ("NotoSansCJKsc-Bold.otf",    "Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf"),
]
DEFAULT_BASE = "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main"


def _bundled_fonts_dir() -> Path:
    here = Path(__file__).resolve()
    server_root = here.parents[1]  # chayuan-server/
    return server_root / "vendor" / "bundled_fonts"


def _download(fname: str, rel: str, base: str, dest_dir: Path) -> bool:
    dest = dest_dir / fname
    if dest.exists() and dest.stat().st_size > 0:
        print(f"[fonts]    skip(已存在) {fname}")
        return True
    url = f"{base.rstrip('/')}/{rel}"
    try:
        import httpx
    except ImportError:
        print("[fonts] !! 需要 httpx:pip install httpx")
        return False
    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
        print(f"[fonts]    GET {url}")
        with httpx.Client(timeout=180.0, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()
            dest.write_bytes(resp.content)
        print(f"[fonts]    ok {fname} ({len(resp.content) // 1024} KB)")
        return True
    except Exception as e:  # noqa: BLE001
        print(
            f"[fonts] !! 下载 {fname} 失败: {type(e).__name__}: {e}\n"
            f"         可设 CHAYUAN_FONT_BASE 换源,或手动下载放到 {dest_dir}"
        )
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description="seed open-license CJK fonts into vendor")
    ap.add_argument("--list", action="store_true", help="只列默认字体不下载")
    args = ap.parse_args()

    if args.list:
        print("默认开源 CJK 字体:")
        for fname, _ in DEFAULT_FONTS:
            print(f"  {fname}")
        return 0

    base = os.environ.get("CHAYUAN_FONT_BASE", DEFAULT_BASE)
    dest = _bundled_fonts_dir()
    print(f"[fonts] base = {base}")
    print(f"[fonts] dest = {dest}")

    ok = 0
    for fname, rel in DEFAULT_FONTS:
        if _download(fname, rel, base, dest):
            ok += 1
    print(f"[fonts] done: {ok}/{len(DEFAULT_FONTS)} 成功")
    return 0 if ok == len(DEFAULT_FONTS) else 1


if __name__ == "__main__":
    sys.exit(main())
