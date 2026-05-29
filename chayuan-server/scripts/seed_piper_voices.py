#!/usr/bin/env python3
"""下载一组 curated piper voice 到 vendor/bundled_models/tts/piper/,供打包带上。

为什么要这个脚本:
  - 运行时 modality/audio._try_download_piper_voice 已能按需从 hf-mirror 拉
    voice 到用户数据目录(<CHAYUAN_ROOT>/models/piper/),但那是装机后单台拉,
    不进安装包。
  - desktop build 的 sync_bundled_models 会把 vendor/bundled_models/tts/piper/
    拷进包(bundle_manifest.py:72 CANONICAL_MODEL_SUBDIRS["tts"]=("piper",))。
    所以打包前在仓库里把想随包带的 voice 先 seed 到这个目录,装机即用、零下载。

落地布局(扁平,跟 _find_bundled_piper_voice 的 rglob 兼容):
    vendor/bundled_models/tts/piper/<name>.onnx
    vendor/bundled_models/tts/piper/<name>.onnx.json

endpoint 默认 hf-mirror(国内可达);要用上游 HF:
    CHAYUAN_HF_ENDPOINT=https://huggingface.co python scripts/seed_piper_voices.py

用法:
    python scripts/seed_piper_voices.py                 # 默认 curated 集
    python scripts/seed_piper_voices.py --voices zh_CN-huayan-medium,en_US-amy-medium
    python scripts/seed_piper_voices.py --list          # 只列 curated 集不下载
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# curated 默认集:中文女声(默认)+ 中英男女各一个常用,覆盖最常见场景。
# 想要更多语言/音色,--voices 显式列,或参考 video_generation_routes
# PIPER_VOICE_LABELS(60+ 已知 voice id)。每个 medium ~60 MB,别一把全拉。
DEFAULT_VOICES = [
    "zh_CN-huayan-medium",   # 中文女声(默认)
    "en_US-amy-medium",      # 美式英语女声
    "en_US-ryan-medium",     # 美式英语男声
]


def _bundled_piper_dir() -> Path:
    # 本脚本在 chayuan-server/scripts/ 下,vendor 在 chayuan-server/vendor/
    here = Path(__file__).resolve()
    server_root = here.parents[1]  # chayuan-server/
    return server_root / "vendor" / "bundled_models" / "tts" / "piper"


def _download_one(name: str, dest_dir: Path, endpoint: str) -> bool:
    """下载 <name>.onnx + .onnx.json 到 dest_dir(扁平)。成功 True。"""
    parts = name.split("-")
    if len(parts) < 3:
        print(f"[seed] !! voice name 不符合 piper 命名 {{locale}}-{{speaker}}-{{quality}}: {name}")
        return False
    locale, speaker, quality = parts[0], parts[1], parts[2]
    lang = locale.split("_")[0] if "_" in locale else locale
    base = f"{endpoint}/rhasspy/piper-voices/resolve/main/{lang}/{locale}/{speaker}/{quality}"
    files = [
        (f"{base}/{name}.onnx", dest_dir / f"{name}.onnx"),
        (f"{base}/{name}.onnx.json", dest_dir / f"{name}.onnx.json"),
    ]
    try:
        import httpx
    except ImportError:
        print("[seed] !! 需要 httpx:pip install httpx")
        return False
    dest_dir.mkdir(parents=True, exist_ok=True)
    try:
        with httpx.Client(timeout=120.0, follow_redirects=True) as client:
            for url, dest in files:
                if dest.exists() and dest.stat().st_size > 0:
                    print(f"[seed]    skip(已存在) {dest.name}")
                    continue
                print(f"[seed]    GET {url}")
                resp = client.get(url)
                resp.raise_for_status()
                dest.write_bytes(resp.content)
                print(f"[seed]    ok {dest.name} ({len(resp.content) // 1024} KB)")
        return True
    except Exception as e:  # noqa: BLE001
        print(f"[seed] !! 下载 {name} 失败: {type(e).__name__}: {e}")
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description="seed piper voices into vendor bundled dir")
    ap.add_argument(
        "--voices", default="",
        help="逗号分隔 voice id;缺省用 curated 默认集",
    )
    ap.add_argument("--list", action="store_true", help="只列 curated 默认集不下载")
    args = ap.parse_args()

    if args.list:
        print("curated 默认集:")
        for v in DEFAULT_VOICES:
            print(f"  {v}")
        return 0

    voices = (
        [v.strip() for v in args.voices.split(",") if v.strip()]
        if args.voices else list(DEFAULT_VOICES)
    )
    endpoint = os.environ.get("CHAYUAN_HF_ENDPOINT", "https://hf-mirror.com").rstrip("/")
    dest = _bundled_piper_dir()
    print(f"[seed] endpoint = {endpoint}")
    print(f"[seed] dest     = {dest}")
    print(f"[seed] voices   = {voices}")

    ok = 0
    for name in voices:
        print(f"[seed] -- {name}")
        if _download_one(name, dest, endpoint):
            ok += 1
    print(f"[seed] done: {ok}/{len(voices)} 成功")
    return 0 if ok == len(voices) else 1


if __name__ == "__main__":
    sys.exit(main())
