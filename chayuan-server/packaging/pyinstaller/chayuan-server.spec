# -*- mode: python ; coding: utf-8 -*-
# 单机版 chayuan-server PyInstaller 配置(Phase 2)。
#
# 目标:把 chayuan-server 打成单可执行 ── 后续 Phase 3 由 Tauri 桌面客户端通过
# ``externalBin`` 做 sidecar 嵌入,启动时以 ``CHAYUAN_ROOT=<dataDir>`` env 注入
# 用户首启动向导选定的数据目录。
#
# 模式:onefile。Tauri ``externalBin`` 只能嵌单个 exe,onedir 同级 ``_internal/``
# 不会被 bundle 进安装包,导致 sidecar 启动时报 ``Failed to load python312.dll``。
# 代价:冷启动比 onedir 慢 3-5 秒(自解压到 ``%TEMP%\_MEI******``)。
# 后续优化:Phase 5 后端瘦身完(< 600 MB)再考虑切回 onedir + Tauri ``resources``
# 字段把整个目录当资源文件 bundle。
#
# 用法:
#     poetry run pyinstaller packaging/pyinstaller/chayuan-server.spec --noconfirm
#     poetry run python packaging/pyinstaller/build.py    # 上述 + 拷到 desktop/binaries
#
# 体积说明(详见 README):v0 单机包预计 1.8-2.2 GB(paddleocr 1.2 GB / faiss 120 MB
# / onnxruntime 70 MB)。Phase 5 把 paddle / faiss / unstructured / nicegui 等
# 异步剥离后,目标 < 600 MB。
import sys
from pathlib import Path

from PyInstaller.utils.hooks import (  # noqa: F401  (spec 由 PyInstaller 注入 SPECPATH)
    collect_all,
    collect_data_files,
    collect_submodules,
)


# ──────────────────────────────────────────────────────────────
# 路径
# ──────────────────────────────────────────────────────────────

# packaging/pyinstaller/ → chayuan-server/(repo root for chayuan-server)
ROOT = Path(SPECPATH).resolve().parent.parent
SERVER_PKG = ROOT / "libs" / "chayuan-server"

# 入口(Click main)。chayuan/__main__.py 不存在时回退到 cli.py。
ENTRY = SERVER_PKG / "chayuan" / "__main__.py"
if not ENTRY.is_file():
    ENTRY = SERVER_PKG / "chayuan" / "cli.py"


# ──────────────────────────────────────────────────────────────
# Hidden imports(动态 import 的模块)
# ──────────────────────────────────────────────────────────────

hidden_modules: list = []
hidden_modules += collect_submodules("chayuan")
hidden_modules += collect_submodules("langchain")
hidden_modules += collect_submodules("langchain_core")
hidden_modules += collect_submodules("langchain_openai")
hidden_modules += collect_submodules("langchain_community")
hidden_modules += collect_submodules("langchain_text_splitters")
hidden_modules += collect_submodules("langchain_classic")
hidden_modules += collect_submodules("langchain_ollama")
hidden_modules += collect_submodules("langchain_experimental")
hidden_modules += collect_submodules("uvicorn")
hidden_modules += collect_submodules("fastapi")
hidden_modules += collect_submodules("starlette")
hidden_modules += collect_submodules("sse_starlette")
hidden_modules += collect_submodules("nicegui")
hidden_modules += collect_submodules("onnxruntime")
hidden_modules += collect_submodules("sqlalchemy")
hidden_modules += collect_submodules("pydantic")
hidden_modules += collect_submodules("openai")
hidden_modules += collect_submodules("tiktoken")
hidden_modules += collect_submodules("nltk")
hidden_modules += collect_submodules("sqlite_vec")

# tiktoken 在 ``encoding_for_model`` 里 ``importlib.import_module`` 加载 ext;
# PyInstaller 静态分析挖不到,显式列出。
hidden_modules += [
    "tiktoken_ext",
    "tiktoken_ext.openai_public",
    "click",
    "rich",
    "pydantic_settings",
]


# ──────────────────────────────────────────────────────────────
# Data files(yaml 模板 / 静态资源 / 字体 / 证书)
# ──────────────────────────────────────────────────────────────

datas: list = []

