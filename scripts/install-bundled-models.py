#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一键下载 / 替换 vendor/bundled_models/ 里的"瘦身默认集"。

为什么用这个脚本而不是 ``hf download``
=========================================

1. ``hf`` CLI 在国内常因 huggingface.co 不可达 / HF_ENDPOINT 没生效 / CLI 版本
   被 deprecated(huggingface-cli → hf)等问题挂掉。这里直接用 ``huggingface_hub``
   的 Python API,镜像在脚本里写死,绕开各种环境差异。
2. **新增 ModelScope fallback**:HF 的 Xet LFS 后端(``cas-bridge.xethub.hf.co``)
   不被 hf-mirror.com 代理,大文件经常卡 0%。``--source auto``(默认)先 HF,失败
   自动落到 ModelScope(国内 Alibaba 镜像,稳)。``--source modelscope`` 直接跳过
   HF。
3. 同时承担"瘦身"职责:Windows installer 单文件 < 2 GB 硬上限,把 chat /
   embedding / reranker 三大件换成 < 2 GB 的小版本。

默认下载清单(全部 < 2 GB,Windows installer 友好)
====================================================

| capability | HF repo                                    | MS repo (fallback)               | 大小      |
|------------|--------------------------------------------|----------------------------------|-----------|
| chat       | unsloth/Qwen3-4B-Instruct-2507-GGUF        | Qwen/Qwen3-4B-Instruct-2507-GGUF | ~1.8 GB   |
| embedding  | Alibaba-NLP/gte-multilingual-base          | iic/gte-multilingual-base        | ~1.22 GB  |
| rerank     | Alibaba-NLP/gte-multilingual-reranker-base | iic/gte-multilingual-reranker-base | ~584 MB |
| asr        | ggerganov/whisper.cpp                      | (无,whisper.cpp 文件小,HF 总过)  | ~74 MB    |

OCR / image 默认不下,需要的话去 chayuan-server/vendor/bundled_models/README.md
按命令手动拉。

用法
====

# 全量 + 自动 fallback(默认行为)
python scripts/install-bundled-models.py

# 已知 HF Xet 不通,直接走 ModelScope(国内最稳)
python scripts/install-bundled-models.py --source modelscope

# 只想强制 HF(用于校验镜像通畅性)
python scripts/install-bundled-models.py --source hf --endpoint https://huggingface.co

# 只下 chat / embedding / rerank / asr 之一
python scripts/install-bundled-models.py --only chat

# 先清掉每个 cap 子目录里的旧文件再下(干净换装)
python scripts/install-bundled-models.py --clean

环境
====

只需要 Python ≥ 3.10。脚本会按需自动 pip install ``huggingface_hub`` /
``modelscope``。
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

# ===== 单文件超时:让 hf 在 xethub 不通时早点放弃,落到 MS =====
# 不设置时 huggingface_hub 走 requests 默认无限等待,卡 0% 会一直挂着。
# 30 秒 + 5 次重试 ≈ 总 2-3 分钟拿不下来就 raise,fallback 介入。
_HF_DOWNLOAD_TIMEOUT_DEFAULT = "30"

