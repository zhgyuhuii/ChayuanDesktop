"""在线数字人发布记录持久化(published.json)。

发布 = 对 ``DigitalHumanPreset`` 配置的**快照** + 公开 token。用快照(而非引用
preset)的原因:源 preset 之后被改/删不应弄坏已发布的公开页。同一个 preset_id
重复发布 → 覆盖快照、保留原 token 与控制位(幂等)。
"""
from __future__ import annotations

import json
import os
import secrets
import time
from typing import Any, Dict, List, Optional

from chayuan.server.video_generation._helpers import digital_human_dir, dh_published_path
from chayuan.server.video_generation.digital_human.schemas import (
    DigitalHumanPreset,
    PublishedAvatar,
)


def _load_raw() -> List[Dict[str, Any]]:
    p = dh_published_path()
    if not os.path.isfile(p):
        return []
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f) or []
    except Exception:  # noqa: BLE001
        return []


def _save_raw(rows: List[Dict[str, Any]]) -> None:
    digital_human_dir(create=True)
    with open(dh_published_path(), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)


def _persona_of(preset: DigitalHumanPreset) -> str:
    """单形象取首槽 persona;多形象把各槽 persona 拼起来(公开页用单一系统提示)。"""
    parts = [a.persona for a in (preset.avatars or []) if getattr(a, "persona", "")]
    return "\n".join(parts).strip()


def _snapshot(preset: DigitalHumanPreset, owner_id: str) -> Dict[str, Any]:
    _av0 = (preset.avatars or [None])[0]
    return dict(
        preset_id=preset.id,
        owner_id=owner_id,
        name=preset.name,
        avatar_ref=preset.avatar_ref,
        avatar_kind=preset.avatar_kind,
        video_width=preset.video_width,
        video_height=preset.video_height,
        model=preset.model,
        ku_ids=list(preset.ku_ids or []),
        persona=_persona_of(preset),
        voice_provider=preset.voice_provider,
        voice_name=preset.voice_name,
        # 场景:形象位置/大小/透明度 + 商品图层(公开页 idle 按此摆放)。
        avatar_x=float(getattr(_av0, "x", 0.0) or 0.0) if _av0 is not None else 0.0,
        avatar_y=float(getattr(_av0, "y", 0.0) or 0.0) if _av0 is not None else 0.0,
        avatar_scale=float(getattr(_av0, "scale", 1.0) or 1.0) if _av0 is not None else 1.0,
        avatar_opacity=getattr(_av0, "opacity", None) if _av0 is not None else None,
        avatar_z=getattr(_av0, "z", None) if _av0 is not None else None,
        products=[p.model_dump() for p in (preset.products or [])],
    )


def list_published(owner_id: Optional[str] = None) -> List[PublishedAvatar]:
    rows = [PublishedAvatar(**r) for r in _load_raw()]
    if owner_id:
        rows = [r for r in rows if (r.owner_id or "") == owner_id]
    return rows


def get_by_token(token: str) -> Optional[PublishedAvatar]:
    for r in _load_raw():
        if r.get("token") == token:
            return PublishedAvatar(**r)
    return None


def publish(preset: DigitalHumanPreset, *, owner_id: str = "", new: bool = False) -> PublishedAvatar:
    """从 preset 快照发布。

    - ``new=False``(默认/兼容):同 preset_id 已存在 → 覆盖快照,保留 token/控制位/created(幂等更新)。
    - ``new=True``:总是新建一条(新 token)→ **一个 preset 可发布多个在线数字人**(各自独立链接/控制位)。
    """
    rows = _load_raw()
    snap = _snapshot(preset, owner_id)
    if not new:
        for i, r in enumerate(rows):
            if r.get("preset_id") == preset.id:
                r.update(snap)        # 覆盖快照字段,保留 token/enabled/chat_enabled/限流/created
                rec = PublishedAvatar(**r)
                rows[i] = rec.model_dump()
                _save_raw(rows)
                return rec
    rec = PublishedAvatar(token=secrets.token_urlsafe(9), created=time.time(), **snap)
    rows.append(rec.model_dump())
    _save_raw(rows)
    return rec


def delete(token: str) -> bool:
    rows = _load_raw()
    new = [r for r in rows if r.get("token") != token]
    if len(new) == len(rows):
        return False
    _save_raw(new)
    return True


def set_flags(token: str, *, enabled: Optional[bool] = None,
              chat_enabled: Optional[bool] = None) -> Optional[PublishedAvatar]:
    rows = _load_raw()
    hit = None
    for r in rows:
        if r.get("token") == token:
            if enabled is not None:
                r["enabled"] = bool(enabled)
            if chat_enabled is not None:
                r["chat_enabled"] = bool(chat_enabled)
            hit = r
    if hit is None:
        return None
    _save_raw(rows)
    return PublishedAvatar(**hit)