# 第三方包带的 data(tiktoken cl100k_base 等编码、rapidocr 模型权重等)
for pkg in (
    "tiktoken",
    "rapidocr_onnxruntime",
    "nltk",
    "openai",
    "fastapi",
    "starlette",
    "uvicorn",
    "nicegui",
    "click",
    "rich",
    "tabulate",
):
    try:
        d = collect_data_files(pkg)
        if d:
            datas.extend(d)
    except Exception:
        # collect_data_files 在包不存在时抛 ModuleNotFoundError;允许跳过
        pass

# chayuan-server 自带的 yaml seed / static / templates。
# 注意:每行都对应业务代码里硬编码的相对路径,缺哪个 FastAPI 起来时就抛
# RuntimeError: Directory '...' does not exist。新增静态目录时这里同步补。
for sub in (
    # FastAPI 离线 swagger-ui / redoc 资源(MakeFastAPIOffline 加载)
    "chayuan/server/api_server/static",
    # 配置面板:Jinja templates + 静态资源
    "chayuan/server/config_panel/static",
    "chayuan/server/config_panel/templates",
    # /img 路由:logo / 模型 logo / tray icon(server_app.py 用 IMG_DIR 挂载)
    "chayuan/img",
    # 包内 seed 数据(只读,与 CHAYUAN_ROOT/data 用户数据目录区分):
    # - tools_catalog.json:工具目录
    # - ai_platform_config/:模型平台默认配置
    # - knowledge_base/info.db + samples/:首次启动时拷贝到 KB_ROOT_PATH
    # cli.py:408 的 PACKAGE_ROOT/data/... 引用全部依赖这里。
    "chayuan/data",
    # YAML seed 文件(prompt_settings 等)
    "chayuan/data_seed",
    # 服务端打包资源(图片 / 字体等)
    "chayuan/server/_assets",
):
    src = SERVER_PKG / sub
    if src.is_dir():
        datas.append((str(src), sub))


# ──────────────────────────────────────────────────────────────
# 二进制扩展(sqlite-vec)
#
# 把对应平台的 ``vec0.so`` / ``vec0.dylib`` / ``vec0.dll`` 放到
# ``packaging/vendor/sqlite-vec/`` 即可被 spec 自动嵌入。
# 来源:https://github.com/asg017/sqlite-vec/releases
# ──────────────────────────────────────────────────────────────

binaries: list = []
sqlite_vec_dir = ROOT / "packaging" / "vendor" / "sqlite-vec"
if sqlite_vec_dir.is_dir():
    for f in sqlite_vec_dir.iterdir():
        if f.suffix.lower() in (".so", ".dylib", ".dll"):
            binaries.append((str(f), "."))


# ──────────────────────────────────────────────────────────────
# 排除项(单机版用不到)
# ──────────────────────────────────────────────────────────────

excludes = [
    # Celery / Redis 链路:单机模式走 asyncio.Queue + threadpool
    "celery",
    "kombu",
    "billiard",
    "amqp",
    # arq + redis 异步队列:同上
    "arq",
    "redis",
    "aioredis",
    # 多用户 PostgreSQL 驱动:单机走 sqlite
    "psycopg2",
    "psycopg",
    "asyncpg",
    # 测试 / 类型工具
    "pytest",
    "mypy",
    "black",
    # 单机版 v0:深度学习运行时全部砍掉,推理走 onnxruntime。
    # 留 torch 在 onefile 里会触发 c10.dll WinError 1114,且 ~1.5 GB 净占用。
    "torch",
    "torchvision",
    "torchaudio",
    "transformers",
    "sentence_transformers",
    "rerankers",
    # PaddleOCR 系:Phase 5 已从 pyproject 砍掉;此处兜底防 transitive 引入
    "paddle",
    "paddleocr",
    "paddlepaddle",
]


# ──────────────────────────────────────────────────────────────
# Analysis
# ──────────────────────────────────────────────────────────────

block_cipher = None

# 大依赖一锅端:用 ``collect_all`` 收集 datas + binaries + hiddens,
# 减少手填 entry。注意 collect_all 返回顺序是 ``(datas, binaries, hiddenimports)``,
# 别按字母顺序解包成 (bins, dat, hids) —— 之前那样写会把 datas 塞进 binaries TOC,
# 后续 EXE() 归一化阶段抛 ``ValueError: not enough values to unpack (expected 3, got 2)``。
#
# 必须在 Analysis() **之前**累加进 binaries/datas/hidden_modules 这三个普通 list,
# 让 Analysis 自己把 2-元组规范化成 3-元组;不能等 Analysis 跑完再 append 到
# ``a.binaries`` / ``a.datas`` —— 那是已规范化的 TOC,塞 2-元组就坏。
def _collect_safe(pkg: str):
    """安全调 ``collect_all``:包不在(瘦构建)时跳过,不影响其它依赖。返回 (datas, binaries, hiddens)。"""
    try:
        return collect_all(pkg)
    except Exception:
        return [], [], []


