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
from typing import Optional


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
# 默认 bundled 源(打包专用暂存),可被 --bundled-source / $CHAYUAN_BUILD_BUNDLED_SOURCE 覆盖
# (典型用法:开发者用 install-bundled-models.ps1 -ChayuanRoot 把模型装到 chayuan_root,
#  打包时指向 <chayuan_root>/models/bundled/,免去 dev/打包两份磁盘占用)。
BUNDLED_SRC = ROOT / "vendor" / "bundled_models"


def _resolve_bundled_src(cli_arg: Optional[str]) -> Path:
    """决定 bundled_models 源路径。优先级:CLI > env > 默认 vendor/bundled_models/。"""
    if cli_arg:
        p = Path(cli_arg).expanduser().resolve()
        if not p.is_dir():
            raise SystemExit(f"[build] --bundled-source 指向的目录不存在:{p}")
        return p
    env = os.environ.get("CHAYUAN_BUILD_BUNDLED_SOURCE")
    if env:
        p = Path(env).expanduser().resolve()
        if not p.is_dir():
            raise SystemExit(f"[build] $CHAYUAN_BUILD_BUNDLED_SOURCE 指向的目录不存在:{p}")
        return p
    return BUNDLED_SRC
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


def _guard_oversized_files(bundled_src: Path) -> None:
    """扫 bundled 源整树,任何 ≥ 2 GB 单文件立即报错。

    这是 Windows installer 的硬限制 — 一旦走到 makensis / light.exe 才发现,
    用户得等十几分钟的 PyInstaller + cargo + vite 跑完才看到错误。提前到
    sync 这一步报错,几秒内告诉用户哪个文件超标。
    """
    if not bundled_src.is_dir():
        return
    offenders: list[tuple[Path, int]] = []
    for sub in bundled_src.rglob("*"):
        if sub.is_file() and sub.stat().st_size >= _WIN_INSTALLER_FILE_LIMIT:
            offenders.append((sub, sub.stat().st_size))
    if not offenders:
        return
    lines = ["[build] FATAL: 以下单文件 ≥ 2 GB,无法打进 Windows installer:"]
    for path, size in offenders:
        gb = size / 1024 / 1024 / 1024
        rel = path.relative_to(bundled_src)
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


def _load_bundle_caps(flavor: str) -> tuple[str, ...]:
    """从 packaging/bundle_manifest.py 拿单一真源的 caps 清单。

    跨同 package 内 import 没问题,这里用 sys.path 是因为 build.py 直接被当脚本跑,
    `python packaging/pyinstaller/build.py` 时 packaging 不是 import path 上的 root。
    """
    import importlib
    pkg_root = Path(__file__).resolve().parent.parent  # chayuan-server/packaging/
    sys.path.insert(0, str(pkg_root))
    try:
        manifest = importlib.import_module("bundle_manifest")
    finally:
        sys.path.pop(0)
    return tuple(manifest.caps_for(flavor))


