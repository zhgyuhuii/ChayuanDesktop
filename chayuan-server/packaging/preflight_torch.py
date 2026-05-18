"""打包前置:PyTorch + torchvision 离线 wheel 自动下载。

为什么需要
==========
chayuan-server 的 image 能力(jina-clip / siglip2 / RapidOCR + transformers)
硬依赖 ``torch`` + ``torchvision``。wheel 体积:CPU ~250 MB、CUDA 2-3 GB,**不
进 PyPI 默认源**(PyPI 上的 ``torch`` 是 NVIDIA 全家桶变种,而 PyTorch 官方
按 CPU/CUDA 拆 wheel 放 ``download.pytorch.org/whl/<variant>``)。

打包链路前置:**装机时如果用户没网,chayuan-server 也要能装上 torchvision**
(``chayuan/server/runtime/pytorch_installer.py`` 的离线兜底)。所以构建时
要把目标 platform 的 wheel 提前下到 ``vendor/torch_wheels/`` 让 PyInstaller
打进 frozen 包。

行为
====
- 扫 ``vendor/torch_wheels/`` 看每个目标 (platform, py_version, variant) 是否
  已有 torch + torchvision 配对 wheel;
- 缺的用 ``pip download`` 走 PyTorch 官方 wheel 源拉(``--index-url
  https://download.pytorch.org/whl/<variant>`` + ``--platform xxx``
  ``--python-version 3xx`` ``--only-binary=:all: --no-deps``);
- 已有的跳过,不重下;
- 下载失败 → raise(打包链路报错,不静默继续)— 用户用 ``--allow-missing``
  显式跳过本步骤。
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional

# 仓库根目录(packaging/preflight_torch.py 在 packaging/ 下)
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT_ROOT = ROOT / "vendor" / "torch_wheels"

# PyTorch 官方 wheel 源 — variant → index URL
_PYTORCH_INDEXES = {
    "cpu":   "https://download.pytorch.org/whl/cpu",
    "cu118": "https://download.pytorch.org/whl/cu118",
    "cu121": "https://download.pytorch.org/whl/cu121",
    "cu124": "https://download.pytorch.org/whl/cu124",
    "cu126": "https://download.pytorch.org/whl/cu126",
}

# Rust target triple → pip --platform tag(PyInstaller 跨平台打包用)
# 注:CPU/CUDA wheel 都按这个 platform tag 区分 Windows/Linux/macOS
_PLATFORM_TAG = {
    "x86_64-pc-windows-msvc": "win_amd64",
    "aarch64-pc-windows-msvc": "win_arm64",
    "x86_64-unknown-linux-gnu": "manylinux2014_x86_64",
    "aarch64-unknown-linux-gnu": "manylinux2014_aarch64",
    "x86_64-apple-darwin": "macosx_10_9_x86_64",
    "aarch64-apple-darwin": "macosx_11_0_arm64",
}

# CUDA wheel 只在 Windows / Linux 有(PyTorch 官方);macOS 无 CUDA
_CUDA_PLATFORMS = {"win_amd64", "manylinux2014_x86_64"}


@dataclass(frozen=True)
class WheelTarget:
    """一组要下的 wheel 目标。"""
    platform: str        # pip --platform tag,如 "win_amd64"
    py_version: str      # pip --python-version, 如 "312"
    variant: str         # cpu / cu118 / cu121 / cu124 / cu126

    @property
    def subdir(self) -> str:
        """子目录名:platform_py<ver>_<variant>,例:win_amd64_py312_cpu"""
        return f"{self.platform}_py{self.py_version}_{self.variant}"

    @property
    def index_url(self) -> str:
        return _PYTORCH_INDEXES[self.variant]


def _list_existing_wheels(target_dir: Path) -> tuple[Optional[Path], Optional[Path]]:
    """返 (torch_wheel, torchvision_wheel),都不在返 (None, None)。"""
    if not target_dir.is_dir():
        return None, None
    torch_whl = None
    tv_whl = None
    for p in target_dir.glob("*.whl"):
        name = p.name.lower()
        if name.startswith("torch-") and torch_whl is None:
            torch_whl = p
        elif name.startswith("torchvision-") and tv_whl is None:
            tv_whl = p
    return torch_whl, tv_whl


def _download(target: WheelTarget, out_dir: Path, *,
                torch_spec: str = ">=2.6,<3.0",
                torchvision_spec: str = "") -> None:
    """用 ``pip download`` 拉 torch + torchvision 到 out_dir。

    --no-deps 避免下整棵依赖树(transformers / numpy 等运行时已经在);
    --only-binary=:all: 只要 wheel;
    --platform + --python-version 跨平台下载(允许在 Linux 构建机下 Windows wheel)。
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    pkgs = [f"torch{torch_spec}"]
    pkgs.append("torchvision" if not torchvision_spec else f"torchvision{torchvision_spec}")
    cmd = [
        sys.executable, "-m", "pip", "download",
        "--only-binary=:all:",
        "--no-deps",
        "--platform", target.platform,
        "--python-version", target.py_version,
        "--implementation", "cp",
        "--abi", f"cp{target.py_version}",
        "--dest", str(out_dir),
        "--index-url", target.index_url,
        *pkgs,
    ]
    print(f"[preflight-torch] downloading {target.subdir} → {out_dir}")
    print(f"  $ {' '.join(cmd)}")
    r = subprocess.run(cmd, check=False)
    if r.returncode != 0:
        raise RuntimeError(
            f"pip download failed for {target.subdir}(return code {r.returncode});"
            f"详见上方 pip 输出。常见原因:1) 网络到 download.pytorch.org 不通;"
            f"2) PyTorch 这个 variant 没有该 platform/py 组合的 wheel;"
            f"3) torch_spec/torchvision_spec 不在 PyTorch 索引里"
        )


