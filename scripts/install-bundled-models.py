#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一键下载 / 替换 vendor/bundled_models/ 里的"瘦身默认集"。

特性
====

1. **多 source + 候选列表自动 fallback**:每个 cap 配置 HF 候选清单 + MS 候选
   清单。按 ``--source`` 决定顺序(auto = HF→MS,modelscope = MS→HF),逐个
   尝试,第一个能下载成功的胜出;一路 404 / 超时就报错并打印所有尝试明细。
2. **绕开 hf CLI 各种坑**:直接用 ``huggingface_hub`` Python API,镜像在脚本
   里写死,HF_ENDPOINT 不持久化也不影响本脚本。
3. **HF Xet 兜底**:HF 的 Xet LFS 后端(``cas-bridge.xethub.hf.co``)
   不被 hf-mirror.com 代理,大文件经常卡 0%。``--source modelscope`` 直接跳过
   HF 走 ModelScope(国内 Alibaba 镜像,稳)。
4. **失败不阻断后续**:某个 cap 全 source 都挂了不影响其它 cap;结尾汇总
   失败明细 + 排查建议。

默认目标(瘦身集,全部 < 2 GB 单文件,Windows installer 友好)
==============================================================

| cap        | 推荐                            | 备选                  | 大小    |
|------------|---------------------------------|-----------------------|---------|
| chat       | Qwen3-4B-Instruct-2507 Q3_K_S   | Q3_K_M / IQ3          | ~1.8 GB |
| embedding  | gte-multilingual-base           | -                     | ~1.22 GB |
| rerank     | gte-multilingual-reranker-base  | -                     | ~584 MB |
| asr        | whisper.cpp ggml-tiny           | -                     | ~74 MB  |

用法
====

# 全量下,默认 HF→MS auto fallback
python scripts/install-bundled-models.py

# 已知 HF Xet 拉不动,直接走 MS(国内最稳)
python scripts/install-bundled-models.py --source modelscope

# 干净换装(清掉旧的再下)
python scripts/install-bundled-models.py --clean

# 只下指定 cap
python scripts/install-bundled-models.py --only chat
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

# ===== 镜像优先级:CLI 显式 > 环境变量 > 默认 hf-mirror.com =====
DEFAULT_ENDPOINTS = [
    "https://hf-mirror.com",   # 国内首选(免登录、社区维护)
    "https://huggingface.co",  # 兜底
]

# 让 hf 在 xethub 卡 0% 时早点放弃,触发 fallback。30s × 5 重试 ≈ 2-3 分钟。
_HF_DOWNLOAD_TIMEOUT_DEFAULT = "30"

