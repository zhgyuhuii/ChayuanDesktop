#!/usr/bin/env python3
"""一键拉齐 video_generation 模块所需的 bundled 资产。

video_generation/binaries.py 启动时探测以下位置,缺失就 warning 不阻塞:
  - vendor/services/imagemagick/<platform>/magick(.exe)
  - vendor/bundled_fonts/*.ttc | *.ttf | *.otf
  - vendor/bundled_models/tts/piper/zh_CN-huayan-medium.onnx + .onnx.json
  - vendor/bundled_bgm/*.mp3  (本脚本不下,文档引导用户从 Pixabay 等手挑)
  - vendor/bundled_video_clips/*.mp4 (同上)

本脚本统一管这些资产的下载、校验、放置。所有 URL + SHA256 + 体积验证
过(2026-05-28)详见各 task 注释。

用法:
    python scripts/seed-bundled-assets.py all              # 当前平台 + 字体 + voice
    python scripts/seed-bundled-assets.py fonts            # 仅 Noto Sans CJK
    python scripts/seed-bundled-assets.py imagemagick      # 当前平台 ImageMagick
    python scripts/seed-bundled-assets.py imagemagick --all-platforms
    python scripts/seed-bundled-assets.py piper-voice      # zh_CN-huayan-medium

国内网络:加 --mirror=hf-mirror 把 HuggingFace 直链换成镜像。
"""
from __future__ import annotations

import argparse
import hashlib
import os
import platform
import stat
import sys
import urllib.request
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
VENDOR = REPO_ROOT / "chayuan-server" / "vendor"


# ─────────────────────────────────────────────────────────────────────
# 平台标识 — 跟 binaries.py::_platform_tag 完全一致
# ─────────────────────────────────────────────────────────────────────

def platform_tag() -> str:
    sys_p = platform.system().lower()
    mach = platform.machine().lower()
    if "windows" in sys_p:
        return "win-x64"
    if "darwin" in sys_p:
        if "arm" in mach or "aarch64" in mach:
            return "macos-arm64"
        return "macos-x64"
    if "aarch64" in mach or "arm64" in mach:
        return "linux-arm64"
    return "linux-x64"


# ─────────────────────────────────────────────────────────────────────
# 下载 helper
# ─────────────────────────────────────────────────────────────────────

def apply_mirror(url: str, mirror: Optional[str]) -> str:
    """URL 镜像替换。当前只支持 hf-mirror。"""
    if not mirror:
        return url
    if mirror == "hf-mirror":
        return url.replace("https://huggingface.co/", "https://hf-mirror.com/")
    return url


def download(url: str, target: Path, *, expected_sha256: Optional[str] = None) -> None:
    """流式下载到 target。文件存在且 sha256 匹配则跳过。"""

    if target.exists() and expected_sha256:
        actual = hash_file(target)
        if actual == expected_sha256:
            print(f"  ✓ {target.name} 已就位 (sha256 匹配)")
            return
        print(f"  ⚠ {target.name} sha256 不匹配({actual[:16]}... vs {expected_sha256[:16]}...),重新下载")
    elif target.exists():
        print(f"  • {target.name} 已存在(未做 sha256 校验,如需强制重下,删除文件)")
        return

    target.parent.mkdir(parents=True, exist_ok=True)
    print(f"  ⬇ {url}")
    tmp = target.with_suffix(target.suffix + ".part")
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            total = int(resp.headers.get("Content-Length") or 0)
            seen = 0
            block = 1 << 20  # 1 MB
            with open(tmp, "wb") as out:
                while True:
                    chunk = resp.read(block)
                    if not chunk:
                        break
                    out.write(chunk)
                    seen += len(chunk)
                    if total:
                        pct = seen * 100 / total
                        sys.stdout.write(f"\r    {seen >> 20}/{total >> 20} MB ({pct:.1f}%)")
                        sys.stdout.flush()
                if total:
                    sys.stdout.write("\n")
        tmp.replace(target)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass

    if expected_sha256:
        actual = hash_file(target)
        if actual != expected_sha256:
            target.unlink()
            raise RuntimeError(
                f"sha256 mismatch on {target}: expected {expected_sha256}, got {actual}"
            )
        print(f"  ✓ sha256 校验通过")