def sync_bundled_models(*, lite: bool, bundled_src: Optional[Path] = None) -> None:
    """同步 bundled 源 → src-tauri/bundled_models/(给 Tauri resources)。

    Args:
        lite: True = 只拷 LITE_CAPS(embedding/rerank/asr/ocr,~990 MB);
              False = 拷 FULL_CAPS 全集(整 ~3.5 GB)。
              (Tauri NSIS installer 会把它打进 <install_dir>/bundled_models/)
        bundled_src: 显式指定源路径。默认 BUNDLED_SRC(=vendor/bundled_models/)。
                     CLI / env 覆盖在 main 里解析后传入。

    清单真源 packaging/bundle_manifest.py。哪些 cap 算 lite/full 调整只改那一处。
    幂等:重复跑结果相同。每次都先清掉旧目录避免上一次 flavor 残留。
    """
    src = bundled_src or BUNDLED_SRC
    flavor = "lite" if lite else "full"
    caps = _load_bundle_caps(flavor)

    if DESKTOP_BUNDLED_MODELS_DIR.exists():
        shutil.rmtree(DESKTOP_BUNDLED_MODELS_DIR)
    DESKTOP_BUNDLED_MODELS_DIR.mkdir(parents=True, exist_ok=True)

    if not src.is_dir():
        print(f"[build] 警告:bundled 源不存在 {src},{flavor} 退化为空目录", flush=True)
        (DESKTOP_BUNDLED_MODELS_DIR / ".gitkeep").touch()
        return

    # full 模式打包前 size guard:撞 2 GB 就拒(详见上方 _guard_oversized_files 注释)
    if not lite:
        _guard_oversized_files(src)

    print(f"[build] flavor={flavor}, caps = {' / '.join(caps)}, src = {src}", flush=True)

    caps_set = set(caps)
    n_files = 0
    n_bytes = 0
    skipped: list[str] = []
    for entry in sorted(src.iterdir()):
        if entry.name.startswith(".") or entry.name in ("README.md",):
            continue
        if not entry.is_dir():
            continue
        if entry.name not in caps_set:
            skipped.append(entry.name)
            continue
        # 该 cap 在清单内 → 整子目录拷过去(跳过 .gitkeep)
        for sub in entry.rglob("*"):
            if sub.is_file() and sub.name != ".gitkeep":
                rel = sub.relative_to(src)
                dst = DESKTOP_BUNDLED_MODELS_DIR / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(sub, dst)
                n_files += 1
                n_bytes += dst.stat().st_size

    # 留一个 .gitkeep 防 Tauri glob 命中空目录时的 edge case(lite 时如果连
    # bundled_models 都未装填,目录还要存在让 cargo:rerun-if-changed 有 anchor)
    if n_files == 0:
        (DESKTOP_BUNDLED_MODELS_DIR / ".gitkeep").touch()

    mb = n_bytes / 1024 / 1024
    print(
        f"[build] {flavor}: bundled_models 已同步 {n_files} 个文件 ({mb:.1f} MB) "
        f"→ {DESKTOP_BUNDLED_MODELS_DIR}",
        flush=True,
    )
    if skipped:
        print(f"[build] {flavor}: 跳过非 {flavor} 清单内 cap: {', '.join(skipped)}", flush=True)


# Rust target triple → vendor 平台子目录名映射。
# 命名约定见 chayuan-server/vendor/services/llama-server/README.md。
_TRIPLE_TO_VENDOR_SUBDIR: dict[str, str] = {
    "aarch64-apple-darwin":          "macos-arm64",
    "x86_64-apple-darwin":           "macos-x64",
    "x86_64-pc-windows-msvc":        "win-x64",
    "aarch64-pc-windows-msvc":       "win-arm64",
    "x86_64-unknown-linux-gnu":      "linux-x64",
    "aarch64-unknown-linux-gnu":     "linux-arm64",
}


def triple_to_vendor_subdir(triple: str) -> str:
    """Rust target triple → ``vendor/services/<engine>-server/<subdir>/`` 命名。

    CHAYUAN_VENDOR_PLATFORM env 显式覆盖(单值),用于 Win 上想强制 noavx / avx512 之类
    CPU 变体打包(默认 win-x64 是 AVX2 build)。
    """
    override = os.environ.get("CHAYUAN_VENDOR_PLATFORM", "").strip()
    if override:
        return override
    return _TRIPLE_TO_VENDOR_SUBDIR.get(triple, "")