# ===== 下载清单 =====
# 每个 cap 的 ``hf`` / ``ms`` 字段都是 **候选清单**,按顺序逐个尝试,第一个
# 能下载就停。snapshot_download 的 ``allow_patterns`` 用来限定整仓内只拉
# 需要的文件(尤其是 GGUF 仓库通常含十几个量化版本,只要其中一个 < 2 GB 的)。
#
# 添加新候选:复制一条 {repo, allow_patterns, ...},仿照下面格式追加即可。
#
# dest_subdir:本地落盘到 ``<cap>/<dest_subdir>/`` 下;chayuan 扫描器只看
# 后缀和标志文件,不在乎子目录名。
MANIFEST: dict[str, dict[str, Any]] = {
    "chat": {
        "approx_mb": 1850,
        "note": "Qwen3-4B chat,Q3 系列量化(~1.7-1.95 GB,Windows installer 友好)",
        "dest_subdir": "Qwen3-4B-Instruct-2507-GGUF",
        "hf": [
            # 首选:unsloth 全量化矩阵(Q3_K_S/M/L、IQ3 系列)
            {"repo": "unsloth/Qwen3-4B-Instruct-2507-GGUF",
             "allow_patterns": ["*Q3_K_S*"]},
            # 备选:bartowski 也常做全量化,Q3_K_S 同样齐
            {"repo": "bartowski/Qwen3-4B-Instruct-2507-GGUF",
             "allow_patterns": ["*Q3_K_S*"]},
            # 备选:lmstudio-community,LM Studio 团队整理
            {"repo": "lmstudio-community/Qwen3-4B-Instruct-2507-GGUF",
             "allow_patterns": ["*Q3_K_S*"]},
        ],
        "ms": [
            # 首选:Qwen 官方 GGUF(MS 一般用小写 qwen namespace)
            {"repo": "qwen/Qwen3-4B-Instruct-2507-GGUF",
             "allow_patterns": ["*Q3_K_S*", "*Q3_K_M*", "*IQ3*"]},
            # 备选:有些上传者用大写 Qwen 命名
            {"repo": "Qwen/Qwen3-4B-Instruct-2507-GGUF",
             "allow_patterns": ["*Q3_K_S*", "*Q3_K_M*", "*IQ3*"]},
            # 兜底:Qwen2.5-3B 官方 GGUF(2024 老版,但 MS 上稳存在,1.96 GB)
            {"repo": "qwen/Qwen2.5-3B-Instruct-GGUF",
             "allow_patterns": ["*q4_k_m*"]},
        ],
    },
    "embedding": {
        "approx_mb": 1220,
        "note": "Alibaba 多语种 embedding(~1.22 GB,跟 reranker 对齐)",
        "dest_subdir": "gte-multilingual-base",
        "hf": [
            {"repo": "Alibaba-NLP/gte-multilingual-base",
             "allow_patterns": [
                 "*.json", "*.txt", "*.safetensors", "*.bin",
                 "sentencepiece*", "tokenizer*", "vocab*",
             ]},
        ],
        "ms": [
            # iic = Institute for Intelligent Computing,Alibaba 在 MS 的官方组织
            {"repo": "iic/gte-multilingual-base",
             "allow_patterns": [
                 "*.json", "*.txt", "*.safetensors", "*.bin",
                 "sentencepiece*", "tokenizer*", "vocab*",
             ]},
        ],
    },
    "rerank": {
        "approx_mb": 584,
        "note": "Alibaba 多语种 reranker(~584 MB,从 bge-reranker-v2-m3 2.12 GB 瘦身)",
        "dest_subdir": "gte-multilingual-reranker-base",
        "hf": [
            {"repo": "Alibaba-NLP/gte-multilingual-reranker-base",
             "allow_patterns": [
                 "*.json", "*.txt", "*.safetensors", "*.bin",
                 "sentencepiece*", "tokenizer*", "vocab*",
             ]},
        ],
        "ms": [
            {"repo": "iic/gte-multilingual-reranker-base",
             "allow_patterns": [
                 "*.json", "*.txt", "*.safetensors", "*.bin",
                 "sentencepiece*", "tokenizer*", "vocab*",
             ]},
        ],
    },
    "asr": {
        "approx_mb": 74,
        "note": "whisper.cpp tiny(~74 MB)",
        "dest_subdir": "whisper.cpp",
        "hf": [
            {"repo": "ggerganov/whisper.cpp",
             "allow_patterns": ["ggml-tiny.bin"]},
        ],
        # MS 上没有 whisper.cpp 现成镜像;HF/hf-mirror 失败时落到下面 urls 直链。
        "ms": [],
        # SDK 全炸的最后兜底:urllib 直接 GET。74 MB 小文件不需要 huggingface_hub
        # 那一整坨栈,绕开 SSL 读超时 / LFS endpoint 不稳的各种坑。
        "urls": [
            ("https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
             "ggml-tiny.bin"),
            ("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
             "ggml-tiny.bin"),
        ],
    },
    "ocr": {
        "approx_mb": 16,
        "note": "RapidOCR PP-OCRv4 det + rec + PP-OCRv3 cls(中文文档,~16 MB)",
        "dest_subdir": "RapidOCR",
        "hf": [
            # SWHL/RapidOCR 整仓有十几个 PP-OCR 版本,只拉 v4 主线 + cls(实测 200)
            {"repo": "SWHL/RapidOCR",
             "allow_patterns": [
                 "PP-OCRv4/ch_PP-OCRv4_det_infer.onnx",
                 "PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx",
                 "PP-OCRv3/ch_ppocr_mobile_v2.0_cls_train.onnx",
             ]},
        ],
        # MS 上 RapidAI/RapidOCR 存在但文件布局不同(onnx/ 子目录里命名不一样),
        # chayuan 加载逻辑认 HF 那种 PP-OCRv4 / PP-OCRv3 路径。HF 这三个 ONNX
        # 加起来 16 MB,Xet 风险极低,不需要 MS fallback。
        "ms": [],
    },
    "image": {
        "approx_mb": 605,
        "note": "OpenAI CLIP-B/32 图文 embedding(~605 MB,LZMA 后 ~380 MB)",
        "dest_subdir": "clip-vit-base-patch32",
        "hf": [
            # OpenAI 官方 CLIP,仓库里 pytorch_model.bin + tf_model.h5 +
            # flax_model.msgpack 是三份等价权重(同一模型不同框架格式),
            # 必须 allow_patterns 卡死只拿 pytorch 那份,否则会下 1.8 GB 三套。
            # 实测这十个文件全部 200,且这个仓库**不在 Xet 上**,hf-mirror 走得通。
            {"repo": "openai/clip-vit-base-patch32",
             "allow_patterns": [
                 "pytorch_model.bin",
                 "*.json", "*.txt",   # config / preprocessor / tokenizer / vocab / merges
             ]},
        ],
        # MS 上 AI-ModelScope/clip-vit-base-patch32 实测 API 返"record not found"
        # (页面 200 但 files 树空),iic 下唯一存在的是 multi-modal_clip-vit-base-patch16_zh
        # —— 那是 Alibaba 自家 Chinese-CLIP,跟 OpenAI CLIP 模型架构 / 加载接口都不同,
        # 给 chayuan-server 当 CLIP fallback 会加载失败。所以这里**不给 MS 候选**,
        # 让脚本直接走 HF。clip-vit-base-patch32 仓库 2021 年的老仓库,不在 Xet,
        # hf-mirror 上拉 pytorch_model.bin (605 MB) 稳。
        "ms": [],
    },
}


