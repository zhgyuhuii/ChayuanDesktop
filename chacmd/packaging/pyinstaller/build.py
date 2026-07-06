"""冻结 chacmd orchestrator 成 --onedir sidecar，并拷到 Tauri resources（跨平台）。

对齐察元 chayuan-server/packaging/pyinstaller/build.py 的形态：先跑 PyInstaller，
再把 dist/chacmd-server/ 整树拷到 chayuan-client/apps/desktop/src-tauri/resources/chacmd-server/。
tauri.chacmd.conf.json 需把 "chacmd-server/**/*" 列进 bundle.resources（默认已注释，见文件内说明）。

用法（在装了 chacmd 及 PyInstaller 的 env 里，Win/Unix 通用）：
    python packaging/pyinstaller/build.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

CHACMD_ROOT = Path(__file__).resolve().parent.parent.parent          # chacmd 包根
SPEC = CHACMD_ROOT / "packaging" / "pyinstaller" / "chacmd.spec"
DIST = CHACMD_ROOT / "dist" / "chacmd-server"
# chacmd 与 chayuan-client 都在 chayuan-desktop 母体下并列
DESKTOP_RES = (
    CHACMD_ROOT.parent
    / "chayuan-client" / "apps" / "desktop" / "src-tauri" / "resources" / "chacmd-server"
)


def main() -> None:
    if not SPEC.is_file():
        raise SystemExit(f"[chacmd-build] 找不到 spec：{SPEC}")

    # 1) PyInstaller 冻结
    print(f"[chacmd-build] PyInstaller 冻结 → {DIST}")
    subprocess.run(
        [sys.executable, "-m", "PyInstaller", str(SPEC), "--noconfirm", "--distpath", str(CHACMD_ROOT / "dist")],
        cwd=str(CHACMD_ROOT),
        check=True,
    )
    if not (DIST / _exe_name()).exists():
        raise SystemExit(f"[chacmd-build] 冻结产物缺 exe：{DIST / _exe_name()}")

    # 2) 拷到 Tauri resources（先清旧）
    if DESKTOP_RES.exists():
        shutil.rmtree(DESKTOP_RES)
    DESKTOP_RES.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(DIST, DESKTOP_RES)
    print(f"[chacmd-build] 已拷到 → {DESKTOP_RES}")
    print("[chacmd-build] 完成。记得在 tauri.chacmd.conf.json 的 bundle.resources 打开 'chacmd-server/**/*'，")
    print("               并在 src-tauri/src/sidecar.rs 接入第二 sidecar 启动（见 DEVELOPMENT.md §4.3）。")


def _exe_name() -> str:
    return "chacmd-server.exe" if sys.platform.startswith("win") else "chacmd-server"


if __name__ == "__main__":
    main()
