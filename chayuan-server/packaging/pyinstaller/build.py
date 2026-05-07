"""一键打包 chayuan-server,并拷贝到桌面端 ``binaries/`` 供 Tauri sidecar 嵌入。

约定的 Tauri ``externalBin`` 命名:::

    apps/desktop/src-tauri/binaries/chayuan-server-<rust-target-triple>(.exe)

triple 表见:https://doc.rust-lang.org/cargo/appendix/glossary.html#target

用法
----

::

    # 打包 + 拷贝(默认)
    poetry run python packaging/pyinstaller/build.py

    # 仅打包,不拷贝
    poetry run python packaging/pyinstaller/build.py --no-copy

    # 转发额外参数到 PyInstaller(调试 spec 用)
    poetry run python packaging/pyinstaller/build.py -- --clean --log-level=DEBUG

依赖
----

::

    poetry install
    poetry run pip install "pyinstaller>=6.0"

PyInstaller 不进 ``pyproject.toml`` 主依赖列表,仅打包阶段使用。
"""
from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent                       # packaging/pyinstaller
ROOT = HERE.parent.parent                                    # chayuan-server/(repo root)
WORKSPACE = ROOT.parent                                      # chayuan-desktop/
DESKTOP_BIN_DIR = (
    WORKSPACE / "chayuan-client" / "apps" / "desktop" / "src-tauri" / "binaries"
)
# PyInstaller 默认把所有产物丢到 ``ROOT/dist/``;onefile 模式下文件在 dist/ 顶层,
# onedir 模式下嵌一层同名子目录(``dist/chayuan-server/chayuan-server(.exe)``)。
DIST_ROOT = ROOT / "dist"
SPEC = HERE / "chayuan-server.spec"


def rust_target_triple() -> str:
    """与 Tauri ``externalBin`` 用的 ``<name>-<triple>`` 命名约定对齐。

    这里只覆盖三平台 + arm64/x86_64 主流组合,够 Phase 6 CI 用。其它架构(s390x/
    riscv 等)留给未来扩展。
    """
    sysname = platform.system()
    arch = platform.machine().lower()

    if sysname == "Darwin":
        if arch in ("arm64", "aarch64"):
            return "aarch64-apple-darwin"
        return "x86_64-apple-darwin"

    if sysname == "Windows":
        if arch in ("arm64", "aarch64"):
            return "aarch64-pc-windows-msvc"
        return "x86_64-pc-windows-msvc"

    if sysname == "Linux":
        if arch in ("aarch64", "arm64"):
            return "aarch64-unknown-linux-gnu"
        return "x86_64-unknown-linux-gnu"

    return f"unknown-{sysname.lower()}"


def run_pyinstaller(extra_args: list[str]) -> None:
    cmd = [sys.executable, "-m", "PyInstaller", str(SPEC), "--noconfirm", *extra_args]
    print(f"[build] $ {' '.join(cmd)}", flush=True)
    subprocess.check_call(cmd, cwd=str(ROOT))


def _executable_path() -> Path:
    """定位 PyInstaller 产物。两种模式都覆盖,免得切回 onedir 时再改一次。"""
    suffix = ".exe" if platform.system() == "Windows" else ""
    candidates = [
        # onefile:dist/chayuan-server(.exe)
        DIST_ROOT / f"chayuan-server{suffix}",
        # onedir(COLLECT name='chayuan-server'):dist/chayuan-server/chayuan-server(.exe)
        DIST_ROOT / "chayuan-server" / f"chayuan-server{suffix}",
    ]
    for c in candidates:
        if c.is_file():
            return c
    raise SystemExit(
        f"[build] PyInstaller output not found. tried:\n  "
        + "\n  ".join(str(c) for c in candidates)
        + "\n请确认 spec 中 EXE/COLLECT 的 name 与目录结构。"
    )


def copy_to_tauri_binaries() -> Path:
    DESKTOP_BIN_DIR.mkdir(parents=True, exist_ok=True)
    triple = rust_target_triple()
    suffix = ".exe" if platform.system() == "Windows" else ""

    src = _executable_path()
    dst = DESKTOP_BIN_DIR / f"chayuan-server-{triple}{suffix}"
    shutil.copy2(src, dst)
    # 保留可执行位(macOS / Linux)
    if not platform.system() == "Windows":
        os.chmod(dst, 0o755)

    print(f"[build] copied {src} -> {dst}", flush=True)
    return dst


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--no-copy",
        action="store_true",
        help="只打包,不拷贝到 chayuan-client/apps/desktop/src-tauri/binaries/",
    )
    parser.add_argument(
        "extra",
        nargs=argparse.REMAINDER,
        help="`--` 之后的参数转发给 PyInstaller",
    )
    args = parser.parse_args()

    extra: list[str] = list(args.extra or [])
    if extra and extra[0] == "--":
        extra = extra[1:]

    run_pyinstaller(extra)
    if not args.no_copy:
        copy_to_tauri_binaries()


if __name__ == "__main__":
    main()
