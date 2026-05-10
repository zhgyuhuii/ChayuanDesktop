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
# macOS:把构建机 Python 实际链接的 OpenSSL(libssl/libcrypto)注入 bundle 根
#
# 必须在 Analysis() **之前**塞 binaries 列表(走 PyInstaller 标准依赖收集 +
# 归一化通道);写在 Analysis() 之后 append a.binaries 在 onefile 模式不会被
# 后续 EXE 阶段拾取(本文件文件头注释也明确警告)。
#
# 为什么要手动加:Python 3.12 的 _ssl.cpython-312-darwin.so 通过
# @rpath/libssl.3.dylib 引用 OpenSSL,但 PyInstaller 静态分析没法从 @rpath 解
# 到具体源,所以**不会自动收集**;cv2 wheel 自带的 .dylibs/libssl.3.dylib 是
# 旧版 OpenSSL 3.0.x(缺 X509_STORE_get1_objects 等 3.2 新增符号),会让
# _ssl 在加载时报符号缺失 / 库找不到。
#
# 解决:让构建机的 Python 自己 ``import ssl`` 触发 dyld 加载真版 libssl/libcrypto,
# 然后通过 ``_dyld_image_count`` / ``_dyld_get_image_name`` 直接读出当前进程
# 加载的真实文件路径。conda / pyenv / homebrew / python.org 全适配,无需配置。
if sys.platform == "darwin":
    import os as _os

    def _dyld_loaded_dylibs():
        """返回当前进程 dyld 已加载的所有动态库路径(原始路径,不 resolve)。"""
        import ctypes
        libsys = ctypes.CDLL(None)
        libsys._dyld_image_count.restype = ctypes.c_uint32
        libsys._dyld_get_image_name.restype = ctypes.c_char_p
        libsys._dyld_get_image_name.argtypes = [ctypes.c_uint32]
        out: list[Path] = []
        for i in range(libsys._dyld_image_count()):
            n = libsys._dyld_get_image_name(i).decode("utf-8", errors="replace")
            out.append(Path(n))
        return out

    print("[chayuan-spec] ===== macOS OpenSSL 注入开始 =====")
    print(f"[chayuan-spec] sys.executable = {sys.executable}")
    print(f"[chayuan-spec] sys.prefix     = {sys.prefix}")
    print(f"[chayuan-spec] sys.platform   = {sys.platform}")
    try:
        import ssl as _spec_ssl_probe
        import _ssl as _spec_ssl_native
        print(f"[chayuan-spec] ssl.OPENSSL_VERSION = {_spec_ssl_probe.OPENSSL_VERSION}")
        print(f"[chayuan-spec] _ssl.__file__       = {_spec_ssl_native.__file__}")
    except Exception as _e:
        print(f"[chayuan-spec] !! 构建机 Python 自身 import ssl 失败:{_e}")
        raise SystemExit(
            f"[chayuan-spec] FATAL: 构建机 Python 不能 import ssl({_e})。"
            f"请检查 Python 安装或 conda 环境,Python 自身 ssl 都坏的情况下"
            f"打出来的 sidecar 100% 跑不起来。"
        )

    # 全量打印 dyld 已加载的 libssl/libcrypto 候选,便于排查多版本同时在场。
    _all_imgs = _dyld_loaded_dylibs()
    _ssl_candidates = [p for p in _all_imgs
                       if p.name.startswith("libssl.") or p.name.startswith("libcrypto.")]
    print(f"[chayuan-spec] dyld 总加载 dylib 数 = {len(_all_imgs)}")
    print(f"[chayuan-spec] 其中 libssl/libcrypto 命中 {len(_ssl_candidates)} 个:")
    for _p in _ssl_candidates:
        print(f"  · {_p}")

    # 关键修复:**不能** Path.resolve()。conda / Homebrew 上
    # ``libssl.3.dylib`` 通常是指向 ``libssl.3.X.dylib`` 真实文件的 symlink。
    # 一旦 resolve(),basename 就变成 ``libssl.3.X.dylib``;PyInstaller 按 src
    # basename 写入 bundle,_ssl.so 的 @rpath/libssl.3.dylib 就找不到了 ── 这正是
    # 反复出现 "Library not loaded @rpath/libssl.3.dylib" 的根因。
    #
    # 正确做法:取 dyld 报的原始路径(通常本身就是 canonical 名),src 直接是 symlink
    # 路径(PyInstaller copyfile 会跟随 symlink 读真实文件,但 dest basename 用 src
    # 路径的 basename),这样落到 bundle 里就是 _ssl 期望的 ``libssl.3.dylib``。
    def _pick_canonical(prefix: str) -> Path | None:
        """从 dyld 候选里挑 basename 最接近 ``<prefix>3.dylib``(canonical SONAME)的那一个。"""
        canonical = f"{prefix}3.dylib"   # libssl.3.dylib / libcrypto.3.dylib
        # 1. 优先 basename 完全等于 canonical 的(symlink 或同名文件)
        for p in _all_imgs:
            if p.name == canonical:
                return p
        # 2. 其次 basename 以 prefix 开头的第一个(real file like libssl.3.5.dylib)
        for p in _all_imgs:
            if p.name.startswith(prefix):
                return p
        return None

    _ossl_entries: list[tuple[str, str]] = []     # (dest_basename, src_path)
    _ossl_lib_dir: Path | None = None
    for _prefix in ("libcrypto.", "libssl."):
        _picked = _pick_canonical(_prefix)
        if _picked is None:
            continue
        _ossl_lib_dir = _picked.parent
        _canonical = f"{_prefix}3.dylib"
        # 取 canonical symlink:同目录下的 libssl.3.dylib / libcrypto.3.dylib
        _canon_path = _picked.parent / _canonical
        if _canon_path.exists():
            _ossl_entries.append((_canonical, str(_canon_path)))
        else:
            # canonical 不存在(罕见),退而求其次用 dyld 原始路径,但显式指定 dest 名为 canonical
            _ossl_entries.append((_canonical, str(_picked)))

    # 路径兜底(conda env / Homebrew / OPENSSL_LIBDIR)── dyld 没命中时用
    if not _ossl_entries:
        _dirs: list[Path] = []
        _override = _os.environ.get("OPENSSL_LIBDIR", "").strip()
        if _override:
            _dirs.append(Path(_override))
        _dirs.extend([
            Path(sys.prefix) / "lib",
            Path("/opt/homebrew/opt/openssl@3/lib"),
            Path("/usr/local/opt/openssl@3/lib"),
            Path("/opt/homebrew/lib"),
            Path("/usr/local/lib"),
        ])
        for _libname in ("libcrypto.3.dylib", "libssl.3.dylib"):
            for _d in _dirs:
                _full = _d / _libname
                if _full.exists():
                    _ossl_entries.append((_libname, str(_full)))
                    _ossl_lib_dir = _d
                    break

    if not _ossl_entries or len({n for n, _ in _ossl_entries}) < 2:
        # 找不到任意一个 ── 直接 fail build,避免再产出一个运行时挂的 sidecar。
        print("[chayuan-spec] !! FATAL: 没找到 libssl.3.dylib / libcrypto.3.dylib 的有效来源。")
        raise SystemExit(
            "[chayuan-spec] FATAL: macOS bundle 必需的 OpenSSL 来源缺失。\n"
            "  期望:dyld 已加载 libssl.3.dylib + libcrypto.3.dylib,或 OPENSSL_LIBDIR 指向有效目录。\n"
            "  现已收集:" + str(_ossl_entries) + "\n"
            "  解决:在构建机 ``poetry shell`` 里跑 ``python -c \"import ssl; print(ssl.OPENSSL_VERSION)\"`` 确认 ssl 可用,"
            "或者 ``export OPENSSL_LIBDIR=/opt/homebrew/opt/openssl@3/lib`` 后重跑构建。"
        )

    # 把 OpenSSL 通过 (src, dest_dir) 2-元组塞 binaries(走 Analysis 的标准依赖归一化通道)。
    # 不依赖 PyInstaller 自动跟随 symlink ── 把 canonical 名作为 src 可保证 dest 也叫 canonical。
    print("[chayuan-spec] 即将注入 OpenSSL(canonical SONAME → 源文件):")
    for _dest_name, _src in _ossl_entries:
        binaries.append((_src, "."))
        print(f"  + {_dest_name} ← {_src}")

    print("[chayuan-spec] ===== macOS OpenSSL 注入完成 =====")


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
    # ─── bundle 瘦身(排除运行时不需要、但被 langchain hook 拉进来的大头) ───
    # nltk 自带的测试套件 / 示例 app / 演示数据:仅业务用到的 token / corpus 走
    # 运行时按需加载,这些训练演示模块完全打不进 sidecar。
    "nltk.test",
    "nltk.app",
    "nltk.book",
    "nltk.chat",
    # 注意:``nltk.misc`` 不能排除,nltk/__init__.py:203 直接 ``from nltk import misc``
    # 排除会触发运行时 ImportError: cannot import name 'misc' from partially initialized module。
    "nltk.corpus.europarl_raw",
    # onnxruntime 训练 / 模型转换 / 量化工具:推理用不到。前面的注释也明确说
    # 单机版仅做 ONNX 推理。
    "onnxruntime.transformers",
    "onnxruntime.tools",
    "onnxruntime.training",
    "onnxruntime.quantization",
    "onnxruntime.datasets",
    # sklearn 测试和实验性 API
    "sklearn.tests",
    "sklearn.experimental",
    # 其它深度学习框架 / 训练加速:已被 torch 系排除,这里把 transitive 入口堵死
    "tensorflow",
    "tensorflow_datasets",
    "tensorflow_hub",
    "keras",
    "jax",
    "jaxlib",
    "flax",
    "optax",
    "xgboost",
    "lightgbm",
    "catboost",
    # 各 lib 自带测试 / 示例 / 文档资源(matplotlib 一个 tests/ 就 100+ MB)
    "matplotlib.tests",
    "scipy.tests",
    "pandas.tests",
    "numpy.tests",
    "PIL.tests",
    "pyarrow.tests",
    "lxml.tests",
    # langchain 海量可选集成(用不到的第三方平台)── 项目代码没引用的全砍。
    # 业务代码以后真用到时,把对应一行从这里删掉再重跑构建。
    "langchain_classic.tools.azure_cognitive_services",
    "langchain_classic.tools.gmail",
    "langchain_classic.tools.office365",
    "langchain_classic.tools.playwright",
    "langchain_classic.tools.amadeus",
    "langchain_classic.tools.zapier",
    "langchain_classic.tools.eleven_labs",
    "langchain_classic.tools.edenai",
    "langchain_classic.tools.gitlab",
    "langchain_classic.tools.steam",
    "langchain_classic.tools.nasa",
    "langchain_classic.tools.bing_search",
    "langchain_classic.tools.brave_search",
    "langchain_classic.tools.golden_query",
    "langchain_classic.tools.metaphor_search",
    "langchain_classic.tools.searchapi",
    "langchain_classic.tools.searx_search",
    "langchain_classic.tools.tavily_search",
    "langchain_classic.tools.google_finance",
    "langchain_classic.tools.google_jobs",
    "langchain_classic.tools.google_lens",
    "langchain_classic.tools.google_places",
    "langchain_classic.tools.google_scholar",
    "langchain_classic.tools.google_serper",
    "langchain_classic.tools.google_trends",
    "langchain_classic.tools.reddit_search",
    "langchain_classic.tools.slack",
    "langchain_classic.tools.steamship_image_generation",
    "langchain_classic.tools.openweathermap",
    "langchain_classic.tools.scenexplain",
    "langchain_classic.tools.merriam_webster",
    "langchain_classic.tools.dataforseo_api_search",
    "langchain_classic.tools.bearly",
    "langchain_classic.tools.e2b_data_analysis",
    "langchain_classic.tools.multion",
    "langchain_classic.tools.nuclia",
    "langchain_classic.tools.clickup",
    "langchain_classic.chat_loaders.facebook_messenger",
    "langchain_classic.chat_loaders.gmail",
    "langchain_classic.chat_loaders.imessage",
    "langchain_classic.chat_loaders.slack",
    "langchain_classic.chat_loaders.telegram",
    "langchain_classic.chat_loaders.whatsapp",
    "langchain_community.tools.azure_cognitive_services",
    "langchain_community.tools.office365",
    "langchain_community.tools.gmail",
    "langchain_community.tools.playwright",
    # PyMuPDF / faker:tests 资源
    "faker.tests",
    # ipython / jupyter:不用 notebook
    "IPython",
    "ipykernel",
    "ipywidgets",
    "jupyter",
    "notebook",
    "qtconsole",
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
    # 注意:
    # - ``nltk`` 已被 _pyinstaller_hooks_contrib 的 hook-nltk.py 接管,
    #   再 collect_all 会把整个 nltk.test / nltk.app(几百 MB)拉进来。
    # - ``sqlite_vec`` 不是真正意义上的 Python 包(__init__ 是 stub),
    #   collect_data_files / collect_dynamic_libs 会报 warning,实际二进制
    #   走前面的 ``packaging/vendor/sqlite-vec/`` 兜底。
    # 单机版 v0:不带 torch / transformers / sentence_transformers / rerankers。
    # 推理一律走 ONNX(rapidocr_onnxruntime + bge-m3-onnx 之类的量化模型)。
    # 业务代码里 transformers / sentence_transformers 的引用应当是惰性的;若有
    # 早期 import 触发崩溃,在被影响的模块里 try/except ImportError 兜住。
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
        # macOS:在 _ssl 被 import 前用 ctypes 预加载 libssl/libcrypto,
        # 绕开 PyInstaller onefile 把 dylib 放在子目录、@rpath 又只解析到 bundle 根
        # 导致 ``Library not loaded: @rpath/libssl.3.dylib`` 的死局。
        # 不论 PyInstaller 把 libssl 放在哪个子路径,这个 hook 都能找到并预加载。
        str(ROOT / "packaging" / "pyinstaller" / "runtime_hooks" / "openssl_preload.py"),
    ],
    excludes=excludes,
    cipher=block_cipher,
    noarchive=False,
)