def preflight(
    targets: Iterable[WheelTarget],
    *, out_root: Path = DEFAULT_OUT_ROOT,
    allow_missing: bool = False,
    force: bool = False,
    strict_vendor: bool = False,
) -> List[Path]:
    """按 targets 列表逐个 ensure wheel 在 ``out_root/<target.subdir>/``。

    返回 wheel 文件路径 list(已就绪 + 新下载的)。
    allow_missing=True 时下载失败只 warning,不抛。
    force=True 时已有也重下。
    strict_vendor=True 时**禁止任何网络下载** — vendor 没找到配对 wheel
      直接报错抛 RuntimeError。给"installer 必须完全离线、源只能是 vendor/"
      的桌面打包场景用,避免静默走 download.pytorch.org 后用户内网环境根
      本下不到 wheel。
    """
    out_root.mkdir(parents=True, exist_ok=True)
    all_wheels: List[Path] = []
    for t in targets:
        sub = out_root / t.subdir
        torch_w, tv_w = _list_existing_wheels(sub)
        if torch_w and tv_w and not force:
            print(f"[preflight-torch] {t.subdir}: vendor 已就绪 ({torch_w.name} + {tv_w.name})")
            all_wheels.extend([torch_w, tv_w])
            continue
        if strict_vendor:
            msg = (
                f"strict-vendor 模式下 vendor/torch_wheels/{t.subdir}/ 缺 torch + torchvision wheel,"
                f"且禁止 pip download fallback。请手动把 *.whl 放到:\n"
                f"  {sub}\n"
                f"  期望文件名:torch-*-{t.platform}.whl + torchvision-*-{t.platform}.whl\n"
                f"  下载源(其它有网机器):{t.index_url}"
            )
            if allow_missing:
                print(f"[preflight-torch] WARN {msg}", file=sys.stderr)
                continue
            raise RuntimeError(msg)
        try:
            _download(t, sub)
        except Exception as e:  # noqa: BLE001
            if allow_missing:
                print(f"[preflight-torch] WARN {t.subdir} 下载失败,跳过: {e}", file=sys.stderr)
                continue
            raise
        torch_w, tv_w = _list_existing_wheels(sub)
        if not (torch_w and tv_w):
            msg = f"下载完成但未找到配对 wheel({sub})"
            if allow_missing:
                print(f"[preflight-torch] WARN {msg}", file=sys.stderr)
                continue
            raise RuntimeError(msg)
        all_wheels.extend([torch_w, tv_w])
    return all_wheels


def parse_variants(arg: str) -> List[str]:
    """``cpu,cu124`` → ``['cpu', 'cu124']``。空 → ``['cpu']``。"""
    if not arg:
        return ["cpu"]
    out: List[str] = []
    for v in arg.split(","):
        v = v.strip().lower()
        if not v:
            continue
        if v not in _PYTORCH_INDEXES:
            raise ValueError(f"unknown variant {v!r}; expected one of {tuple(_PYTORCH_INDEXES)}")
        out.append(v)
    return out or ["cpu"]


def build_targets(
    platforms: Iterable[str],
    py_versions: Iterable[str],
    variants: Iterable[str],
) -> List[WheelTarget]:
    """笛卡尔积生成 targets;自动过滤 macOS+CUDA(没有)。"""
    out: List[WheelTarget] = []
    for plat in platforms:
        for py in py_versions:
            for var in variants:
                if var != "cpu" and plat not in _CUDA_PLATFORMS:
                    # macOS / win_arm64 没 CUDA wheel,跳过
                    continue
                out.append(WheelTarget(platform=plat, py_version=py, variant=var))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(
        description="预下载 PyTorch + torchvision wheel 到 vendor/torch_wheels/,"
                    "供 PyInstaller 打包 + 离线 chayuan-server 装机用。"
    )
    parser.add_argument("--platforms", default="win_amd64",
                          help="逗号分隔的 pip --platform tag 列表,默认 win_amd64")
    parser.add_argument("--py-versions", default="312",
                          help="逗号分隔的 Python 版本(无点,如 312),默认 312")
    parser.add_argument("--variants", default="cpu",
                          help="逗号分隔的 PyTorch variant,默认 cpu;可选 cu118/cu121/cu124/cu126")
    parser.add_argument("--out-root", default=str(DEFAULT_OUT_ROOT),
                          help=f"wheel 目标根目录,默认 {DEFAULT_OUT_ROOT}")
    parser.add_argument("--allow-missing", action="store_true",
                          help="某 variant 下载失败只 warning 不抛(打包链路继续)")
    parser.add_argument("--force", action="store_true",
                          help="已有 wheel 也重下")
    args = parser.parse_args()

    platforms = [p.strip() for p in args.platforms.split(",") if p.strip()]
    py_versions = [v.strip() for v in args.py_versions.split(",") if v.strip()]
    variants = parse_variants(args.variants)

    targets = build_targets(platforms, py_versions, variants)
    if not targets:
        print("[preflight-torch] no targets;退出", file=sys.stderr)
        return 0
    print(f"[preflight-torch] 目标 {len(targets)} 组: "
          + ", ".join(t.subdir for t in targets))

    out_root = Path(args.out_root).expanduser().resolve()
    try:
        preflight(targets, out_root=out_root,
                    allow_missing=args.allow_missing, force=args.force)
    except Exception as e:  # noqa: BLE001
        print(f"[preflight-torch] FAIL: {e}", file=sys.stderr)
        return 2
    print("[preflight-torch] ✓ 全部就绪")
    return 0


if __name__ == "__main__":
    sys.exit(main())