# ===== 下载清单 =====
# 每个 cap 同时给 HF 和 MS 的 repo / 文件配置。MS 字段缺失 = 该 cap 不支持 MS
# fallback(默认 auto 模式下 HF 失败就直接报错)。
#
# dest_subdir 用 ``__`` 替代 owner/name 之间的 ``/``,贴合 huggingface_hub
# 镜像化命名习惯,且避免 Windows 子目录名含 ``/``。chayuan 模型扫描只看相对
# 路径下有没有 .gguf / .safetensors / config.json 等,不在乎子目录名。
MANIFEST = {
    "chat": {
        "approx_mb": 1850,
        "note": "Qwen3-4B 中文 chat,Q3 系列量化(~1.7-1.95 GB,Windows installer 友好)",
        "dest_subdir": "Qwen3-4B-Instruct-2507-GGUF",
        "hf": {
            "repo": "unsloth/Qwen3-4B-Instruct-2507-GGUF",
            "allow_patterns": ["*Q3_K_S*"],
        },
        "ms": {
            # Qwen 官方 ModelScope 仓库。官方通常只放 Q4_K_M/Q5_K_M/Q8_0,
            # 但有部分 release 包含 Q3 系列。allow_patterns 顺序优先:
            # Q3_K_S(最瘦,首选)> Q3_K_M(略肥但更稳)> IQ3(现代 imatrix)。
            # 任一存在就拉,都没有就 fail,提示用户去浏览器看 files 页面挑。
            "repo": "Qwen/Qwen3-4B-Instruct-2507-GGUF",
            "allow_patterns": ["*Q3_K_S*", "*Q3_K_M*", "*IQ3*"],
        },
    },
    "embedding": {
        "approx_mb": 1220,
        "note": "Alibaba 多语种 embedding(~1.22 GB,跟 reranker 对齐)",
        "dest_subdir": "gte-multilingual-base",
        "hf": {
            "repo": "Alibaba-NLP/gte-multilingual-base",
            "snapshot": True,
            "allow_patterns": [
                "*.json", "*.txt", "*.safetensors", "*.bin",
                "sentencepiece*", "tokenizer*", "vocab*",
            ],
        },
        "ms": {
            # ModelScope 上 Alibaba 模型在 ``iic`` (Institute for Intelligent
            # Computing,前身 ``damo``)namespace 下;某些新模型也直接挂在
            # ``Alibaba-NLP`` 同名。两个都试一下成本太高,先用 iic,失败再
            # 报错让用户去 modelscope.cn 搜对应仓库。
            "repo": "iic/gte-multilingual-base",
            "snapshot": True,
            "allow_patterns": [
                "*.json", "*.txt", "*.safetensors", "*.bin",
                "sentencepiece*", "tokenizer*", "vocab*",
            ],
        },
    },
    "rerank": {
        "approx_mb": 584,
        "note": "Alibaba 多语种 reranker(~584 MB,从 bge-reranker-v2-m3 2.12 GB 瘦身)",
        "dest_subdir": "gte-multilingual-reranker-base",
        "hf": {
            "repo": "Alibaba-NLP/gte-multilingual-reranker-base",
            "snapshot": True,
            "allow_patterns": [
                "*.json", "*.txt", "*.safetensors", "*.bin",
                "sentencepiece*", "tokenizer*", "vocab*",
            ],
        },
        "ms": {
            "repo": "iic/gte-multilingual-reranker-base",
            "snapshot": True,
            "allow_patterns": [
                "*.json", "*.txt", "*.safetensors", "*.bin",
                "sentencepiece*", "tokenizer*", "vocab*",
            ],
        },
    },
    "asr": {
        "approx_mb": 74,
        "note": "whisper.cpp tiny(~74 MB)",
        "dest_subdir": "whisper.cpp",
        "hf": {
            "repo": "ggerganov/whisper.cpp",
            "allow_patterns": ["ggml-tiny.bin"],
        },
        # 小文件,HF/hf-mirror 路径一直稳;不提供 MS fallback(MS 上也没有现成镜像)
        "ms": None,
    },
}


def _print(msg: str) -> None:
    print(msg, flush=True)


def _ensure_hf_lib() -> None:
    """缺 huggingface_hub 就 pip install。"""
    try:
        import huggingface_hub  # noqa: F401
    except ImportError:
        _print("[install] 检测到未装 huggingface_hub,自动 pip 安装...")
        subprocess.check_call([
            sys.executable, "-m", "pip", "install",
            "--upgrade", "huggingface_hub>=0.24,<1.0",
        ])


def _ensure_ms_lib() -> None:
    """缺 modelscope 就 pip install(只在用到 MS 时调)。"""
    try:
        import modelscope  # noqa: F401
    except ImportError:
        _print("[install] 检测到未装 modelscope(MS fallback 需要),自动 pip 安装...")
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "--upgrade", "modelscope",
        ])


