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

import logging as _logging
_logger = _logging.getLogger("chayuan.dh.store")

# 对象存储:数字人用户形象(头像)key 前缀。后端=minio 时上传镜像 + 本地缺失回填,
# 与 modality artifacts 同思路;local 后端跳过(本地副本即权威)。
_DH_AVATAR_NS_PREFIX = "dh_avatars"


def _obj_storage_if_remote():
    """生效后端是 minio(非 local)时返回 storage 实例,否则 None。"""
    try:
        from chayuan.server.file_storage import get_storage
        st = get_storage()
        return st if getattr(st, "name", "local") != "local" else None
    except Exception as e:  # noqa: BLE001
        _logger.debug("get_storage 失败,跳过对象存储:%r", e)
        return None


def mirror_avatar(fid: str, local_path: str) -> None:
    """后端=minio 时把用户形象文件镜像进对象存储(fail-open)。"""
    st = _obj_storage_if_remote()
    if st is None:
        return
    try:
        from chayuan.server.file_storage import NS
        st.put_file(NS.MISC, f"{_DH_AVATAR_NS_PREFIX}/{fid}", local_path)
        _logger.info("[dh] 形象镜像到对象存储:%s", fid)
    except Exception as e:  # noqa: BLE001
        _logger.warning("[dh] 形象对象存储镜像失败(已留本地副本):%r", e)


def _fetch_avatar_local(fid: str) -> Optional[str]:
    """本地缺失时从对象存储回填用户形象,返回本地路径;无则 None。"""
    st = _obj_storage_if_remote()
    if st is None:
        return None
    try:
        from chayuan.server.file_storage import NS
        key = f"{_DH_AVATAR_NS_PREFIX}/{fid}"
        if not st.exists(NS.MISC, key):
            return None
        dest = os.path.join(dh_avatars_dir(create=True), fid)
        st.copy_to_local(NS.MISC, key, dest)
        return dest if os.path.isfile(dest) else None
    except Exception as e:  # noqa: BLE001
        _logger.warning("[dh] 形象从对象存储回填失败 %s:%r", fid, e)
        return None



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


_SUB_KEYS = ("subtitle_enabled", "subtitle_position", "font_name", "font_size",
             "text_fore_color", "text_background_color", "stroke_color", "stroke_width")


def create_preset(*, name: str, welcome: str = "", idle_script: str = "", avatar_ref: str = "", avatar_kind: str = "image",
                  voice_provider: str = "piper", voice_name: str = "",
                  is_greenscreen: bool = False, matte_sim: Optional[float] = None,
                  avatars: Optional[List[Dict[str, Any]]] = None,
                  compose_mode: str = "single", layout: str = "side",
                  subtitle_enabled: bool = True,
                  subtitle: Optional[Dict[str, Any]] = None,
                  video_width: int = 720, video_height: int = 1280,
                  model: str = "", ku_ids: Optional[List[str]] = None,
                  allow_model_override: bool = True,
                  allow_kb_override: bool = True) -> DigitalHumanPreset:
    sub = subtitle or {}
    sub_fields = {k: sub[k] for k in _SUB_KEYS if k in sub}
    # subtitle_enabled 既是显式形参、又可能在嵌套 subtitle 里 → 以嵌套值优先,
    # 二者只保留一个,避免 DigitalHumanPreset(**) 同名重复 TypeError。
    sub_fields.setdefault("subtitle_enabled", subtitle_enabled)
    p = DigitalHumanPreset(
        id=uuid.uuid4().hex[:12], name=name, welcome=welcome, idle_script=idle_script, avatar_ref=avatar_ref,
        avatar_kind=avatar_kind, is_greenscreen=is_greenscreen, matte_sim=matte_sim,
        voice_provider=voice_provider, voice_name=voice_name, created=time.time(),
        avatars=avatars or [], compose_mode=compose_mode, layout=layout,
        video_width=video_width, video_height=video_height,
        model=model, ku_ids=ku_ids or [],
        allow_model_override=allow_model_override,
        allow_kb_override=allow_kb_override,
        **sub_fields,
    )
    rows = _load_raw(); rows.append(p.model_dump()); _save_raw(rows)
    return p


def update_preset(pid: str, **fields: Any) -> Optional[DigitalHumanPreset]:
    # 嵌套 subtitle dict 解包到扁平字段(与 create 一致),并丢弃原始 subtitle 键
    _sub = fields.pop("subtitle", None)
    if _sub:
        for _k in _SUB_KEYS:
            if _k in _sub:
                fields[_k] = _sub[_k]
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
        fid = avatar_ref[len("user:"):]
        p = os.path.join(dh_avatars_dir(), fid)
        if os.path.isfile(p):
            return p
        # 后端=minio 且本机无本地副本(多副本/已迁对象存储)→ 回填本地缓存
        return _fetch_avatar_local(fid)
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
