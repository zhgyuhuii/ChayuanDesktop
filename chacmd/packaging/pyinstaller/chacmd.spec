# -*- mode: python ; coding: utf-8 -*-
# ChaCMD orchestrator 的 PyInstaller 配置（§3.9 形态 B：随桌面包同启的第二个 sidecar）。
#
# 目标：把 chacmd orchestrator 打成 --onedir 产物 dist/chacmd-server/，由 build.py
# 拷到 chayuan-client/apps/desktop/src-tauri/resources/chacmd-server/，Tauri（用
# tauri.chacmd.conf.json 时）经 resources 一并 bundle 进安装包；运行时由 sidecar.rs
# 用 resource_dir()/chacmd-server/chacmd-server.exe 起子进程（见 DEVELOPMENT.md §4.3
# 的 Rust 接线片段）。
#
# 与察元 spec（chayuan-server/packaging/pyinstaller/chayuan-server.spec）同模式（onedir /
# console=True / COLLECT 名即 exe 名），但 chacmd 极轻：纯 FastAPI + SSE + SQLAlchemy +
# websockets + (可选) nats，无 torch / langchain / paddle / unstructured，故 spec 精简很多。
#
# 用法（在装了 chacmd[dev] 的统一 env / 或 chacmd 自己的 env 里）：
#     pyinstaller packaging/pyinstaller/chacmd.spec --noconfirm
#     python packaging/pyinstaller/build.py           # 上述 + 拷到 desktop src-tauri/resources
#
# 运行时环境（sidecar.rs 注入，形态 B）：
#     CHAYUAN_BASE_URL=http://127.0.0.1:62581   # 察元桌面 sidecar 端口
#     CHACMD_DB_URL=sqlite+aiosqlite:///<dataDir>/chacmd.db
#     CHACMD_API_PORT=8100  CHACMD_GATEWAY_PORT=8767
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

# packaging/pyinstaller/ → chacmd 包根（含 pyproject + chacmd/ 包）
ROOT = Path(SPECPATH).resolve().parent.parent
ENTRY = ROOT / "chacmd" / "cli.py"

# ── Hidden imports（动态 import / 框架子模块）──
hidden_modules: list = []
hidden_modules += collect_submodules("chacmd")
for pkg in (
    "uvicorn",
    "fastapi",
    "starlette",
    "pydantic",
    "sqlalchemy",
    "aiosqlite",
    "websockets",
    # 可选事件总线：装了 nats-py 就带上，没装（瘦构建）collect_submodules 抛错时跳过。
    "nats",
    # 可选 Postgres 驱动：真 Postgres 部署才用；单机 sqlite 不需要，收不到就跳过。
    "asyncpg",
):
    try:
        hidden_modules += collect_submodules(pkg)
    except Exception:  # noqa: BLE001  包不在时跳过
        pass

# ── 排除（chacmd 运行时用不到）──
excludes = ["pytest", "ruff", "mypy", "black", "IPython", "jupyter", "notebook"]

block_cipher = None

a = Analysis(
    [str(ENTRY)],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[],
    hiddenimports=hidden_modules,
    hookspath=[],
    runtime_hooks=[],   # chacmd 单进程 asyncio uvicorn，无 multiprocessing / native 大件，无需 runtime hook
    excludes=excludes,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# Onedir：EXE 只装 bootloader + PYZ，二进制/数据走 COLLECT 落 _internal/，与 exe 同级。
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="chacmd-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,          # sidecar.rs 需读 stdout（日志 / READY 行 / healthz 前的启动日志）
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="chacmd-server",   # 产物根目录名 → dist/chacmd-server/chacmd-server.exe
)