def _pick_endpoint(user_pref: str | None) -> str:
    """选 HF 镜像:CLI > 环境变量 > 默认列表第一。"""
    if user_pref:
        return user_pref.rstrip("/")
    env = os.environ.get("HF_ENDPOINT", "").strip().rstrip("/")
    if env:
        return env
    return DEFAULT_ENDPOINTS[0]


def _set_endpoint(endpoint: str) -> None:
    """huggingface_hub 在 import 时读 HF_ENDPOINT,必须在 import 前设。"""
    os.environ["HF_ENDPOINT"] = endpoint
    os.environ["HUGGINGFACE_HUB_ENDPOINT"] = endpoint
    # 让 hf 卡住的 xethub 30 秒就放弃,加速 fallback
    os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", _HF_DOWNLOAD_TIMEOUT_DEFAULT)


def _resolve_vendor_root() -> Path:
    here = Path(__file__).resolve()
    # scripts/install-bundled-models.py  →  ../chayuan-server/vendor/bundled_models
    candidate = here.parent.parent / "chayuan-server" / "vendor" / "bundled_models"
    if candidate.is_dir():
        return candidate
    raise SystemExit(
        f"找不到 vendor/bundled_models/,期望在:{candidate}\n"
        f"如果你的工作区结构不同,用 --workspace <repo_root> 显式指定。"
    )


def _download_via_hf(spec: dict, dest_dir: Path) -> None:
    """用 huggingface_hub 下载。spec 必须有 ``repo``;支持 ``snapshot=True`` /
    ``allow_patterns`` / ``filename`` 三种模式。"""
    from huggingface_hub import hf_hub_download, snapshot_download

    repo = spec["repo"]
    if spec.get("snapshot") or spec.get("allow_patterns"):
        # snapshot_download 同时支持单文件(allow_patterns 写死文件名)和整仓
        snapshot_download(
            repo_id=repo,
            local_dir=str(dest_dir),
            allow_patterns=spec.get("allow_patterns"),
        )
    elif spec.get("filename"):
        hf_hub_download(
            repo_id=repo,
            filename=spec["filename"],
            local_dir=str(dest_dir),
        )
    else:
        raise ValueError(f"HF spec 缺少 filename / snapshot / allow_patterns:{spec}")


def _download_via_ms(spec: dict, dest_dir: Path) -> None:
    """用 modelscope SDK 下载。spec 同 HF,但 repo 是 MS 路径。"""
    from modelscope import snapshot_download as ms_snapshot_download

    repo = spec["repo"]
    # MS 的 snapshot_download 跟 HF 行为类似:allow_patterns 控制文件粒度,
    # 整仓 vs 单文件都用这个 API 处理。
    ms_snapshot_download(
        model_id=repo,
        allow_patterns=spec.get("allow_patterns"),
        local_dir=str(dest_dir),
    )


