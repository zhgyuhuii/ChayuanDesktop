#!/usr/bin/env python3
"""下载 Wav2Lip 推理权重到 vendor/bundled_models/digital_human/。
来源:ModelScope silveroxides/ComfyUI_wav2lip-models(2026-05-30 实测匿名 200)。
只取 wav2lip_gan.pth(436MB)+ s3fd-619a316812.pth(90MB);训练用 ckpt 不取。
"""
from __future__ import annotations
import argparse, os, shutil, sys
from pathlib import Path

MODELSCOPE_ID = "silveroxides/ComfyUI_wav2lip-models"
WANT = ["wav2lip_gan.pth", "s3fd-619a316812.pth"]


def _dest() -> Path:
    return Path(__file__).resolve().parents[1] / "vendor" / "bundled_models" / "digital_human"


def _is_ready(d: Path) -> bool:
    return (d / "wav2lip_gan.pth").is_file()


def main() -> int:
    ap = argparse.ArgumentParser(description="seed Wav2Lip 推理权重到 vendor")
    ap.add_argument("--dest", default=None)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    dest = Path(a.dest).resolve() if a.dest else _dest()
    if _is_ready(dest):
        print(f"[dh] OK 已就绪: {dest}"); return 0
    if a.check:
        print(f"[dh] [FAIL] 未就绪: {dest}"); return 1
    try:
        from modelscope.hub.file_download import model_file_download
    except Exception as e:  # noqa: BLE001
        print(f"[dh] !! 需要 modelscope: pip install modelscope ({e})"); return 1
    dest.mkdir(parents=True, exist_ok=True)
    for fn in WANT:
        print(f"[dh] 下载 {fn} …")
        p = model_file_download(model_id=MODELSCOPE_ID, file_path=fn)
        shutil.copy2(p, dest / fn)
    print("[dh] OK" if _is_ready(dest) else "[dh] [FAIL]")
    return 0 if _is_ready(dest) else 1


if __name__ == "__main__":
    sys.exit(main())
