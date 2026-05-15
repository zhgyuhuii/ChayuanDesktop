#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一键下载 / 替换 vendor/bundled_models/ 里的"瘦身默认集"。

为什么用这个脚本而不是 ``hf download``
=========================================

1. ``hf`` CLI 在国内常因 huggingface.co 不可达 / HF_ENDPOINT 没生效 / CLI 版本
   被 deprecated(huggingface-cli → hf)等问题挂掉。这里直接用 ``huggingface_hub``
   的 Python API,镜像在脚本里写死,绕开各种环境差异。
2. 同时承担"瘦身"职责:Windows installer 单文件 < 2 GB 硬上限,把 chat /
   embedding / reranker 三大件换成 < 2 GB 的小版本。

默认下载清单(全部 < 2 GB,Windows installer 友好)
====================================================

| capability | repo                                        | file / snapshot           | size    |
|------------|---------------------------------------------|---------------------------|---------|
| chat       | unsloth/Qwen3-4B-Instruct-2507-GGUF         | Q3_K_S 量化(单文件)       | ~1.85 GB |
| embedding  | Alibaba-NLP/gte-multilingual-base           | snapshot(整仓)            | ~1.22 GB |
| rerank     | Alibaba-NLP/gte-multilingual-reranker-base  | snapshot(整仓)            | ~584 MB  |
| asr        | ggerganov/whisper.cpp                       | ggml-tiny.bin             | ~74 MB   |

OCR / image 默认不下,需要的话去 chayuan-server/vendor/bundled_models/README.md
按 ``hf download`` 命令手动拉。

用法
====

# 全量(默认 4 大件)
python scripts/install-bundled-models.py

# 只下 chat / embedding / rerank / asr 之一
python scripts/install-bundled-models.py --only chat

# 先清掉每个 cap 子目录里的旧文件再下(干净换装)
python scripts/install-bundled-models.py --clean

# 强制走另一个镜像 / 直连官方 HF
python scripts/install-bundled-models.py --endpoint https://hf-mirror.com
python scripts/install-bundled-models.py --endpoint https://huggingface.co

环境
====

只需要 Python ≥ 3.10。脚本会自动 pip install ``huggingface_hub`` 如果没装。
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

# ===== 镜像优先级:CLI 显式 > 环境变量 > hf-mirror.com 默认 =====
DEFAULT_ENDPOINTS = [
    "https://hf-mirror.com",   # 国内首选(免登录、社区维护)
    "https://huggingface.co",  # 兜底
]

# ===== 下载清单 =====
# 注意:dest_subdir 用 ``__`` 替代 ``/``,贴合 huggingface_hub 镜像化命名习惯,
# 而且 Windows 文件系统不允许子目录名含 ``/``。chayuan 加载逻辑只看相对路径。
MANIFEST = {
    "chat": {
        "repo": "unsloth/Qwen3-4B-Instruct-2507-GGUF",
        "filename": "Qwen3-4B-Instruct-2507-Q3_K_S.gguf",
        "dest_subdir": "unsloth__Qwen3-4B-Instruct-2507-GGUF",
        "approx_mb": 1850,
        "note": "Qwen3-4B 中文 chat,Q3_K_S 量化(~1.85 GB,装 NSIS/WiX 都过得了)",
    },
    "embedding": {
        "repo": "Alibaba-NLP/gte-multilingual-base",
        "snapshot": True,
        "allow_patterns": [
            "*.json", "*.txt", "*.safetensors", "*.bin",
            "sentencepiece*", "tokenizer*", "vocab*",
        ],
        "dest_subdir": "Alibaba-NLP__gte-multilingual-base",
        "approx_mb": 1220,
        "note": "Alibaba 多语种 embedding(~1.22 GB,跟 reranker 对齐)",
    },
    "rerank": {
        "repo": "Alibaba-NLP/gte-multilingual-reranker-base",
        "snapshot": True,
        "allow_patterns": [
            "*.json", "*.txt", "*.safetensors", "*.bin",
            "sentencepiece*", "tokenizer*", "vocab*",
        ],
        "dest_subdir": "Alibaba-NLP__gte-multilingual-reranker-base",
        "approx_mb": 584,
        "note": "Alibaba 多语种 reranker(~584 MB,从 bge-reranker-v2-m3 2.12 GB 瘦身)",
    },
    "asr": {
        "repo": "ggerganov/whisper.cpp",
        "filename": "ggml-tiny.bin",
        "dest_subdir": "ggerganov__whisper.cpp",
        "approx_mb": 74,
        "note": "whisper.cpp tiny(~74 MB)",
    },
}


def _print(msg: str) -> None:
    print(msg, flush=True)


def _ensure_hf_lib() -> None:
    """缺 huggingface_hub 就 pip install,避免用户额外操作。"""
    try:
        import huggingface_hub  # noqa: F401
    except ImportError:
        _print("[install] 检测到未装 huggingface_hub,自动 pip 安装...")
        subprocess.check_call([
            sys.executable, "-m", "pip", "install",
            "--upgrade", "huggingface_hub>=0.24,<1.0",
        ])