# 不同 OS 二进制的 magic bytes(用于 cross-build 时验证文件不是被截断的占位)
_BINARY_MAGIC: dict[str, tuple[bytes, ...]] = {
    "win-x64":         (b"MZ",),                     # PE
    "win-x64-avx":     (b"MZ",),
    "win-x64-avx512":  (b"MZ",),
    "win-x64-noavx":   (b"MZ",),
    "win-arm64":       (b"MZ",),
    "linux-x64":       (b"\x7fELF",),                # ELF
    "linux-arm64":     (b"\x7fELF",),
    "macos-arm64":     (b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe"),  # Mach-O 64 LE / Universal
    "macos-x64":       (b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe"),
}


def _check_magic(path: Path, subdir: str) -> tuple[bool, str]:
    """读 binary 头 4 字节,跟 OS 对应的 magic 比对。返回 (ok, reason)。"""
    expected = _BINARY_MAGIC.get(subdir)
    if not expected:
        return True, "subdir unmapped, skip magic check"
    try:
        head = path.read_bytes()[:4]
    except OSError as e:
        return False, f"read failed: {e}"
    for magic in expected:
        if head.startswith(magic):
            return True, ""
    return False, f"magic {head!r} 不匹配 {subdir} 期望 {expected}"


def verify_service_binaries(target_subdir: str, host_subdir: str) -> None:
    """打集成包后验证 src-tauri/services/ 里的运行程序可用、可运行。

    Args:
        target_subdir: 本次 build 的目标 vendor 子目录名(决定 magic bytes)
        host_subdir: 当前 build host 的 vendor 子目录名;== target 时跑 ``--help`` 实测可执行

    检查项:
        1. 每个 ``<engine>-server/`` 下必须有主 binary(``<engine>-server[.exe]``)
        2. 主 binary 文件大小 > 100 KB(防 LFS 占位 / 半下载文件)
        3. magic bytes 匹配目标 OS(防把 Win .exe 错打进 Linux 包等)
        4. host == target 时 ``binary --help`` 5s 内退出且 stdout 非空(实测可运行)

    失败立刻 ``SystemExit(2)``,避免把坏包发出去。
    """
    if not DESKTOP_SERVICES_DIR.is_dir():
        print(f"[verify] {DESKTOP_SERVICES_DIR} 不存在,跳过验证", flush=True)
        return

    engines = [d for d in DESKTOP_SERVICES_DIR.iterdir()
               if d.is_dir() and not d.name.startswith(".")]
    if not engines:
        print("[verify] services/ 下没有 engine 子目录,跳过验证", flush=True)
        return

    win = target_subdir.startswith("win-")
    suffix = ".exe" if win else ""
    failures: list[str] = []

    for engine_dir in sorted(engines):
        engine = engine_dir.name  # e.g. "llama-server"
        bin_path = engine_dir / f"{engine}{suffix}"

        # 1) 文件存在性
        if not bin_path.is_file():
            failures.append(f"{engine}:缺主 binary {bin_path.relative_to(DESKTOP_SERVICES_DIR)}")
            continue

        # 2) 大小
        size = bin_path.stat().st_size
        if size < 100 * 1024:
            failures.append(f"{engine}:binary 异常小({size} B),疑似占位 / 半下载")
            continue

        # 3) magic bytes
        ok, reason = _check_magic(bin_path, target_subdir)
        if not ok:
            failures.append(f"{engine}:{reason}")
            continue

        print(f"[verify] {engine}/{bin_path.name}  size={size/1024/1024:.2f} MB  magic OK", flush=True)

        # 4) 实测 --help(仅 host == target 时,即非 cross-build)
        if host_subdir == target_subdir:
            try:
                # 给可执行位(macOS / Linux 从 git checkout 可能 666)
                if not win:
                    os.chmod(bin_path, 0o755)
                r = subprocess.run(
                    [str(bin_path), "--help"],
                    capture_output=True, timeout=5,
                )
                stderr_bytes = r.stderr or b""
                stdout_bytes = r.stdout or b""
                stderr_text = stderr_bytes.decode("utf-8", errors="replace").lower()
                linker_err_markers = (
                    "version `glibc",
                    "version `glibcxx",
                    "version `cxxabi",
                    "version not found",
                    "no version information available",
                    "symbol not found",
                    "image not found",
                    "incompatible library",
                    "cannot execute binary file",
                    "is not a valid win32 application",
                )
                hit_linker = next(
                    (m for m in linker_err_markers if m in stderr_text), None,
                )
                if hit_linker:
                    # 软警告,不阻断 build —— 二进制本身是好的,只是本机 OS / glibc 不兼容,
                    # 用户的目标机器(更新的 Ubuntu / 装好的 Windows)上是可运行的。
                    print(
                        f"[verify]   ⚠ binary 在本 host 跑 --help 命中 runtime-linker 错误"
                        f"(标记={hit_linker!r});不影响目标平台,继续 build",
                        flush=True,
                    )
                elif r.returncode not in (0, 1):
                    # 非常规退出码 —— --help 不应该 segfault/-15。算 fail。
                    failures.append(
                        f"{engine}:--help 异常退出码 {r.returncode},stderr={stderr_text[:200]!r}"
                    )
                elif not (stdout_bytes + stderr_bytes).strip():
                    failures.append(f"{engine}:--help stdout/stderr 都空,binary 可能跑不起来")
                else:
                    print(
                        f"[verify]   --help 退出码 {r.returncode},输出 "
                        f"{len(stdout_bytes)+len(stderr_bytes)} B(可运行)",
                        flush=True,
                    )
            except subprocess.TimeoutExpired:
                failures.append(f"{engine}:--help 5s 超时,binary hang 住")
            except OSError as e:
                # Exec format error / Permission denied 等 —— binary 文件本身坏了
                failures.append(f"{engine}:--help 起不来:{type(e).__name__}: {e}")
        else:
            print(f"[verify]   cross-build({host_subdir} → {target_subdir}),跳过 --help 实测", flush=True)

    if failures:
        print("[verify] FATAL: 集成包 vendor 二进制验证失败:", file=sys.stderr, flush=True)
        for f in failures:
            print(f"  - {f}", file=sys.stderr, flush=True)
        raise SystemExit(2)
    print(f"[verify] 所有 service binary 通过验证 ({len(engines)} 个 engine)", flush=True)


def sync_services(*, lite: bool, target_triple: str | None = None) -> None:
    """同步 vendor/services/<engine>-server/<platform>/* → src-tauri/services/<engine>-server/*。

    集成版需要把 llama-server.exe 这类外部 runtime 二进制带进安装包,轻量版不需要。

    选 platform 子目录的优先级:
      1. ``target_triple`` 参数(显式传入,通常来自 CARGO_BUILD_TARGET / --target arg)
      2. 当前 host 的 :func:`rust_target_triple`(默认行为,Tauri 本机 build)
      3. CHAYUAN_VENDOR_PLATFORM env 可强制覆盖 1+2(用于 Win 上想打 noavx / avx512 等
         CPU 变体的安装包)

    对每个 ``<engine>-server`` 子目录:
      * 找 ``<engine>-server/<vendor-subdir>/``,**把内容(非子目录本身)拷到**
        ``src-tauri/services/<engine>-server/`` 顶层(扁平 layout,end-user install
        后由 ``local_runtime.py:find_server_exe`` 的扁平 fallback 命中)。
      * 子目录不存在 / 只含 .gitkeep → 警告 + 跳过(不算错;e.g. whisper Mac/Linux
        upstream 没发,只 Win 有 binary,Mac 包就是没 ASR 加速)。
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

    triple = target_triple or rust_target_triple()
    vendor_sub = triple_to_vendor_subdir(triple)
    if not vendor_sub:
        print(
            f"[build] 警告:rust target triple {triple!r} 没映射到 vendor 子目录,"
            f"集成版退化为空 services/(用户需要自己装 vendor binary)",
            flush=True,
        )
        (DESKTOP_SERVICES_DIR / ".gitkeep").touch()
        return

    print(f"[build] 集成版:target triple = {triple} → vendor subdir = {vendor_sub}", flush=True)

    n_files = 0
    n_bytes = 0
    skipped_engines: list[str] = []
    for entry in sorted(SERVICES_SRC.iterdir()):
        if entry.name.startswith(".") or not entry.is_dir():
            continue
        plat_dir = entry / vendor_sub
        if not plat_dir.is_dir():
            skipped_engines.append(f"{entry.name}(没 {vendor_sub}/ 子目录)")
            continue
        bin_files = [f for f in plat_dir.iterdir()
                     if f.is_file() and f.name != ".gitkeep"]
        if not bin_files:
            skipped_engines.append(f"{entry.name}({vendor_sub}/ 是空占位)")
            continue

        dst_engine = DESKTOP_SERVICES_DIR / entry.name
        dst_engine.mkdir(parents=True, exist_ok=True)
        for src_file in bin_files:
            if src_file.stat().st_size >= _WIN_INSTALLER_FILE_LIMIT:
                print(
                    f"[build] FATAL: services 内单文件 ≥ 2 GB,无法打进 Windows installer:\n"
                    f"  {src_file.relative_to(SERVICES_SRC)} "
                    f"({src_file.stat().st_size / 1024 / 1024 / 1024:.2f} GB)",
                    file=sys.stderr, flush=True,
                )
                raise SystemExit(2)
            dst = dst_engine / src_file.name
            shutil.copy2(src_file, dst)
            n_files += 1
            n_bytes += dst.stat().st_size

    mb = n_bytes / 1024 / 1024
    print(
        f"[build] 集成版:services 已同步 {n_files} 个文件 ({mb:.1f} MB) "
        f"→ {DESKTOP_SERVICES_DIR}",
        flush=True,
    )
    if skipped_engines:
        print("[build] 注意:以下 engine 在目标平台缺 binary,装机后该 capability 没本地加速:",
              flush=True)
        for s in skipped_engines:
            print(f"  - {s}", flush=True)


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
    parser.add_argument(
        "--target",
        default="",
        help=("(可选)显式指定 Rust target triple,例 x86_64-pc-windows-msvc;"
              "不传 = 取当前 host。CI cross-build 用。CHAYUAN_VENDOR_PLATFORM env "
              "可进一步覆盖 vendor 子目录选择(Win CPU 变体)。"),
    )
    parser.add_argument(
        "--skip-verify",
        action="store_true",
        help="跳过 src-tauri/services/ 里 vendor 二进制的可运行性验证(默认会跑)。",
    )
    parser.add_argument(
        "--lite",
        action="store_true",
        help=("打 lite installer:bundled_models/ 只嵌轻量版子集"
              "(embedding/rerank/asr/ocr,~990 MB);chat、image-embedding 由用户运行时下。"
              "等价旧 env CHAYUAN_LITE_BUILD=1 但更显式。优先级高于 env。"
              "清单真源:packaging/bundle_manifest.py"),
    )
    parser.add_argument(
        "--bundled-source",
        default="",
        help=("显式指定 bundled_models 源目录(子目录结构同 vendor/bundled_models/<cap>/)。"
              "默认 ROOT/vendor/bundled_models/。优先级:CLI > $CHAYUAN_BUILD_BUNDLED_SOURCE env > 默认。"
              "典型用法:dev 时 install-bundled-models.ps1 -ChayuanRoot $env:CHAYUAN_ROOT 装到运行时目录,"
              "打包时 --bundled-source $env:CHAYUAN_ROOT/models/bundled,一份模型给 dev + 打包共用。"),
    )
    # 用 parse_known_args:任何 build.py 不认识的参数(--clean / --log-level=DEBUG /
    # --noupx / 等)都直接转发给 PyInstaller。免得用户记错 ``--`` 分隔符位置 ──
    # poetry / argparse REMAINDER 组合下 ``--`` 经常被吃掉,导致 ``--clean`` 报
    # "unrecognized arguments"。
    args, extra = parser.parse_known_args()
    # 兼容老用法:如果用户仍写了 ``-- --clean``,把开头的 ``--`` 剥掉
    if extra and extra[0] == "--":
        extra = extra[1:]

    # 2026-05-15:lite vs full 控制 bundled_models 同步到 Tauri resources 的范围。
    # 优先级:--lite CLI 参数 > CHAYUAN_LITE_BUILD env(保留向后兼容,旧 build-desktop.ps1
    # 还在通过 env 传)。两者都没设 = full。
    lite = bool(args.lite) or os.environ.get("CHAYUAN_LITE_BUILD", "").strip().lower() in (
        "1", "true", "yes",
    )

    # bundled 源路径解析(CLI > env > vendor 默认),解析完后所有 sync 调用都用它。
    bundled_src = _resolve_bundled_src(args.bundled_source or None)
    if bundled_src != BUNDLED_SRC:
        print(f"[build] bundled_models 源被覆盖:{bundled_src}", flush=True)

    target = args.target or rust_target_triple()
    host = rust_target_triple()
    target_sub = triple_to_vendor_subdir(target)
    host_sub = triple_to_vendor_subdir(host)

    def _do_sync_and_verify() -> None:
        sync_services(lite=lite, target_triple=target)
        if not lite and not args.skip_verify:
            verify_service_binaries(target_subdir=target_sub, host_subdir=host_sub)

    if args.sync_bundled_only:
        # 跳过 PyInstaller,只同步 bundled_models。给 build-desktop 双 flavor
        # 模式用:sidecar 跑一次,两个 flavor 切换时只重做 sync + tauri bundle。
        sync_bundled_models(lite=lite, bundled_src=bundled_src)
        _do_sync_and_verify()
        return

    if args.sync_services_only:
        _do_sync_and_verify()
        return

    if args.release:
        run_chayuan_pack(args.release, offline=args.offline)
    run_pyinstaller(extra)
    if not args.no_copy:
        copy_to_tauri_binaries()
        sync_bundled_models(lite=lite, bundled_src=bundled_src)
        _do_sync_and_verify()


if __name__ == "__main__":
    main()