# ──────────────────────────────────────────────────────────────
# macOS:剔除 opencv-python wheel 自带的旧版 OpenSSL(在 cv2/.dylibs/ 里)。
#
# 上面 Analysis 之前已经把构建机 Python 链接的新版 libssl/libcrypto 加到 bundle 根;
# 这里把 cv2 自带的旧版(3.0.x,缺 X509_STORE_get1_objects)从 TOC 里删掉,避免
# dyld 走 cv2 的 .dylibs/ 路径把旧版当成 @rpath/libcrypto.3.dylib 命中。
# 两份 install_name 一致,删掉旧版后 dyld 自动 fallback 到 bundle 根的新版;
# cv2 native 模块 ABI 兼容新版(OpenSSL 3.x 只追加符号)。
#
# 仅 darwin 触发;Windows / Linux 不存在 cv2/.dylibs/ 这个目录。
# ──────────────────────────────────────────────────────────────
if sys.platform == "darwin":
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
            f"{before - after} 个文件,避免与 bundle 根的新版冲突。"
        )

    # 关键修复:之前的版本只检查"根级是否有 OpenSSL",忽略了 PyInstaller 经
    # macholib 把 libssl/libcrypto 放在 ``python3.12/lib-dynload/`` 等子目录
    # 的情况(_ssl.so 的兄弟位置)。bundle 根的 dyld @rpath 依然解析失败,
    # 反复挂 "Library not loaded @rpath/libssl.3.dylib"。
    #
    # 一刀切:**先全删** a.binaries 里所有 libssl.* / libcrypto.* 条目(无论位置),
    # **再 3-tuple 强制塞回 bundle 根**。这样不依赖 PyInstaller 的位置推断,
    # 也避免根 + 子目录两份并存导致 dyld 命中错位置。
    _all_oss = []
    _kept_binaries = []
    for _entry in a.binaries:
        _dest = str(_entry[0]).replace("\\", "/")
        _bn = _dest.rsplit("/", 1)[-1] if "/" in _dest else _dest
        if _bn.startswith("libssl.") or _bn.startswith("libcrypto."):
            _all_oss.append((_dest, _entry[1]))
        else:
            _kept_binaries.append(_entry)

    print("[chayuan-spec] Analysis 之后 a.binaries 里所有 libssl/libcrypto 条目(无论位置):")
    for _d, _s in _all_oss:
        print(f"  · dest={_d} ← src={_s}")

    a.binaries = _kept_binaries
    print(f"[chayuan-spec] 已从 a.binaries 移除 {len(_all_oss)} 个 libssl/libcrypto 条目,准备根目录强制重塞。")

    # 强制 3-tuple 注入 bundle 根。Path 形式的 dest 必须没有目录前缀,确保 dyld
    # 通过 _ssl.so 的 @rpath/@loader_path/../.. 能命中根级文件。
    for _name, _src in _ossl_entries:
        a.binaries.append((_name, _src, "BINARY"))
        print(f"  + 强制 root 注入 (3-tuple): {_name} ← {_src}")

    # 兜底校验:如果 _ossl_entries 不全(理论上前面已 raise SystemExit),再 fail 一次
    _final_root_names = set()
    for _entry in a.binaries:
        _dest = str(_entry[0]).replace("\\", "/")
        if _dest in ("libssl.3.dylib", "libcrypto.3.dylib"):
            _final_root_names.add(_dest)
    if {"libssl.3.dylib", "libcrypto.3.dylib"} - _final_root_names:
        raise SystemExit(
            "[chayuan-spec] FATAL: 强制注入后 bundle 根仍缺 libssl/libcrypto。\n"
            "  最终 root 级 OpenSSL = " + str(sorted(_final_root_names)) + "\n"
            "  收集到的 entries = " + str(_ossl_entries) + "\n"
            "  请检查 spec 与 PyInstaller 版本兼容性。"
        )
    print(f"[chayuan-spec] 最终 a.binaries 根级 OpenSSL = {sorted(_final_root_names)}")


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