def _download_one(
    cap: str,
    cap_spec: dict,
    *,
    vendor_root: Path,
    clean: bool,
    source: str,
) -> None:
    cap_dir = vendor_root / cap
    dest_dir = cap_dir / cap_spec["dest_subdir"]
    cap_dir.mkdir(parents=True, exist_ok=True)

    if clean and dest_dir.exists():
        _print(f"[{cap}] --clean:删除旧目录 {dest_dir}")
        shutil.rmtree(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    _print(f"[{cap}] target ~{cap_spec['approx_mb']} MB")
    _print(f"        {cap_spec['note']}")
    _print(f"        local_dir = {dest_dir}")

    hf_spec = cap_spec.get("hf")
    ms_spec = cap_spec.get("ms")

    # 计划:先 HF(若允许),失败再 MS(若允许)
    tried: list[tuple[str, str]] = []  # (source, err_msg)

    if source in ("auto", "hf") and hf_spec:
        _print(f"[{cap}] ↓ HF: {hf_spec['repo']}")
        try:
            _ensure_hf_lib()
            _download_via_hf(hf_spec, dest_dir)
            _print(f"[{cap}] ✓ 完成 (via HF)")
            return
        except KeyboardInterrupt:
            raise
        except BaseException as e:  # noqa: BLE001 — fallback 要 swallow 一切
            tried.append(("hf", repr(e)))
            _print(f"[{cap}] HF 失败:{e}")
            if source == "hf":
                _print(f"[{cap}] (--source hf,不尝试 MS fallback)")
                raise

    if source in ("auto", "modelscope") and ms_spec:
        _print(f"[{cap}] ↓ MS: {ms_spec['repo']}")
        try:
            _ensure_ms_lib()
            _download_via_ms(ms_spec, dest_dir)
            _print(f"[{cap}] ✓ 完成 (via ModelScope)")
            return
        except KeyboardInterrupt:
            raise
        except BaseException as e:  # noqa: BLE001
            tried.append(("ms", repr(e)))
            _print(f"[{cap}] MS 失败:{e}")

    # 走到这就两路都没拿下来(或者根本就没配)
    if not tried:
        raise RuntimeError(
            f"[{cap}] 没有任何可用 source(hf_spec={bool(hf_spec)}, ms_spec={bool(ms_spec)})"
        )
    summary = "\n".join(f"  - {src}: {err}" for src, err in tried)
    raise RuntimeError(f"[{cap}] 所有 source 都失败:\n{summary}")


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
        "--source",
        choices=["auto", "hf", "modelscope"],
        default="auto",
        help=("下载源选择。auto(默认)= 先 HF 后 MS fallback;"
              "hf = 强制 HF,失败不 fallback;"
              "modelscope = 直接跳过 HF 走 MS(适合你已知 hf-mirror Xet 不通)。"),
    )
    parser.add_argument(
        "--endpoint",
        help=("HF 镜像 URL,优先级最高。默认 hf-mirror.com;"
              "试 --endpoint https://huggingface.co 直连官方(海外服务器才稳)。"),
    )
    parser.add_argument(
        "--workspace",
        type=Path,
        help="仓库根目录(含 chayuan-server/)。不传 = 由脚本相对路径自动推。",
    )
    args = parser.parse_args()

    endpoint = _pick_endpoint(args.endpoint)
    _set_endpoint(endpoint)
    _print(f"[install] source = {args.source}")
    if args.source != "modelscope":
        _print(f"[install] HF 镜像 = {endpoint}")
        _print(f"[install] HF_HUB_DOWNLOAD_TIMEOUT = {os.environ['HF_HUB_DOWNLOAD_TIMEOUT']}s (单连接,5 次重试后 fallback)")

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
            _download_one(cap, spec, vendor_root=vendor_root, clean=args.clean, source=args.source)
        except KeyboardInterrupt:
            _print("[install] 用户中断,退出。已下载的部分文件保留(下次跑会续传)。")
            return 130
        except Exception as e:  # noqa: BLE001
            failures.append((cap, str(e)))
        _print("")

    if failures:
        _print("[install] 部分下载失败:")
        for cap, err in failures:
            _print(f"  - {cap}: {err}")
        _print("")
        _print("常见排查:")
        _print("  1) hf-mirror Xet 不通(blob 走 cas-bridge.xethub.hf.co):")
        _print("     重跑加 --source modelscope")
        _print("  2) MS 仓库路径变了:浏览 https://modelscope.cn/models/<owner>/<repo>/files")
        _print("     找对应的 owner(Alibaba 模型 MS 端通常在 iic/ namespace)")
        _print("  3) 镜像都挂了:--source hf --endpoint https://huggingface.co 直连官方")
        return 1

    _print("[install] 全部完成。下一步:")
    _print("  - cd 到仓库根 → .\\build-desktop.cmd -IntegratedOnly(Windows)")
    _print("  - 或 ./build-desktop.sh --integrated-only(Linux/Mac)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
