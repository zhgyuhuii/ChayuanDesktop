#!/usr/bin/env python3
"""下载 VoxCPM-0.5B 音色克隆模型到 vendor/bundled_models/tts/voxcpm/VoxCPM-0.5B/,
让 full 版「语音设置 → 克隆」开箱即用(零下载、offline 推理)。

为什么需要这个:
  modality.audio._synthesize_via_voxcpm 走 VoxCPM.from_pretrained(<本地目录>),
  本地目录由 _resolve_voxcpm_model_dir() 解析:
    1) CHAYUAN_ROOT/models/bundled/tts/voxcpm/VoxCPM-0.5B/(装机 seed)
    2) <vendor>/bundled_models/tts/voxcpm/VoxCPM-0.5B/(打包/开发)
  目录里有 config.json 即视为就绪。没 seed → 回退 HF repo id(要联网,
  full 版不该走到)。本脚本把模型下到 vendor,打包带上。

模型来源:ModelScope ``OpenBMB/VoxCPM-0.5B``(国内可达;HF 不可达,实测
  2026-05-30 ModelScope HTTP 200、含 config.json/pytorch_model.bin/audiovae.pth)。
  约 ~1.5GB,首次下载耗时取决于带宽。

落地布局(_resolve_voxcpm_model_dir 要求):
    vendor/bundled_models/tts/voxcpm/VoxCPM-0.5B/{config.json, pytorch_model.bin,
        audiovae.pth, tokenizer.json, ...}

用法:
    python scripts/seed_voxcpm.py            # 默认下到 vendor
    python scripts/seed_voxcpm.py --dest /some/dir   # 自定义目标
    python scripts/seed_voxcpm.py --check    # 只检查是否已就绪,不下载
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

MODELSCOPE_ID = "OpenBMB/VoxCPM-0.5B"
MODEL_NAME = "VoxCPM-0.5B"


def _bundled_voxcpm_dir() -> Path:
    here = Path(__file__).resolve()
    server_root = here.parents[1]  # chayuan-server/
    return server_root / "vendor" / "bundled_models" / "tts" / "voxcpm" / MODEL_NAME


def _is_ready(model_dir: Path) -> bool:
    return (model_dir / "config.json").is_file()


def _download_modelscope(dest: Path) -> bool:
    try:
        from modelscope import snapshot_download  # type: ignore
    except Exception as e:  # noqa: BLE001
        print(f"[voxcpm] !! 需要 modelscope:pip install modelscope  ({e})")
        return False

    dest.mkdir(parents=True, exist_ok=True)
    print(f"[voxcpm] 下载 {MODELSCOPE_ID} -> {dest}(~1.5GB,请耐心)")
    try:
        # 新版 modelscope 支持 local_dir 直接落到目标目录
        snapshot_download(MODELSCOPE_ID, local_dir=str(dest))
    except TypeError:
        # 老版无 local_dir:下到默认 cache 再拷贝
        cache_path = snapshot_download(MODELSCOPE_ID)
        for item in Path(cache_path).iterdir():
            target = dest / item.name
            if item.is_dir():
                shutil.copytree(item, target, dirs_exist_ok=True)
            else:
                shutil.copy2(item, target)
    except Exception as e:  # noqa: BLE001
        print(f"[voxcpm] !! 下载失败: {e}")
        return False
    return _is_ready(dest)


def main() -> int:
    ap = argparse.ArgumentParser(description="seed VoxCPM-0.5B 克隆模型到 vendor")
    ap.add_argument("--dest", default=None, help="目标目录(默认 vendor/bundled_models/tts/voxcpm/VoxCPM-0.5B)")
    ap.add_argument("--check", action="store_true", help="只检查是否就绪,不下载")
    args = ap.parse_args()

    dest = Path(args.dest).resolve() if args.dest else _bundled_voxcpm_dir()

    if _is_ready(dest):
        print(f"[voxcpm] OK 已就绪: {dest}")
        return 0
    if args.check:
        print(f"[voxcpm] [FAIL] 未就绪(缺 config.json): {dest}")
        return 1

    if _download_modelscope(dest):
        print(f"[voxcpm] OK 下载完成: {dest}")
        return 0
    print(f"[voxcpm] [FAIL] seed 失败,可手动从 https://www.modelscope.cn/models/{MODELSCOPE_ID} "
          f"下载后解压到 {dest}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
