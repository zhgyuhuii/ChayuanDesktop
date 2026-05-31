#!/usr/bin/env python3
"""下载 sherpa-onnx 中文 TTS 模型到 vendor/bundled_models/tts/sherpa-onnx/,
补齐「语音设置 → sherpa」的音色(含多说话人,如 aishell3 174 个)。

为什么 sherpa 下拉是空的:
  /voices?provider=sherpa 扫 <CHAYUAN_ROOT>/models/bundled/tts/sherpa-onnx/
  和 vendor/bundled_models/tts/sherpa-onnx/ 两档目录里含 model.onnx + tokens.txt
  的子目录。没下过模型 → 0 个 → 下拉空。本脚本把模型下到 vendor,打包/装机带上。

模型来源:k2-fsa/sherpa-onnx GitHub release 的 tar.bz2(官方,稳定 URL)。
  默认集:
    vits-zh-hf-fanchen-C  单说话人女声 ~115MB(小,快)
    vits-zh-aishell3      多说话人 174 音色 ~120MB(/voices 会展开成 174 条)
  endpoint 走 CHAYUAN_SHERPA_BASE(默认 GitHub release);国内不通可设镜像,
  或手动从 release 页下 tar.bz2 解压到目标目录(脚本失败时打印路径)。

落地布局(_scan_sherpa_voices + _build_sherpa_tts 要求):
    vendor/bundled_models/tts/sherpa-onnx/<name>/{model.onnx, tokens.txt, lexicon.txt, ...}

用法:
    python scripts/seed_sherpa_voices.py            # 默认 2 个中文模型
    python scripts/seed_sherpa_voices.py --models vits-zh-aishell3
    python scripts/seed_sherpa_voices.py --list
"""
from __future__ import annotations

import argparse
import os
import sys
import tarfile
import tempfile
from pathlib import Path

# 模型名 → release tar.bz2 文件名(同名解压出的目录即 voice 目录)。
# CATALOG 里的名字都已对 k2-fsa/sherpa-onnx release 实测可下(HTTP 200)。
# 更多模型见 release 页 tts-models 与官方文档 pretrained_models(TTS)。
CATALOG = {
    "zh": ["vits-zh-hf-fanchen-C", "vits-zh-aishell3"],
    "en": ["vits-piper-en_US-amy-low", "vits-piper-en_US-libritts_r-medium", "vits-ljs"],
    "de": ["vits-piper-de_DE-thorsten-low"],
    "fr": ["vits-piper-fr_FR-siwis-medium"],
}
# 一键多语言起步集(中+英各一,体积适中)
STARTER_MULTILANG = ["vits-zh-hf-fanchen-C", "vits-piper-en_US-amy-low"]
DEFAULT_MODELS = ["vits-zh-hf-fanchen-C", "vits-zh-aishell3"]
DEFAULT_BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models"
# 国内 GitHub release 镜像前缀(2026-05-31 实测可用;mirror.ghproxy.com 已挂故不列)。
# 用 --mirror <key> 选,免手敲长 URL。值会拼到 DEFAULT_BASE 前。
MIRRORS = {
    "ghproxy": "https://ghproxy.net/",
    "ghfast": "https://ghfast.top/",
    "gh-proxy": "https://gh-proxy.com/",
}


def _bundled_sherpa_dir() -> Path:
    here = Path(__file__).resolve()
    server_root = here.parents[1]  # chayuan-server/
    return server_root / "vendor" / "bundled_models" / "tts" / "sherpa-onnx"


def _has_model(voice_dir: Path) -> bool:
    # sherpa release 里 onnx 不一定叫 model.onnx(中文 hf-fanchen=<name>.onnx、
    # piper=<voice>.onnx),所以认 tokens.txt + 任意 *.onnx。
    if not (voice_dir / "tokens.txt").is_file():
        return False
    return (voice_dir / "model.onnx").is_file() or any(voice_dir.glob("*.onnx"))


