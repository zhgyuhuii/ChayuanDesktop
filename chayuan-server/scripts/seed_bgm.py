#!/usr/bin/env python3
"""把上游 chayuan-video-generation/resource/songs/ 的 BGM 转码 96kbps 落到
vendor/bundled_bgm/,供打包/装机自带(full 版零下载)。

为什么转码:上游 29 首原始 56MB,96kbps 单声道足够当背景音 → ~20MB。
ffmpeg 不可用时回退直接拷贝(体积大但能用),并打印告警。

用法:
    python scripts/seed_bgm.py
    python scripts/seed_bgm.py --src /path/to/songs --bitrate 96k
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_SRC = Path("/work/chayuan-video-generation/resource/songs")


def _bundled_bgm_dir() -> Path:
    here = Path(__file__).resolve()
    server_root = here.parents[1]  # chayuan-server/
    return server_root / "vendor" / "bundled_bgm"


def _have_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def _transcode(src: Path, dst: Path, bitrate: str) -> bool:
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(src), "-vn", "-ac", "1",
             "-b:a", bitrate, str(dst)],
            check=True, capture_output=True,
        )
        return dst.is_file() and dst.stat().st_size > 0
    except Exception as e:  # noqa: BLE001
        print(f"[bgm] !! transcode {src.name} 失败: {e}")
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description="seed bundled BGM")
    ap.add_argument("--src", default=str(DEFAULT_SRC))
    ap.add_argument("--bitrate", default="96k")
    args = ap.parse_args()

    src_dir = Path(args.src)
    dst_dir = _bundled_bgm_dir()
    if not src_dir.is_dir():
        print(f"[bgm] !! 源目录不存在: {src_dir}")
        return 1
    dst_dir.mkdir(parents=True, exist_ok=True)

    songs = sorted(p for p in src_dir.iterdir()
                   if p.suffix.lower() in (".mp3", ".wav", ".m4a", ".aac", ".ogg"))
    if not songs:
        print(f"[bgm] !! {src_dir} 无音频文件")
        return 1

    use_ffmpeg = _have_ffmpeg()
    if not use_ffmpeg:
        print("[bgm] ! 未找到 ffmpeg,回退直接拷贝(体积不压缩)")

    ok = 0
    for s in songs:
        dst = dst_dir / (s.stem + ".mp3")
        if dst.is_file() and dst.stat().st_size > 0:
            print(f"[bgm]    skip(已存在) {dst.name}")
            ok += 1
            continue
        if use_ffmpeg and _transcode(s, dst, args.bitrate):
            print(f"[bgm]    ok {dst.name}")
            ok += 1
        else:
            shutil.copy2(s, dst_dir / s.name)
            print(f"[bgm]    copied(未转码) {s.name}")
            ok += 1
    print(f"[bgm] done: {ok}/{len(songs)} → {dst_dir}")
    return 0 if ok == len(songs) else 1


if __name__ == "__main__":
    sys.exit(main())
