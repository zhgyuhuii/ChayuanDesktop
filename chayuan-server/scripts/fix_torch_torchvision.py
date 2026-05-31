"""修复 torch / torchvision ABI 错配(operator torchvision::nms does not exist)。

原理
====
torch 与 torchvision 是 C++ ABI 严格配对的,版本错配 torchvision 的算子
(torchvision::nms)注册不上,任何走 transformers.image_utils → torchvision 的
链路(modelscope / voxcpm 去噪器 / CLIP 图像向量化)都会崩。

官方配对(github.com/pytorch/vision):
    torch 2.6 <-> torchvision 0.21      torch 2.9  <-> torchvision 0.24
    torch 2.7 <-> torchvision 0.22      torch 2.10 <-> torchvision 0.25
    torch 2.8 <-> torchvision 0.23      torch 2.11 <-> torchvision 0.26
规律:torchvision 次版本 = torch 次版本 + 15。

本脚本:读当前 torch 版本 + CUDA 构建(如 +cu130)-> 算出配套 torchvision ->
从同一 download.pytorch.org/whl/<build> 源用 --no-deps 装(不动已装的 torch)->
验证 torchvision::nms 注册成功。

用法
====
    python scripts/fix_torch_torchvision.py            # 实际安装
    python scripts/fix_torch_torchvision.py --dry-run  # 只打印将执行的命令
"""
from __future__ import annotations

import subprocess
import sys


def _parse_torch() -> tuple[str, str, str]:
    """返回 (full_version, base_version, build_tag)。
    例:'2.11.0+cu130' -> ('2.11.0+cu130', '2.11.0', 'cu130');纯 CPU -> build='cpu'。"""
    import torch  # noqa: PLC0415
    full = torch.__version__
    base = full.split("+", 1)[0]
    build = full.split("+", 1)[1] if "+" in full else "cpu"
    return full, base, build


def _matched_torchvision(torch_base: str) -> str:
    """torch 2.11.0 -> torchvision 0.26.0(次版本 +15)。"""
    parts = torch_base.split(".")
    major = int(parts[0])
    minor = int(parts[1]) if len(parts) > 1 else 0
    if major != 2:
        raise SystemExit(f"只支持 torch 2.x,当前 {torch_base}")
    return f"0.{minor + 15}.0"


def main() -> int:
    dry = "--dry-run" in sys.argv
    try:
        full, base, build = _parse_torch()
    except Exception as e:  # noqa: BLE001
        print(f"[fix-tv] 读取 torch 失败(torch 没装?): {e}")
        return 2

    tv = _matched_torchvision(base)
    index = f"https://download.pytorch.org/whl/{build}"
    # +build 后缀:CPU 源上 torchvision 是 0.26.0+cpu,cuXXX 源上是 0.26.0+cuXXX。
    tv_spec = f"torchvision=={tv}+{build}" if build != "cpu" else f"torchvision=={tv}+cpu"

    print(f"[fix-tv] 当前 torch    : {full}")
    print(f"[fix-tv] 配套 torchvision: {tv_spec}")
    print(f"[fix-tv] 安装源 index   : {index}")

    # --no-deps:torchvision 的 METADATA Requires-Dist: torch==<base>,带 deps 会
    # 让 pip 试图重装/动 torch。用 --no-deps 只装 torchvision 本体,绝不碰已装 torch。
    cmd = [
        sys.executable, "-m", "pip", "install", "--no-deps", "--force-reinstall",
        tv_spec, "--index-url", index,
    ]
    print(f"[fix-tv] 执行: {' '.join(cmd)}")
    if dry:
        print("[fix-tv] --dry-run,未实际安装。")
        return 0

    rc = subprocess.call(cmd)
    if rc != 0:
        print(f"[fix-tv] pip 安装失败 rc={rc}。"
              f"\n  - 若报找不到 {tv_spec}:确认该 build 源 {index} 上有 cp{sys.version_info.major}{sys.version_info.minor} wheel;"
              f"\n  - cu130 较新,若源上还没有对应 torchvision wheel,可改装 CPU 版:"
              f"\n      pip install --no-deps --force-reinstall torchvision=={tv}+cpu --index-url https://download.pytorch.org/whl/cpu"
              f"\n    (CPU torchvision 与 cu130 torch 的 nms 算子仍可注册,够用)")
        return rc

    # 验证 nms 注册成功
    verify = [sys.executable, "-c",
              "import torchvision; from torchvision.ops import nms; "
              "print('[fix-tv] OK torchvision', torchvision.__version__, 'nms 注册成功')"]
    return subprocess.call(verify)


if __name__ == "__main__":
    raise SystemExit(main())