# ──────────────────────────── 工具:打印 / 环境 ────────────────────────────

def _print(msg: str) -> None:
    print(msg, flush=True)


def _ensure_hf_lib() -> None:
    try:
        import huggingface_hub  # noqa: F401
    except ImportError:
        _print("[install] 检测到未装 huggingface_hub,自动 pip 安装...")
        subprocess.check_call([
            sys.executable, "-m", "pip", "install",
            "--upgrade", "huggingface_hub>=0.24,<1.0",
        ])


def _ensure_ms_lib() -> None:
    try:
        import modelscope  # noqa: F401
    except ImportError:
        _print("[install] 检测到未装 modelscope(MS fallback 需要),自动 pip 安装...")
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "--upgrade", "modelscope",
        ])


def _pick_endpoint(user_pref: str | None) -> str:
    if user_pref:
        return user_pref.rstrip("/")
    env = os.environ.get("HF_ENDPOINT", "").strip().rstrip("/")
    if env:
        return env
    return DEFAULT_ENDPOINTS[0]


def _set_endpoint(endpoint: str) -> None:
    """huggingface_hub 在 import 时读 HF_ENDPOINT,必须 import 前设。"""
    os.environ["HF_ENDPOINT"] = endpoint
    os.environ["HUGGINGFACE_HUB_ENDPOINT"] = endpoint
    os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", _HF_DOWNLOAD_TIMEOUT_DEFAULT)


