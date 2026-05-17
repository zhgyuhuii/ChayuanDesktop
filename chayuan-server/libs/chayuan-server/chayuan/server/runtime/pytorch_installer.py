"""PyTorch + torchvision 检测与安装器。

为什么需要这个模块
==================
``chayuan-server`` 的 image 能力(jina-clip / siglip2 / RapidOCR 之类)走
``transformers`` → ``transformers.image_utils`` import ``torchvision.transforms.
InterpolationMode`` → 触发 torchvision **加载注册算子**(``torchvision::nms``)。
torch 跟 torchvision 是 C++ ABI 严格配对的:torch 2.11 ↔ torchvision 0.26、
torch 2.6 ↔ torchvision 0.21……版本错配就出 ``operator torchvision::nms does
not exist`` 链路崩。

PyTorch wheel 本身**不打包进 chayuan-server installer**:
  - 体积:CPU ~250 MB,CUDA 2-3 GB;
  - 不能二选一发版(CPU/CUDA 同包名不同 wheel);
  - GPU 用户必须从 ``https://download.pytorch.org/whl/cuXXX`` 装,不能用 PyPI 默认源。

本模块负责:
  - **detect**:跑 ``nvidia-smi`` 看有没有 GPU;读当前 env 装的 torch/torchvision
    版本,验证它们能否 import(不报 nms 错)。
  - **build_install_recipe**:按 CPU/CUDA variant 拼一条 ``pip install`` 命令,
    交给 ``install_task_manager.start()`` 异步跑,前端流式取日志。
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

logger = logging.getLogger("chayuan.runtime.pytorch_installer")

# CUDA 版本 → PyTorch wheel index;按"新优先 + LTS 优先"顺序
# (用户 NVIDIA 驱动版本反推可装 CUDA 上限,这里给推荐 wheel)
_PYTORCH_INDEXES: Dict[str, str] = {
    "cpu":   "https://download.pytorch.org/whl/cpu",
    "cu118": "https://download.pytorch.org/whl/cu118",
    "cu121": "https://download.pytorch.org/whl/cu121",
    "cu124": "https://download.pytorch.org/whl/cu124",
    "cu126": "https://download.pytorch.org/whl/cu126",
}

# NVIDIA 驱动版本 → 最高可装 CUDA(参考 PyTorch 官方兼容表;保守取整)
# 用户驱动 >= 这些版本就能装对应 CUDA;否则降级
_DRIVER_TO_CUDA: List[tuple[int, str]] = [
    (560, "cu126"),
    (525, "cu124"),
    (515, "cu121"),
    (450, "cu118"),
]

Variant = Literal["cpu", "cu118", "cu121", "cu124", "cu126", "auto"]


@dataclass
class TorchStatus:
    """detect_status() 返回结构。"""
    torch_version: Optional[str] = None
    torch_cuda_build: Optional[str] = None       # "cu124" / "cpu" / None=未装
    torchvision_version: Optional[str] = None
    import_ok: bool = False                       # 整个 import 链能否走通
    import_error: Optional[str] = None            # 不通时的诊断字符串
    has_nvidia_gpu: bool = False
    nvidia_driver: Optional[str] = None           # "560.94" 之类
    suggested_variant: Variant = "cpu"            # 建议的安装 variant(给"一键自动")
    can_install: bool = True                      # pip 可用、磁盘有空间
    # 内置(离线)wheel 是否可用 — 用户无网情况下也能装上
    offline_wheels_available: bool = False
    offline_wheels_dir: Optional[str] = None      # 调试用,告诉用户去哪看
    notes: List[str] = field(default_factory=list)  # 给前端的额外提示

    def to_dict(self) -> Dict[str, Any]:
        return {
            "torch_version": self.torch_version,
            "torch_cuda_build": self.torch_cuda_build,
            "torchvision_version": self.torchvision_version,
            "import_ok": self.import_ok,
            "import_error": self.import_error,
            "has_nvidia_gpu": self.has_nvidia_gpu,
            "nvidia_driver": self.nvidia_driver,
            "suggested_variant": self.suggested_variant,
            "can_install": self.can_install,
            "offline_wheels_available": self.offline_wheels_available,
            "offline_wheels_dir": self.offline_wheels_dir,
            "notes": list(self.notes),
        }


def _detect_nvidia() -> tuple[bool, Optional[str]]:
    """跑 ``nvidia-smi`` 探有没有 NVIDIA GPU + 驱动版本。

    返 (has_gpu, driver_version)。失败一律返 (False, None)。
    """
    if not shutil.which("nvidia-smi"):
        return False, None
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5,
        )
    except (subprocess.TimeoutExpired, OSError):
        return False, None
    if r.returncode != 0:
        return False, None
    line = (r.stdout or "").strip().splitlines()
    if not line:
        return True, None  # GPU 有但拿不到驱动版本(罕见)
    drv = line[0].strip()
    return True, drv or None


def _suggest_cuda_variant(driver: Optional[str]) -> str:
    """驱动 → 推荐 CUDA wheel。驱动太老或拿不到 → cpu。"""
    if not driver:
        return "cpu"
    try:
        major = int(re.split(r"[.\s]+", driver, maxsplit=1)[0])
    except (ValueError, IndexError):
        return "cpu"
    for min_major, variant in _DRIVER_TO_CUDA:
        if major >= min_major:
            return variant
    return "cpu"


def _offline_wheels_dir() -> Optional[Path]:
    """找内置 PyTorch wheel 的目录(无网安装兜底)。

    探测顺序(跟 model_registry.local_index.bundled_models_dir 风格一致):
      1. ``$CHAYUAN_TORCH_WHEELS_DIR`` 环境变量(运维 / CI 自定义)
      2. PyInstaller frozen:``sys._MEIPASS / vendor / torch_wheels``
      3. dev 仓库:``<repo>/vendor/torch_wheels``
      4. 可执行文件同级:``<argv0_dir>/vendor/torch_wheels``

    目录约定:wheel 文件直接平铺在目录下,文件名形如
      ``torch-2.6.0+cpu-cp312-cp312-win_amd64.whl``
      ``torchvision-0.21.0+cpu-cp312-cp312-win_amd64.whl``
    脚本不再细分子目录 — pip 装 wheel 时会自己按 platform tag 拒绝不兼容的。
    """
    env = os.environ.get("CHAYUAN_TORCH_WHEELS_DIR")
    if env:
        p = Path(env).expanduser()
        if p.is_dir():
            return p

    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        p = Path(meipass) / "vendor" / "torch_wheels"
        if p.is_dir():
            return p

    # dev: <repo>/libs/chayuan-server/chayuan/server/runtime/pytorch_installer.py
    #       parents[5] = <repo>(chayuan-server 仓库根)
    try:
        repo_root = Path(__file__).resolve().parents[5]
        p = repo_root / "vendor" / "torch_wheels"
        if p.is_dir():
            return p
    except (IndexError, OSError):
        pass

    try:
        argv0 = Path(sys.argv[0]).resolve()
        if argv0.is_file():
            p = argv0.parent / "vendor" / "torch_wheels"
            if p.is_dir():
                return p
    except (IndexError, OSError):
        pass

    return None


def _find_offline_wheels(variant: str) -> List[Path]:
    """在 offline_wheels_dir 找匹配本机 + variant 的 torch / torchvision wheel。

    返回 [torch_wheel, torchvision_wheel](顺序,各零一个)。找不全返空 list 让
    caller 走在线 fallback。
    """
    d = _offline_wheels_dir()
    if d is None:
        return []
    # 选 wheel 的最简策略:文件名包含 "torch-" / "torchvision-",且
    # variant tag 出现在 +build 段或 abi tag 段。
    # 例如 cpu:torch-2.6.0+cpu-cp312-cp312-win_amd64.whl
    # 例如 cu124:torch-2.6.0+cu124-cp312-cp312-win_amd64.whl
    # 但 PyPI 官方 cpu wheel 文件名是 torch-2.6.0-cp312-...(没 +cpu),
    # 所以 cpu 走 "没 +cuXXX" 兜底。
    found_torch: Optional[Path] = None
    found_tv: Optional[Path] = None
    for whl in d.glob("*.whl"):
        name = whl.name.lower()
        if variant == "cpu":
            # cpu wheel 通常没 +cuXXX,文件名也不含 cu1xx
            if "+cu" in name:
                continue
        else:
            # CUDA wheel 必须含 +cuXXX 标识
            if f"+{variant}-" not in name and f"+{variant}.whl" not in name:
                continue
        if name.startswith("torch-") and found_torch is None:
            found_torch = whl
        elif name.startswith("torchvision-") and found_tv is None:
            found_tv = whl
    if found_torch and found_tv:
        return [found_torch, found_tv]
    return []


def _probe_torch_install() -> tuple[Optional[str], Optional[str]]:
    """返 (torch_version, torch_cuda_build);未装返 (None, None)。"""
    try:
        import torch  # type: ignore
    except ImportError:
        return None, None
    ver = getattr(torch, "__version__", "") or ""
    # 形如 "2.11.0+cu124" / "2.11.0+cpu" / "2.11.0"(PyPI 默认就是 cpu)
    if "+" in ver:
        base, build = ver.split("+", 1)
        return base, build
    return ver or None, "cpu"


def _probe_torchvision_install() -> Optional[str]:
    try:
        import torchvision  # type: ignore
    except ImportError:
        return None
    except Exception as e:  # noqa: BLE001 — torchvision import 时若 ABI 不配也会抛 RuntimeError
        logger.info("torchvision import 抛异常但版本可拿: %r", e)
        try:
            from importlib.metadata import version
            return version("torchvision")
        except Exception:  # noqa: BLE001
            return None
    return getattr(torchvision, "__version__", None)


def _probe_import_chain() -> tuple[bool, Optional[str]]:
    """模拟 transformers.image_utils 的关键 import,看链路是否健康。"""
    try:
        # 这一句正是 transformers 4.5x image_utils.py 第 55 行的 import
        from torchvision.transforms import InterpolationMode  # noqa: F401
        return True, None
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


def detect_status() -> TorchStatus:
    """组装当前 PyTorch 安装状态。"""
    has_gpu, drv = _detect_nvidia()
    torch_ver, torch_build = _probe_torch_install()
    tv_ver = _probe_torchvision_install()
    import_ok, import_err = _probe_import_chain()
    suggested = _suggest_cuda_variant(drv) if has_gpu else "cpu"

    notes: List[str] = []
    if has_gpu and suggested == "cpu":
        notes.append(
            f"检测到 NVIDIA GPU 但驱动版本 {drv!r} 太老,装 CUDA 版可能不工作;"
            "建议先升级 NVIDIA 驱动到 525+ 再装 CUDA 12.4 版"
        )
    if torch_ver and not import_ok:
        notes.append(
            f"torch {torch_ver} 已装但 import 链断裂 — 多半是 torchvision 跟 "
            "torch 版本不配对,建议重装 torch + torchvision(本面板会同步装两个)"
        )

    offline_dir = _offline_wheels_dir()
    offline_ok = bool(offline_dir and _find_offline_wheels(suggested))
    if offline_dir and not offline_ok:
        notes.append(
            f"内置 wheel 目录存在({offline_dir})但找不到匹配 {suggested} variant 的 "
            "torch+torchvision 配对;离线安装不可用,将走在线下载"
        )

    return TorchStatus(
        torch_version=torch_ver,
        torch_cuda_build=torch_build,
        torchvision_version=tv_ver,
        import_ok=import_ok,
        import_error=import_err,
        has_nvidia_gpu=has_gpu,
        nvidia_driver=drv,
        suggested_variant=suggested,  # type: ignore[arg-type]
        can_install=shutil.which("pip") is not None or bool(sys.executable),
        offline_wheels_available=offline_ok,
        offline_wheels_dir=str(offline_dir) if offline_dir else None,
        notes=notes,
    )


def build_install_recipe(
    variant: Variant, *,
    torch_spec: str = ">=2.1,<3.0",
    torchvision_spec: str = "",
    prefer_offline: bool = True,
) -> "InstallRecipe":
    """生成 ``pip install`` InstallRecipe。

    选择逻辑:
      1. ``prefer_offline=True`` 且 vendor 目录有匹配 wheel → 直接 ``pip install
         <torch-whl> <torchvision-whl>`` 离线装,**无需联网**。
      2. 否则 ``pip install --upgrade torch torchvision --index-url <pytorch-cdn>``
         走在线 wheel 源(PyTorch 官方 ``download.pytorch.org/whl/<variant>``)。

    用户环境完全离线时,只要 chayuan installer 把 wheel 打到 ``vendor/torch_wheels/``
    就能装上 — 这是 enterprise / 内网部署的常见诉求。

    一条 pip 同时装 torch + torchvision,**保证版本配对**(pip 解依赖 / 离线
    wheel 显式都打进同一命令)。
    """
    from chayuan.server.config_panel.install_task_manager import InstallRecipe

    if variant == "auto":
        s = detect_status()
        variant = s.suggested_variant  # type: ignore[assignment]
    if variant not in _PYTORCH_INDEXES:
        raise ValueError(f"unknown variant: {variant!r}; expected one of {tuple(_PYTORCH_INDEXES)}")

    # 优先离线 wheel(无网兜底)
    if prefer_offline:
        offline = _find_offline_wheels(variant)
        if offline:
            cmd = [
                sys.executable, "-m", "pip", "install", "--upgrade",
                "--no-index",  # 完全不查网,只用本地 wheel + 它们的 transitive
                "--find-links", str(offline[0].parent),  # 让 pip 在同目录找 deps
                *[str(p) for p in offline],
            ]
            return InstallRecipe(
                label=f"PyTorch {variant} (离线 wheel)",
                cmd=cmd,
                note=(
                    f"用内置的 torch + torchvision {variant} wheel 安装(无需网络)。"
                    f" 路径:{offline[0].parent}。装完需重启 chayuan-server 才能 import 新版本。"
                ),
                requires="",
            )

    # 在线 fallback
    index_url = _PYTORCH_INDEXES[variant]
    pkgs = [f"torch{torch_spec}"]
    pkgs.append("torchvision" if not torchvision_spec else f"torchvision{torchvision_spec}")
    cmd = [
        sys.executable, "-m", "pip", "install", "--upgrade",
        *pkgs,
        "--index-url", index_url,
    ]
    return InstallRecipe(
        label=f"PyTorch {variant} (在线 · 官方源)",
        cmd=cmd,
        note=(
            f"装 torch + torchvision({variant} wheel)— 同一条 pip 保证版本配对。"
            f" 包大小:CPU ~250MB / CUDA ~2-3GB。装完需重启 chayuan-server 才能 import 新版本。"
        ),
        requires="",
    )


def start_install(variant: Variant = "auto", *,
                    prefer_offline: bool = True) -> "InstallTask":
    """启动 PyTorch 安装 task。返 InstallTask(含 task_id,前端轮询查进度)。

    ``prefer_offline=True``(默认):有内置 wheel 用内置,没有走在线。
    ``prefer_offline=False``:强制在线(用户可能要更新的 wheel 版本)。
    """
    from chayuan.server.config_panel.install_task_manager import get_install_manager
    recipe = build_install_recipe(variant, prefer_offline=prefer_offline)
    framework = f"pytorch-{variant if variant != 'auto' else detect_status().suggested_variant}"
    return get_install_manager().start(framework=framework, recipe=recipe)
