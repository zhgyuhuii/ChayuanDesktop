"""一键打包 chayuan-server,并拷贝到桌面端 ``binaries/`` 供 Tauri sidecar 嵌入。

约定的 Tauri ``externalBin`` 命名:::

    apps/desktop/src-tauri/binaries/chayuan-server-<rust-target-triple>(.exe)

triple 表见:https://doc.rust-lang.org/cargo/appendix/glossary.html#target

用法
----

::

    # 仅打 sidecar exe + 拷贝(默认;轻量,模型由 server 首启引导下载)
    poetry run python packaging/pyinstaller/build.py

    # 仅打包,不拷贝
    poetry run python packaging/pyinstaller/build.py --no-copy

    # 一键拉全套 vendor + 模型并打包(集成版,完整离线可用)
    poetry run python packaging/pyinstaller/build.py --release lite      # 轻量集成
    poetry run python packaging/pyinstaller/build.py --release standard  # 服务器标准
    poetry run python packaging/pyinstaller/build.py --release pro       # 企业全功能

    # CI 二次跑 / 离线机器:只用 packaging/.cache,不发任何网络请求
    poetry run python packaging/pyinstaller/build.py --release lite --offline

    # 转发额外参数到 PyInstaller(调试 spec 用)
    poetry run python packaging/pyinstaller/build.py -- --clean --log-level=DEBUG

依赖
----

::

    poetry install
    poetry run pip install "pyinstaller>=6.0"

PyInstaller 不进 ``pyproject.toml`` 主依赖列表,仅打包阶段使用。
``--release`` 模式额外要求安装 ``chayuan_packaging`` 包(在 packaging/python312/ 下)。
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
DESKTOP_SRC_TAURI = (
    WORKSPACE / "chayuan-client" / "apps" / "desktop" / "src-tauri"
)
DESKTOP_BIN_DIR = DESKTOP_SRC_TAURI / "binaries"
# 2026-05-15:bundled_models 不再嵌进 PyInstaller sidecar(避免 NSIS makensis
# mmap 单文件 ≥2GB 失败),改由 Tauri 的 ``bundle.resources`` 字段承载。
# build.py 把 vendor/bundled_models/ 拷到这里,tauri.conf.json 把它打进 installer。
DESKTOP_BUNDLED_MODELS_DIR = DESKTOP_SRC_TAURI / "bundled_models"
BUNDLED_SRC = ROOT / "vendor" / "bundled_models"
SERVICES_SRC = ROOT / "vendor" / "services"
DESKTOP_SERVICES_DIR = DESKTOP_SRC_TAURI / "services"
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


def chayuan_pack_cmd(release: str, sub: str, *, offline: bool = False) -> list[str]:
    """构造一条 ``chayuan_packaging`` 子命令(便于打印 + 单测)。"""
    cmd = [sys.executable, "-m", "chayuan_packaging", sub, "--release", release]
    if offline:
        cmd.append("--offline")
    return cmd


def run_chayuan_pack(release: str, *, offline: bool = False) -> None:
    """串接 ``chayuan-pack`` 的 fetch + stage,在 PyInstaller 前把 vendor + 模型准备好。

    Args:
        release: ``lite`` / ``standard`` / ``pro`` 之一(与 ``layout.yaml`` 对齐)。
        offline: ``True`` 时跳过任何网络;仅读 ``packaging/.cache``。CI 二次跑或
            完全离线打包用。

    错误处理:任一子步骤失败立即抛 :class:`subprocess.CalledProcessError`,
    上层 ``main`` 不再继续 PyInstaller —— 避免把缺失资源的半成品打成包。
    """
    for sub in ("fetch", "stage"):
        cmd = chayuan_pack_cmd(release, sub, offline=offline)
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


# Windows installer 单文件硬上限(NSIS makensis 32-bit mmap;WiX 3 light.exe
# LGHT0263 硬编码 INT32_MAX)。任何 ≥ 这个尺寸的单文件都打不进 .exe/.msi,
# 必须换更小的量化 / 模型版本。WiX 4 Burn 能处理但 Tauri 2 还没支持。
_WIN_INSTALLER_FILE_LIMIT = 2 * 1024 * 1024 * 1024  # 2 GiB


def _guard_oversized_files() -> None:
    """扫 vendor/bundled_models/ 整树,任何 ≥ 2 GB 单文件立即报错。

    这是 Windows installer 的硬限制 — 一旦走到 makensis / light.exe 才发现,
    用户得等十几分钟的 PyInstaller + cargo + vite 跑完才看到错误。提前到
    sync 这一步报错,几秒内告诉用户哪个文件超标。
    """
    if not BUNDLED_SRC.is_dir():
        return
    offenders: list[tuple[Path, int]] = []
    for sub in BUNDLED_SRC.rglob("*"):
        if sub.is_file() and sub.stat().st_size >= _WIN_INSTALLER_FILE_LIMIT:
            offenders.append((sub, sub.stat().st_size))
    if not offenders:
        return
    lines = ["[build] FATAL: 以下单文件 ≥ 2 GB,无法打进 Windows installer:"]
    for path, size in offenders:
        gb = size / 1024 / 1024 / 1024
        rel = path.relative_to(BUNDLED_SRC)
        lines.append(f"  - {rel}  ({gb:.2f} GB)")
    lines.append("")
    lines.append("原因:NSIS makensis 32-bit mmap 单文件 < 2 GB;WiX 3 light.exe")
    lines.append("     LGHT0263 硬编码 INT32_MAX。两条 Windows installer 路都卡。")
    lines.append("")
    lines.append("修法:换更小的量化 / 模型版本,参考")
    lines.append("     chayuan-server/vendor/bundled_models/README.md 推荐瘦身清单,")
    lines.append("     或跑 scripts/install-bundled-models.ps1 / .sh 一键替换。")
    msg = "\n".join(lines)
    print(msg, file=sys.stderr, flush=True)
    raise SystemExit(2)


def sync_bundled_models(*, lite: bool) -> None:
    """同步 vendor/bundled_models/ → src-tauri/bundled_models/(给 Tauri resources)。

    * ``lite=True``  → 清空 src-tauri/bundled_models/(轻量版,不嵌模型)
    * ``lite=False`` → 整树拷贝 vendor/bundled_models/ 到 src-tauri/bundled_models/
                       (集成版,Tauri NSIS installer 会把它打进 ``<install_dir>/bundled_models/``)

    幂等:重复跑结果相同。每次都先清掉旧目录避免上一次 flavor 残留。
    """
    if DESKTOP_BUNDLED_MODELS_DIR.exists():
        shutil.rmtree(DESKTOP_BUNDLED_MODELS_DIR)
    DESKTOP_BUNDLED_MODELS_DIR.mkdir(parents=True, exist_ok=True)

    if lite:
        # 留一个 .gitkeep 防 Tauri glob 命中空目录时的 edge case
        (DESKTOP_BUNDLED_MODELS_DIR / ".gitkeep").touch()
        print(f"[build] 轻量版:清空 {DESKTOP_BUNDLED_MODELS_DIR}", flush=True)
        return

    if not BUNDLED_SRC.is_dir():
        print(f"[build] 警告:bundled 源不存在 {BUNDLED_SRC},集成版退化为空目录", flush=True)
        (DESKTOP_BUNDLED_MODELS_DIR / ".gitkeep").touch()
        return

    # 集成版打包前 size guard:撞 2 GB 就拒(详见上方 _guard_oversized_files 注释)
    _guard_oversized_files()

    # 跳过 README / .gitkeep 这类元文件,只拷 capability 子目录的真实模型
    n_files = 0
    n_bytes = 0
    for entry in sorted(BUNDLED_SRC.iterdir()):
        if entry.name.startswith(".") or entry.name in ("README.md",):
            continue
        if entry.is_dir():
            # 子目录内只拷"非占位"内容:跳过 .gitkeep
            for sub in entry.rglob("*"):
                if sub.is_file() and sub.name != ".gitkeep":
                    rel = sub.relative_to(BUNDLED_SRC)
                    dst = DESKTOP_BUNDLED_MODELS_DIR / rel
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(sub, dst)
                    n_files += 1
                    n_bytes += dst.stat().st_size
    mb = n_bytes / 1024 / 1024
    print(
        f"[build] 集成版:bundled_models 已同步 {n_files} 个文件 ({mb:.1f} MB) "
        f"→ {DESKTOP_BUNDLED_MODELS_DIR}",
        flush=True,
    )


def sync_services(*, lite: bool) -> None:
    """同步 vendor/services/ → src-tauri/services/(给 Tauri resources)。

    集成版需要把 llama-server.exe 这类外部 runtime 二进制带进安装包,
    轻量版不需要(在线下载 chat 时也是用 sidecar 自己代理,不起本地 runtime)。

    幂等:重复跑结果相同。每次都先清掉旧目录避免上一次 flavor 残留。
    """
    if DESKTOP_SERVICES_DIR.exists():
        shutil.rmtree(DESKTOP_SERVICES_DIR)
    DESKTOP_SERVICES_DIR.mkdir(parents=True, exist_ok=True)

    if lite:
        (DESKTOP_SERVICES_DIR / ".gitkeep").touch()
        print(f"[build] 轻量版:清空 {DESKTOP_SERVICES_DIR}", flush=True)
        return

    if not SERVICES_SRC.is_dir():
        print(f"[build] 警告:services 源不存在 {SERVICES_SRC},集成版退化为空目录", flush=True)
        (DESKTOP_SERVICES_DIR / ".gitkeep").touch()
        return

    # 集成版打包前 size guard:撞 2 GB 就拒(跟 bundled_models 共用相同逻辑)
    # 单文件 2 GB 上限不太可能撞到(llama-server.exe < 50 MB),但保险起见扫一遍
    n_files = 0
    n_bytes = 0
    for entry in sorted(SERVICES_SRC.iterdir()):
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            for sub in entry.rglob("*"):
                if sub.is_file() and sub.name != ".gitkeep":
                    if sub.stat().st_size >= _WIN_INSTALLER_FILE_LIMIT:
                        print(
                            f"[build] FATAL: services 内单文件 ≥ 2 GB,无法打进 Windows installer:\n"
                            f"  {sub.relative_to(SERVICES_SRC)} ({sub.stat().st_size / 1024 / 1024 / 1024:.2f} GB)",
                            file=sys.stderr, flush=True,
                        )
                        raise SystemExit(2)
                    rel = sub.relative_to(SERVICES_SRC)
                    dst = DESKTOP_SERVICES_DIR / rel
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(sub, dst)
                    n_files += 1
                    n_bytes += dst.stat().st_size
    mb = n_bytes / 1024 / 1024
    print(
        f"[build] 集成版:services 已同步 {n_files} 个文件 ({mb:.1f} MB) "
        f"→ {DESKTOP_SERVICES_DIR}",
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--no-copy",
        action="store_true",
        help="只打包,不拷贝到 chayuan-client/apps/desktop/src-tauri/binaries/",
    )
    parser.add_argument(
        "--release",
        type=str,
        default="",
        choices=["", "lite", "standard", "pro"],
        help=("(集成版打包)release 矩阵名,先跑 chayuan-pack fetch+stage "
              "把 vendor + 模型拉好再打 PyInstaller。空 = 只打 sidecar exe。"),
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="(仅 --release 用)跳过网络;只读 packaging/.cache。",
    )
    parser.add_argument(
        "--sync-bundled-only",
        action="store_true",
        help=("跳过 PyInstaller,只把 vendor/bundled_models 同步到 src-tauri/bundled_models/。"
              "build-desktop 双 flavor 模式下,sidecar 跑一次就够,flavor 切换只需重跑这一步。"),
    )
    parser.add_argument(
        "--sync-services-only",
        action="store_true",
        help="只同步 vendor/services/ 到 src-tauri/services/(快速 vendor 二进制改动迭代),"
             "跟 --sync-bundled-only 互斥",
    )
    # 用 parse_known_args:任何 build.py 不认识的参数(--clean / --log-level=DEBUG /
    # --noupx / 等)都直接转发给 PyInstaller。免得用户记错 ``--`` 分隔符位置 ──
    # poetry / argparse REMAINDER 组合下 ``--`` 经常被吃掉,导致 ``--clean`` 报
    # "unrecognized arguments"。
    args, extra = parser.parse_known_args()
    # 兼容老用法:如果用户仍写了 ``-- --clean``,把开头的 ``--`` 剥掉
    if extra and extra[0] == "--":
        extra = extra[1:]

    # 2026-05-15:CHAYUAN_LITE_BUILD env 决定本次 build 是轻量版还是集成版,
    # 影响 bundled_models 是否同步到 Tauri resources 暂存目录。
    lite = os.environ.get("CHAYUAN_LITE_BUILD", "").strip().lower() in (
        "1", "true", "yes",
    )

    if args.sync_bundled_only:
        # 跳过 PyInstaller,只同步 bundled_models。给 build-desktop 双 flavor
        # 模式用:sidecar 跑一次,两个 flavor 切换时只重做 sync + tauri bundle。
        sync_bundled_models(lite=lite)
        sync_services(lite=lite)
        return

    if args.sync_services_only:
        sync_services(lite=lite)
        return

    if args.release:
        run_chayuan_pack(args.release, offline=args.offline)
    run_pyinstaller(extra)
    if not args.no_copy:
        copy_to_tauri_binaries()
        sync_bundled_models(lite=lite)
        sync_services(lite=lite)


if __name__ == "__main__":
    main()
