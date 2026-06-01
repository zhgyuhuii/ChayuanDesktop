"""数字人预设 + 形象库持久化(presets.json + avatars 目录扫描)。"""
from __future__ import annotations
import json, os, time, uuid
from typing import Any, Dict, List, Optional
from chayuan.server.video_generation._helpers import (
    digital_human_dir, dh_avatars_dir, dh_presets_path, dh_products_dir,
)
from chayuan.server.video_generation.digital_human.schemas import DigitalHumanPreset

_VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv"}
_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def _load_raw() -> List[Dict[str, Any]]:
    p = dh_presets_path()
    if not os.path.isfile(p):
        return []
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f) or []
    except Exception:  # noqa: BLE001
        return []


def _save_raw(rows: List[Dict[str, Any]]) -> None:
    digital_human_dir(create=True)
    with open(dh_presets_path(), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)


def list_presets() -> List[DigitalHumanPreset]:
    return [DigitalHumanPreset(**r) for r in _load_raw()]


def get_preset(pid: str) -> Optional[DigitalHumanPreset]:
    for r in _load_raw():
        if r.get("id") == pid:
            return DigitalHumanPreset(**r)
    return None


def create_preset(*, name: str, avatar_ref: str = "", avatar_kind: str = "image",
                  voice_provider: str = "piper", voice_name: str = "",
                  is_greenscreen: bool = False,
                  avatars: Optional[List[Dict[str, Any]]] = None,
                  compose_mode: str = "single", layout: str = "side",
                  subtitle_enabled: bool = True,
                  video_width: int = 720, video_height: int = 1280) -> DigitalHumanPreset:
    p = DigitalHumanPreset(
        id=uuid.uuid4().hex[:12], name=name, avatar_ref=avatar_ref,
        avatar_kind=avatar_kind, is_greenscreen=is_greenscreen,
        voice_provider=voice_provider, voice_name=voice_name, created=time.time(),
        avatars=avatars or [], compose_mode=compose_mode, layout=layout,
        subtitle_enabled=subtitle_enabled,
        video_width=video_width, video_height=video_height,
    )
    rows = _load_raw(); rows.append(p.model_dump()); _save_raw(rows)
    return p


def update_preset(pid: str, **fields: Any) -> Optional[DigitalHumanPreset]:
    # 不允许改 id/created(否则会改出找不回的孤儿条目)
    safe = {k: v for k, v in fields.items() if v is not None and k not in ("id", "created")}
    rows = _load_raw(); hit = None
    for r in rows:
        if r.get("id") == pid:
            r.update(safe)
            hit = r
    if hit is None:
        return None
    _save_raw(rows)
    return DigitalHumanPreset(**hit)


def delete_preset(pid: str) -> bool:
    rows = _load_raw(); new = [r for r in rows if r.get("id") != pid]
    if len(new) == len(rows):
        return False
    _save_raw(new)
    return True


def _bundled_avatars_root() -> Optional[str]:
    """vendor/bundled_assets/digital_human/avatars 或装机 models/bundled 下同名。"""
    from pathlib import Path
    here = Path(__file__).resolve()
    for parent in here.parents:
        vd = parent / "vendor" / "bundled_assets" / "digital_human" / "avatars"
        if vd.is_dir():
            return str(vd)
    return None


def _kind_of(fname: str) -> Optional[str]:
    ext = os.path.splitext(fname)[1].lower()
    if ext in _VIDEO_EXT:
        return "video"
    if ext in _IMAGE_EXT:
        return "image"
    return None


def list_avatars() -> List[Dict[str, Any]]:
    """预置 ∪ 用户上传,返 [{ref,kind,source,name}]。"""
    out: List[Dict[str, Any]] = []
    broot = _bundled_avatars_root()
    if broot:
        for f in sorted(os.listdir(broot)):
            k = _kind_of(f)
            if k:
                out.append({"ref": f"bundled:{f}", "kind": k, "source": "bundled", "name": f})
    udir = dh_avatars_dir()
    if os.path.isdir(udir):
        for f in sorted(os.listdir(udir)):
            k = _kind_of(f)
            if k:
                out.append({"ref": f"user:{f}", "kind": k, "source": "user", "name": f})
    return out


def resolve_avatar_path(avatar_ref: str) -> Optional[str]:
    """"bundled:<f>" / "user:<f>" → 绝对路径。"""
    if avatar_ref.startswith("user:"):
        p = os.path.join(dh_avatars_dir(), avatar_ref[len("user:"):])
        return p if os.path.isfile(p) else None
    if avatar_ref.startswith("bundled:"):
        broot = _bundled_avatars_root()
        if not broot:
            return None
        p = os.path.join(broot, avatar_ref[len("bundled:"):])
        return p if os.path.isfile(p) else None
    return None


def resolve_product_path(ref: str) -> Optional[str]:
    """``product:<file>`` → 绝对路径;不是该前缀或文件不存在返 None。"""
    if not ref or not ref.startswith("product:"):
        return None
    p = os.path.join(dh_products_dir(), os.path.basename(ref[len("product:"):]))
    return p if os.path.isfile(p) else None