for big in (
    "faiss",
    "PyMuPDF",
    "fitz",
    "rapidocr_onnxruntime",
    "onnxruntime",
    "nltk",
    # 单机版 v0:不带 torch / transformers / sentence_transformers / rerankers。
    # 推理一律走 ONNX(rapidocr_onnxruntime + bge-m3-onnx 之类的量化模型)。
    # torch 一旦进 onefile,c10.dll 容易在某些 CPU / 缺 VC++ runtime 的机器上
    # 抛 [WinError 1114] DLL 初始化失败,且体积膨胀 ~1.5 GB。
    # 业务代码里 transformers / sentence_transformers 的引用应当是惰性的;若有
    # 早期 import 触发崩溃,在被影响的模块里 try/except ImportError 兜住。
    # Phase 4:sqlite-vec 包带 ``vec0`` 平台二进制(*.so/*.dylib/*.dll)
    "sqlite_vec",
):
    _dat, _bin, _hid = _collect_safe(big)
    datas.extend(_dat)
    binaries.extend(_bin)
    hidden_modules.extend(_hid)


a = Analysis(
    [str(ENTRY)],
    pathex=[str(SERVER_PKG)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden_modules,
    hookspath=[str(ROOT / "packaging" / "pyinstaller" / "hooks")],
    runtime_hooks=[
        # 必须在 user code / Click 解析 argv 之前调 multiprocessing.freeze_support(),
        # 否则 Windows 下子进程 ``--multiprocessing-fork`` 参数会被 Click 当未知 option 拒绝。
        str(ROOT / "packaging" / "pyinstaller" / "runtime_hooks" / "multiprocessing_freeze.py"),
    ],
    excludes=excludes,
    cipher=block_cipher,
    noarchive=False,
)


# ──────────────────────────────────────────────────────────────
# macOS:剔除 opencv-python 自带的 libcrypto / libssl
#
# 现象(2026-05-10 macOS arm64 健康探测失败):
#   ImportError: dlopen(_ssl.cpython-312-darwin.so, 0x0002):
#     Symbol not found: _X509_STORE_get1_objects
#     Expected in: cv2/.dylibs/libcrypto.3.dylib
#
# 根因:
#   * Python 3.12 的 ``_ssl.cpython-312-darwin.so`` 是用 OpenSSL 3.2+ 链接的;
#     ``X509_STORE_get1_objects`` 是 OpenSSL 3.2.0(2023-11)新增的符号。
#   * opencv-python 的 mac wheel 在 ``cv2/.dylibs/`` 自带一份 OpenSSL 3.0.x 的
#     ``libcrypto.3.dylib``(给内嵌 ffmpeg 用),没这个符号。
#   * PyInstaller 把两份 dylib 都打进 bundle;dyld 按 rpath 顺序解析
#     ``@rpath/libcrypto.3.dylib``,因 cv2 通常先被 import,``cv2/.dylibs/``
#     被加进搜索路径在前,_ssl 命中旧版 → 符号缺失,start 子命令直接挂。
#
# 修法:
#   把 ``cv2/.dylibs/libcrypto*`` 与 ``libssl*`` 从 a.binaries 删掉。两份
#   dylib install_name 都是 ``@rpath/libcrypto.3.dylib``,删掉旧版后 dyld
#   会回退到 Python runtime 自带的新版,符号齐全。OpenSSL 3.x 系列只追加
#   不删除符号,cv2 自身的 native 模块 link 新版完全兼容。
#
# 仅 darwin 触发;Windows / Linux 没这个问题(对应平台的 wheel 不带 .dylibs)。
# ──────────────────────────────────────────────────────────────
if sys.platform == "darwin":
    # 第 1 步:剔除 cv2/.dylibs/ 下自带的旧版 OpenSSL(3.0.x,缺 X509_STORE_get1_objects)
    def _is_cv2_bundled_openssl(entry):
        # PyInstaller TOC entry: (dest_in_bundle, src_path, typecode)
        dest = entry[0].replace("\\", "/")
        if not dest.startswith("cv2/.dylibs/"):
            return False
        name = dest.rsplit("/", 1)[-1]
        return name.startswith("libcrypto.") or name.startswith("libssl.")

    before = len(a.binaries)
    a.binaries = [b for b in a.binaries if not _is_cv2_bundled_openssl(b)]
    after = len(a.binaries)
    if before != after:
        print(
            f"[chayuan-spec] 已剔除 cv2/.dylibs/ 下的旧版 OpenSSL "
            f"{before - after} 个文件,避免与 Python _ssl 在 X509_STORE_get1_objects "
            f"上冲突。"
        )

    # 第 2 步:把 Python 链接的那份新版 OpenSSL 显式加到 bundle 根。
    #
    # 背景:Python 3.12 的 ``_ssl.cpython-312-darwin.so`` 依赖
    # ``@rpath/libcrypto.3.dylib`` 与 ``@rpath/libssl.3.dylib``。PyInstaller
    # 的依赖收集对 cv2 wheel 自带的 ``.dylibs/`` 是显式跟踪的,但对 Homebrew /
    # python.org Python 链接的 OpenSSL **不会自动收集**(_ssl.so 只用 @rpath
    # 引用,没有具体源路径);所以光剔除 cv2 那份会让 bundle 完全没有 OpenSSL。
    #
    # 这里在常见构建路径里找 ``libcrypto.3.dylib`` / ``libssl.3.dylib``,
    # 加到 bundle **根目录**(_ssl.so 报错里 dyld 实际尝试的路径就是 bundle 根)。
    # cv2 自己的 native 模块 ``@rpath/libcrypto.3.dylib`` 引用同样命中这份,
    # ABI 兼容(OpenSSL 3.x 系列只追加符号)。
    import os as _os
    _openssl_search_dirs: list[Path] = []
    # 显式覆盖优先(供 CI 或非主流 Python 构建用):
    #   OPENSSL_LIBDIR=/path/to/openssl/lib
    _override = _os.environ.get("OPENSSL_LIBDIR", "").strip()
    if _override:
        _openssl_search_dirs.append(Path(_override))
    _openssl_search_dirs.extend([
        Path("/opt/homebrew/opt/openssl@3/lib"),     # Homebrew arm64(主流)
        Path("/usr/local/opt/openssl@3/lib"),        # Homebrew x86_64
        Path("/opt/homebrew/lib"),                   # Homebrew 备用
        Path("/usr/local/lib"),                      # 备用
        Path(sys.prefix) / "lib",                    # python.org / pyenv
    ])
    _openssl_added: list[str] = []
    for _libname in ("libcrypto.3.dylib", "libssl.3.dylib"):
        # 防止重复:bundle 里已经有同名文件就跳过
        if any(b[0].rsplit("/", 1)[-1] == _libname for b in a.binaries):
            continue
        for _cand_dir in _openssl_search_dirs:
            _full = _cand_dir / _libname
            if _full.is_file():
                # 走 symlink 解析到真实文件,避免 install_name 不一致
                _real = _full.resolve()
                a.binaries.append((_libname, str(_real), "BINARY"))
                _openssl_added.append(f"{_libname} ← {_real}")
                break
    if _openssl_added:
        print("[chayuan-spec] 已显式注入 Python 链接的新版 OpenSSL:")
        for _entry in _openssl_added:
            print(f"  - {_entry}")
    else:
        print(
            "[chayuan-spec] !! 警告:未在常见路径找到新版 libcrypto/libssl;_ssl "
            "可能在运行时 dlopen 失败。请检查构建机是否安装 Homebrew openssl@3 "
            "(brew install openssl@3),或手动设 OPENSSL_LIBDIR 环境变量。"
        )


pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)


# ──────────────────────────────────────────────────────────────
# EXE / COLLECT
# ──────────────────────────────────────────────────────────────

# Onefile 模式:把 a.binaries / a.zipfiles / a.datas 直接喂给 EXE,
# 不再走 COLLECT。产物在 ``dist/chayuan-server(.exe)``(注意:没有同名子目录)。
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="chayuan-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,            # paddle 与 strip 偶发不兼容
    upx=False,              # paddle / onnxruntime 与 UPX 不兼容,默认关
    runtime_tmpdir=None,    # 默认用 %TEMP%\_MEI******
    console=True,           # sidecar 需要读 stdout(日志 / READY 行)
    disable_windowed_traceback=False,
    argv_emulation=False,   # CLI 行为依赖 argv,关闭 macOS 的 emu
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