def _resolve_vendor_root() -> Path:
    here = Path(__file__).resolve()
    candidate = here.parent.parent / "chayuan-server" / "vendor" / "bundled_models"
    if candidate.is_dir():
        return candidate
    raise SystemExit(
        f"找不到 vendor/bundled_models/,期望在:{candidate}\n"
        f"用 --workspace <repo_root> 显式指定。"
    )


# ──────────────────────────── 存在性预检 ────────────────────────────

def _hf_repo_exists(repo: str) -> tuple[bool, str]:
    """HF 仓库存在性预检。返回 (exists, hint)。"""
    try:
        from huggingface_hub import HfApi
        api = HfApi(endpoint=os.environ.get("HF_ENDPOINT") or None)
        api.repo_info(repo_id=repo, repo_type="model")
        return True, ""
    except Exception as e:
        return False, repr(e)


def _ms_repo_exists(repo: str) -> tuple[bool, str]:
    """MS 仓库存在性预检。借 modelscope.hub.api。"""
    try:
        from modelscope.hub.api import HubApi
        api = HubApi()
        api.get_model(model_id=repo)
        return True, ""
    except Exception as e:
        return False, repr(e)


# ──────────────────────────── 实际下载 ────────────────────────────

def _download_via_hf(spec: dict, dest_dir: Path) -> None:
    from huggingface_hub import hf_hub_download, snapshot_download
    repo = spec["repo"]
    if spec.get("allow_patterns") or spec.get("snapshot"):
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
        raise ValueError(f"HF spec 缺 allow_patterns / filename:{spec}")


def _download_via_ms(spec: dict, dest_dir: Path) -> None:
    from modelscope import snapshot_download as ms_snapshot_download
    ms_snapshot_download(
        model_id=spec["repo"],
        allow_patterns=spec.get("allow_patterns"),
        local_dir=str(dest_dir),
    )