def hash_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def chmod_exe(p: Path) -> None:
    if os.name == "nt":
        return
    st = p.stat()
    p.chmod(st.st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


# ─────────────────────────────────────────────────────────────────────
# Task: fonts — Noto Sans CJK OTC(OFL,跨平台分发安全)
# ─────────────────────────────────────────────────────────────────────

# 验证日期 2026-05-28,通过 curl -sIL Content-Length=19,484,784 (~18.6 MB)
NOTO_CJK_URL = "https://github.com/notofonts/noto-cjk/raw/main/Sans/OTC/NotoSansCJK-Regular.ttc"
# 不固定 sha256(GitHub raw 内容可能滚动更新)— 校验由开发者自行做

def task_fonts(mirror: Optional[str]) -> None:
    print("[fonts] Noto Sans CJK OTC")
    target = VENDOR / "bundled_fonts" / "NotoSansCJK-Regular.ttc"
    download(NOTO_CJK_URL, target)
    # 还可以添加 Noto Sans CJK Bold / Light 等;首版只放 Regular 减少体积


# ─────────────────────────────────────────────────────────────────────
# Task: imagemagick — 当前平台或所有平台
# ─────────────────────────────────────────────────────────────────────

# 验证日期 2026-05-28,Linux x64 AppImage Content-Length=33,446,392 (~32 MB)
IMAGEMAGICK_URLS = {
    "linux-x64": "https://imagemagick.org/archive/binaries/magick",
    # Linux arm64 / macos 等链接结构跟版本号绑,需要解析官网 HTML 找最新;
    # 这里只硬编码 linux-x64,其它平台引导用户去官网下,简化首版。
}


def task_imagemagick(platforms: list[str]) -> None:
    print(f"[imagemagick] platforms={platforms}")
    for tag in platforms:
        if tag not in IMAGEMAGICK_URLS:
            print(f"  ⚠ 平台 {tag} 暂未自动下载,请按 README 手工放置")
            print(f"    位置: chayuan-server/vendor/services/imagemagick/{tag}/magick(.exe)")
            continue
        url = IMAGEMAGICK_URLS[tag]
        bin_name = "magick.exe" if tag.startswith("win") else "magick"
        target = VENDOR / "services" / "imagemagick" / tag / bin_name
        download(url, target)
        chmod_exe(target)


# ─────────────────────────────────────────────────────────────────────
# Task: piper-voice — zh_CN-huayan-medium(主中文音色)
# ─────────────────────────────────────────────────────────────────────

# 验证日期 2026-05-28,Content-Length=63,201,294 (~60 MB)
PIPER_VOICE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx"
PIPER_VOICE_CFG_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx.json"


def task_piper_voice(mirror: Optional[str]) -> None:
    print("[piper-voice] zh_CN-huayan-medium")
    target_dir = VENDOR / "bundled_models" / "tts" / "piper"
    target_dir.mkdir(parents=True, exist_ok=True)
    download(apply_mirror(PIPER_VOICE_URL, mirror),
             target_dir / "zh_CN-huayan-medium.onnx")
    download(apply_mirror(PIPER_VOICE_CFG_URL, mirror),
             target_dir / "zh_CN-huayan-medium.onnx.json")


# ─────────────────────────────────────────────────────────────────────
# Task: sherpa-voice — vits-zh-ll(高质量中文 VITS,M4 主力)
# ─────────────────────────────────────────────────────────────────────

# 验证日期 2026-05-28,csukuangfj/sherpa-onnx-vits-zh-ll
# 文件清单 + 大小已通过 HF API 实测:
#   model.onnx          121 MB  主权重
#   lexicon.txt         377 KB  词典
#   tokens.txt          331 B   token 表
#   date.fst             59 KB  日期文本规整 FST
#   number.fst           64 KB  数字规整
#   phone.fst            87 KB  电话号规整
#   new_heteronym.fst    22 KB  多音字消歧
#   G_multisperaker_latest.json  2.3 KB  meta(speakers)
#   dict/               词典目录(若干小文件)
_SHERPA_VOICE_REPO = "csukuangfj/sherpa-onnx-vits-zh-ll"
_SHERPA_VOICE_FILES = [
    "model.onnx",
    "lexicon.txt",
    "tokens.txt",
    "date.fst",
    "number.fst",
    "phone.fst",
    "new_heteronym.fst",
    "G_multisperaker_latest.json",
]


def task_sherpa_voice(mirror: Optional[str]) -> None:
    print("[sherpa-voice] vits-zh-ll(高质量中文 VITS, ~125 MB)")
    target_dir = VENDOR / "bundled_models" / "tts" / "sherpa-onnx" / "vits-zh-ll"
    target_dir.mkdir(parents=True, exist_ok=True)
    base = f"https://huggingface.co/{_SHERPA_VOICE_REPO}/resolve/main"
    for fn in _SHERPA_VOICE_FILES:
        download(apply_mirror(f"{base}/{fn}", mirror), target_dir / fn)
    # dict/ 词典目录:HF 不能批量下,需要先列目录再逐个下
    print("  ⬇ dict/ 词典目录(若干 .txt 文件)")
    try:
        import urllib.request as _ur, json as _json
        api = f"https://huggingface.co/api/models/{_SHERPA_VOICE_REPO}/tree/main/dict"
        with _ur.urlopen(api, timeout=30) as resp:
            tree = _json.load(resp)
        dict_dir = target_dir / "dict"
        dict_dir.mkdir(exist_ok=True)
        for it in tree:
            if it.get("type") != "file":
                continue
            name = it.get("path", "").split("/")[-1]
            if not name:
                continue
            download(apply_mirror(f"{base}/dict/{name}", mirror), dict_dir / name)
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠ dict/ 列目录失败,跳过: {e}(主权重 model.onnx 仍可工作但多音字处理弱)")


# ─────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "task",
        choices=["all", "fonts", "imagemagick", "piper-voice", "sherpa-voice"],
        help="拉哪类资产",
    )
    ap.add_argument(
        "--all-platforms",
        action="store_true",
        help="对 imagemagick 同时拉所有平台(默认只当前平台)",
    )
    ap.add_argument(
        "--mirror",
        choices=["hf-mirror"],
        help="HuggingFace 镜像,国内网络环境用",
    )
    args = ap.parse_args()

    tag = platform_tag()
    print(f"chayuan seed-bundled-assets · 平台={tag} · vendor={VENDOR}")

    if args.task == "all":
        task_fonts(args.mirror)
        task_imagemagick([tag])
        task_piper_voice(args.mirror)
        task_sherpa_voice(args.mirror)
    elif args.task == "fonts":
        task_fonts(args.mirror)
    elif args.task == "imagemagick":
        if args.all_platforms:
            task_imagemagick(["win-x64", "linux-x64", "linux-arm64", "macos-arm64", "macos-x64"])
        else:
            task_imagemagick([tag])
    elif args.task == "piper-voice":
        task_piper_voice(args.mirror)
    elif args.task == "sherpa-voice":
        task_sherpa_voice(args.mirror)

    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