def _download_extract(name: str, base: str, dest_root: Path) -> bool:
    voice_dir = dest_root / name
    if _has_model(voice_dir):
        print(f"[sherpa]    skip(已存在) {name}")
        return True
    url = f"{base.rstrip('/')}/{name}.tar.bz2"
    try:
        import httpx
    except ImportError:
        print("[sherpa] !! 需要 httpx:pip install httpx")
        return False
    dest_root.mkdir(parents=True, exist_ok=True)
    tmp = None
    try:
        print(f"[sherpa]    GET {url}")
        with httpx.Client(timeout=600.0, follow_redirects=True) as client, \
                tempfile.NamedTemporaryFile(suffix=".tar.bz2", delete=False) as tf:
            tmp = tf.name
            with client.stream("GET", url) as r:
                r.raise_for_status()
                for chunk in r.iter_bytes(1 << 20):
                    tf.write(chunk)
        print(f"[sherpa]    解压 {name} → {dest_root}")
        with tarfile.open(tmp, "r:bz2") as tar:
            tar.extractall(dest_root)  # release 包内即 <name>/...
        if _has_model(voice_dir):
            print(f"[sherpa]    ok {name}(含 model.onnx + tokens.txt)")
            return True
        print(f"[sherpa] !! 解压后 {voice_dir} 缺 model.onnx / tokens.txt — 检查包结构")
        return False
    except Exception as e:  # noqa: BLE001
        print(
            f"[sherpa] !! 下载/解压 {name} 失败: {type(e).__name__}: {e}\n"
            f"         可设 CHAYUAN_SHERPA_BASE 换源,或手动从 release 页下 "
            f"{name}.tar.bz2 解压到 {dest_root}/{name}/"
        )
        return False
    finally:
        if tmp and os.path.isfile(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


def main() -> int:
    ap = argparse.ArgumentParser(description="seed sherpa-onnx Chinese TTS models")
    ap.add_argument("--models", default="", help="逗号分隔模型名;缺省用默认集(中文)")
    ap.add_argument("--all", action="store_true", help="下中+英多语言起步集(STARTER_MULTILANG)")
    ap.add_argument("--list", action="store_true", help="按语言列出可下模型目录(CATALOG)")
    ap.add_argument("--mirror", default="", help="国内镜像: ghproxy / ghfast / gh-proxy(免手设环境变量)")
    args = ap.parse_args()

    if args.list:
        print("sherpa 可下模型(按语言;名字均已实测可下):")
        for lang, ms in CATALOG.items():
            print(f"  [{lang}]")
            for m in ms:
                print(f"    {m}")
        print("用法: python scripts/seed_sherpa_voices.py --models <名1>,<名2>")
        print("     python scripts/seed_sherpa_voices.py --all   # 中+英起步集")
        print("国内慢/不通,加镜像(任选其一,实测可用): --mirror ghproxy | ghfast | gh-proxy")
        print("     例: python scripts/seed_sherpa_voices.py --all --mirror ghproxy")
        return 0

    # 提醒装运行时包(只是模型 seed,推理还需 sherpa-onnx)
    try:
        import sherpa_onnx  # noqa: F401
    except Exception:  # noqa: BLE001
        print("[sherpa] !! 未检测到 sherpa-onnx 包,推理时用不了。先装: "
              "pip install sherpa-onnx (国内: pip install sherpa-onnx -i "
              "https://pypi.tuna.tsinghua.edu.cn/simple)")

    if args.all:
        models = list(STARTER_MULTILANG)
    elif args.models:
        models = [m.strip() for m in args.models.split(",") if m.strip()]
    else:
        models = list(DEFAULT_MODELS)
    if args.mirror:
        prefix = MIRRORS.get(args.mirror, args.mirror)  # 也允许直接传前缀 URL
        base = prefix.rstrip("/") + "/" + DEFAULT_BASE
    else:
        base = os.environ.get("CHAYUAN_SHERPA_BASE") or DEFAULT_BASE
    # 关键:去掉粘贴长 URL 时被终端折行带进来的 \n 和空格(否则 httpx 报
    # InvalidURL: non-printable ASCII '\n')。
    base = "".join(base.split())
    dest = _bundled_sherpa_dir()
    print(f"[sherpa] base = {base}")
    print(f"[sherpa] dest = {dest}")
    print(f"[sherpa] models = {models}")

    ok = 0
    for name in models:
        print(f"[sherpa] -- {name}")
        if _download_extract(name, base, dest):
            ok += 1
    print(f"[sherpa] done: {ok}/{len(models)} 成功")
    return 0 if ok == len(models) else 1


if __name__ == "__main__":
    sys.exit(main())