def _download_via_url(url: str, dest_dir: Path, filename: str) -> None:
    """urllib 直接 GET。给小文件兜底(HF/MS SDK 都挂了时用)。

    支持断点续传(若本地有部分文件且服务器接受 Range)。带进度打印。
    """
    import urllib.request
    import urllib.error

    dest = dest_dir / filename
    headers: dict[str, str] = {"User-Agent": "chayuan-install-script/1.0"}

    # 断点续传:本地有部分文件就发 Range 头
    start_byte = 0
    if dest.exists():
        start_byte = dest.stat().st_size
        if start_byte > 0:
            headers["Range"] = f"bytes={start_byte}-"

    req = urllib.request.Request(url, headers=headers)
    try:
        resp = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as e:
        # 416 = 请求范围已超(说明本地已经下完);其它 4xx/5xx 抛出
        if e.code == 416 and start_byte > 0:
            _print(f"        服务器报 416,认为已下完 ({start_byte // 1024 // 1024} MB)")
            return
        raise

    total = int(resp.headers.get("Content-Length", "0"))
    if resp.status == 206:
        # Partial Content,Content-Length 是剩余字节数
        total += start_byte
    total_mb = max(1, total // 1024 // 1024)

    mode = "ab" if start_byte > 0 and resp.status == 206 else "wb"
    if mode == "wb" and start_byte > 0:
        # 服务器不支持 Range,重新从头下
        start_byte = 0

    downloaded = start_byte
    chunk = 1024 * 1024  # 1 MB
    with open(dest, mode) as f:
        while True:
            buf = resp.read(chunk)
            if not buf:
                break
            f.write(buf)
            downloaded += len(buf)
            pct = (downloaded * 100 // total) if total else 0
            print(
                f"\r        {downloaded // 1024 // 1024} / {total_mb} MB  ({pct}%)",
                end="", flush=True,
            )
    print()  # newline 收尾


# ──────────────────────────── 调度 ────────────────────────────

def _build_try_order(
    source: str,
    hf_list: list[dict],
    ms_list: list[dict],
) -> list[tuple[str, dict]]:
    """生成 (source_name, spec) 的尝试顺序。

    * ``auto``:HF 全部 → MS 全部
    * ``hf``:只 HF,不 fallback 到 MS
    * ``modelscope``:MS 全部 → 若 ms_list 为空再降级到 HF(asr 这种没 MS 的 cap)
    """
    if source == "auto":
        return [("hf", s) for s in hf_list] + [("ms", s) for s in ms_list]
    if source == "hf":
        return [("hf", s) for s in hf_list]
    if source == "modelscope":
        if ms_list:
            return [("ms", s) for s in ms_list] + [("hf", s) for s in hf_list]
        # 当前 cap 没 MS 候选(如 asr),自动降级到 HF
        return [("hf", s) for s in hf_list]
    raise ValueError(f"未知 source: {source}")


_MODEL_WEIGHT_EXTS = (".gguf", ".safetensors", ".bin", ".onnx", ".pt", ".pth")


def _is_already_complete(dest_dir: Path, *, approx_mb: int) -> tuple[bool, str]:
    """判断目标目录是否已经下载完整,避免重复下载。

    判定 (与 ``--clean`` 互斥,clean 会先删目录绕过这检查):
    1) 目录存在
    2) 目录下递归找到 ≥ 1 个权重文件 (.gguf / .safetensors / .bin / .onnx / .pt / .pth)
    3) 目录总大小 ≥ approx_mb * 0.85 (85% 阈值容忍量化 / 编码偏差,
       例如 Q4_K_M 实际可能比标称 size 略小 / 多)

    用 rglob 递归扫,适配 sentence-transformers 那种把权重塞子目录的布局
    (如 ``0_CLIPModel/pytorch_model.bin``)。
    """
    if not dest_dir.exists() or not dest_dir.is_dir():
        return False, ""

    files = [f for f in dest_dir.rglob("*")
             if f.is_file() and not f.name.startswith(".")]
    if not files:
        return False, ""

    weight_files = [f for f in files if f.suffix.lower() in _MODEL_WEIGHT_EXTS]
    if not weight_files:
        return False, f"目录里没有任何权重文件 ({', '.join(_MODEL_WEIGHT_EXTS)})"

    total_mb = sum(f.stat().st_size for f in files) / 1024 / 1024
    threshold_mb = approx_mb * 0.85

    if total_mb < threshold_mb:
        return False, (
            f"已有 {total_mb:.1f} MB,但 < 期望阈值 {threshold_mb:.0f} MB "
            f"(approx {approx_mb} MB × 0.85),判定为下载未完成"
        )

    sample = ", ".join(f.name for f in weight_files[:3])
    if len(weight_files) > 3:
        sample += f", ... 共 {len(weight_files)} 个"
    return True, f"已有 {sample},总 {total_mb:.1f} MB,跳过下载"


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

    # Skip-if-exists 预检 (--clean 时绕过,因为 clean 用户明确要重下)
    if not clean:
        already, reason = _is_already_complete(dest_dir, approx_mb=cap_spec["approx_mb"])
        if already:
            _print(f"[{cap}] ✓ {reason}")
            return
        elif reason:
            _print(f"[{cap}] (检测到 partial 下载: {reason} — 继续下载)")

    if clean and dest_dir.exists():
        _print(f"[{cap}] --clean:删除旧目录 {dest_dir}")
        shutil.rmtree(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    _print(f"[{cap}] target ~{cap_spec['approx_mb']} MB")
    _print(f"        {cap_spec['note']}")
    _print(f"        local_dir = {dest_dir}")

    hf_list = cap_spec.get("hf", []) or []
    ms_list = cap_spec.get("ms", []) or []
    plan = _build_try_order(source, hf_list, ms_list)

    if not plan:
        raise RuntimeError(f"[{cap}] 没有任何 source 候选(hf={len(hf_list)}, ms={len(ms_list)})")

    tried: list[tuple[str, str, str]] = []  # (src, repo, err)
    for src_name, spec in plan:
        repo = spec["repo"]

        # 存在性预检,跳过明显不存在的 repo,避免下载 SDK 内部慢启动 + 重试
        if src_name == "hf":
            _ensure_hf_lib()
            exists, err = _hf_repo_exists(repo)
        else:
            _ensure_ms_lib()
            exists, err = _ms_repo_exists(repo)

        if not exists:
            _print(f"[{cap}] {src_name}: {repo} 不存在,跳过")
            tried.append((src_name, repo, f"repo_not_found: {err}"))
            continue

        _print(f"[{cap}] ↓ {src_name}: {repo}")
        try:
            if src_name == "hf":
                _download_via_hf(spec, dest_dir)
            else:
                _download_via_ms(spec, dest_dir)
            _print(f"[{cap}] ✓ 完成 (via {src_name}: {repo})")
            return
        except KeyboardInterrupt:
            raise
        except BaseException as e:  # noqa: BLE001
            tried.append((src_name, repo, repr(e)))
            _print(f"[{cap}] {src_name} {repo} 下载失败:{e}")
            continue

    # SDK 候选用尽,最后兜底:直链 URLs(给小文件用,绕开 huggingface_hub 复杂栈)
    urls = cap_spec.get("urls", []) or []
    for url, fname in urls:
        _print(f"[{cap}] ↓ url: {url}")
        try:
            _download_via_url(url, dest_dir, fname)
            _print(f"[{cap}] ✓ 完成 (via url: {url})")
            return
        except KeyboardInterrupt:
            raise
        except BaseException as e:  # noqa: BLE001
            tried.append(("url", url, repr(e)))
            _print(f"[{cap}] url {url} 失败:{e}")
            continue

    # 全候选 + 全 url 都用尽
    summary_lines = [f"[{cap}] 所有候选都失败,尝试明细:"]
    for src, repo, err in tried:
        summary_lines.append(f"  - {src} {repo}: {err}")
    summary_lines.append("")
    summary_lines.append("修法:")
    summary_lines.append(f"  - 浏览 https://modelscope.cn/search?query={cap_spec['dest_subdir']}")
    summary_lines.append(f"           或 https://huggingface.co/search?q={cap_spec['dest_subdir']}")
    summary_lines.append(f"  - 把对的 repo / 直链 URL 加到 scripts/install-bundled-models.py 的")
    summary_lines.append(f"    MANIFEST[{cap!r}]['hf' / 'ms' / 'urls'] 列表里")
    raise RuntimeError("\n".join(summary_lines))


# ──────────────────────────── 入口 ────────────────────────────

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
        help=("下载源选择。auto(默认)= 先 HF 后 MS;"
              "hf = 强制 HF;"
              "modelscope = MS 优先,cap 没 MS 时降级到 HF(适合已知 hf-mirror Xet 不通)。"),
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
        _print(f"[install] HF_HUB_DOWNLOAD_TIMEOUT = {os.environ['HF_HUB_DOWNLOAD_TIMEOUT']}s")

    if args.workspace:
        vendor_root = args.workspace / "chayuan-server" / "vendor" / "bundled_models"
        if not vendor_root.is_dir():
            raise SystemExit(f"--workspace 下找不到 vendor/bundled_models/: {vendor_root}")
    else:
        vendor_root = _resolve_vendor_root()
    _print(f"[install] vendor_root = {vendor_root}")
    _print("")

    plan = [args.only] if args.only else list(MANIFEST.keys())
    failures: list[tuple[str, str]] = []
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
            # err 可能是多行,缩进一下
            for i, line in enumerate(err.splitlines()):
                _print(("  - " if i == 0 else "    ") + line)
        return 1

    _print("[install] 全部完成。下一步:")
    _print("  - cd 到仓库根 → .\\build-desktop.cmd -IntegratedOnly(Windows)")
    _print("  - 或 ./build-desktop.sh --integrated-only(Linux/Mac)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