def _pick_endpoint(user_pref: str | None) -> str:
    """选镜像:CLI > 环境变量 > 默认列表第一。"""
    if user_pref:
        return user_pref.rstrip("/")
    env = os.environ.get("HF_ENDPOINT", "").strip().rstrip("/")
    if env:
        return env
    return DEFAULT_ENDPOINTS[0]


def _set_endpoint(endpoint: str) -> None:
    """huggingface_hub 在 import 时读 HF_ENDPOINT,必须在 import 前设。"""
    os.environ["HF_ENDPOINT"] = endpoint
    # 个别旧版本看 HUGGINGFACE_HUB_ENDPOINT,一并设
    os.environ["HUGGINGFACE_HUB_ENDPOINT"] = endpoint


def _resolve_vendor_root() -> Path:
    """定位 chayuan-server/vendor/bundled_models/(从本脚本相对路径推)。"""
    here = Path(__file__).resolve()
    # scripts/install-bundled-models.py  →  ../chayuan-server/vendor/bundled_models
    candidate = here.parent.parent / "chayuan-server" / "vendor" / "bundled_models"
    if candidate.is_dir():
        return candidate
    raise SystemExit(
        f"找不到 vendor/bundled_models/,期望在:{candidate}\n"
        f"如果你的工作区结构不同,把仓库根传给 --workspace。"
    )


def _download_one(cap: str, spec: dict, *, vendor_root: Path, clean: bool) -> None:
    from huggingface_hub import hf_hub_download, snapshot_download
    from huggingface_hub.utils import HfHubHTTPError

    cap_dir = vendor_root / cap
    dest_dir = cap_dir / spec["dest_subdir"]
    cap_dir.mkdir(parents=True, exist_ok=True)

    if clean and dest_dir.exists():
        _print(f"[{cap}] --clean:删除旧目录 {dest_dir}")
        shutil.rmtree(dest_dir)

    dest_dir.mkdir(parents=True, exist_ok=True)

    _print(f"[{cap}] ↓ {spec['repo']}  (~{spec['approx_mb']} MB)")
    _print(f"        {spec['note']}")
    _print(f"        local_dir = {dest_dir}")
    try:
        if spec.get("snapshot"):
            snapshot_download(
                repo_id=spec["repo"],
                local_dir=str(dest_dir),
                allow_patterns=spec.get("allow_patterns"),
                resume_download=True,
            )
        else:
            hf_hub_download(
                repo_id=spec["repo"],
                filename=spec["filename"],
                local_dir=str(dest_dir),
                resume_download=True,
            )
    except HfHubHTTPError as e:
        _print(f"[{cap}] FAIL: {e}")
        _print(f"        换镜像重试:--endpoint <url>(目前: {os.environ.get('HF_ENDPOINT')})")
        raise
    _print(f"[{cap}] ✓ 完成")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--only",
        choices=list(MANIFEST.keys()),
        help="只下指定 capability,不传 = 全下",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="下载前清空目标子目录(干净换装)",
    )
    parser.add_argument(
        "--endpoint",
        help=("HF 镜像 URL,优先级最高。默认 hf-mirror.com;"
              "如果它挂了试 --endpoint https://huggingface.co 直连官方。"),
    )
    parser.add_argument(
        "--workspace",
        type=Path,
        help="仓库根目录(含 chayuan-server/)。不传 = 由脚本相对路径自动推。",
    )
    args = parser.parse_args()

    endpoint = _pick_endpoint(args.endpoint)
    _set_endpoint(endpoint)
    _print(f"[install] 使用镜像:{endpoint}")
    _print(f"[install] (改镜像:重跑时加 --endpoint https://huggingface.co)")

    _ensure_hf_lib()

    if args.workspace:
        vendor_root = args.workspace / "chayuan-server" / "vendor" / "bundled_models"
        if not vendor_root.is_dir():
            raise SystemExit(f"--workspace 指向的路径下找不到 vendor/bundled_models/: {vendor_root}")
    else:
        vendor_root = _resolve_vendor_root()
    _print(f"[install] vendor_root = {vendor_root}")
    _print("")

    plan = [args.only] if args.only else list(MANIFEST.keys())
    failures = []
    for cap in plan:
        spec = MANIFEST[cap]
        try:
            _download_one(cap, spec, vendor_root=vendor_root, clean=args.clean)
        except Exception as e:
            failures.append((cap, str(e)))
        _print("")

    if failures:
        _print("[install] 部分下载失败:")
        for cap, err in failures:
            _print(f"  - {cap}: {err}")
        _print("")
        _print("常见排查:")
        _print("  1) 镜像挂了:--endpoint https://huggingface.co 直连官方")
        _print("  2) 仓库变了:去 https://hf-mirror.com 搜对应 repo 看路径")
        _print("  3) 网络:加代理或换镜像")
        return 1

    _print("[install] 全部完成。下一步:")
    _print("  - cd 到仓库根 → .\\build-desktop.cmd -IntegratedOnly(Windows)")
    _print("  - 或 ./build-desktop.sh --integrated-only(Linux/Mac)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
