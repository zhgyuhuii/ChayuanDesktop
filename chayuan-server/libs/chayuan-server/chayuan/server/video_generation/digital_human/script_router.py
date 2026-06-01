"""把(类型+台词+角色)规划成合成单元列表。纯函数,无 IO,可测。
SynthUnit = 一段要合成的语音(属于某角色,带该角色音色/语速/音量)。"""
from __future__ import annotations
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class SynthUnit:
    role_index: int
    text: str
    provider: str
    voice_name: str
    rate: float = 1.0
    volume: float = 1.0


def _unit(i, role, text):
    return SynthUnit(
        role_index=i, text=text,
        provider=(getattr(role, "voice_provider", "") or ""),
        voice_name=(getattr(role, "voice_name", "") or ""),
        rate=float(getattr(role, "voice_rate", 1.0) or 1.0),
        volume=float(getattr(role, "voice_volume", 1.0) or 1.0),
    )


def plan(dh_type: str, script: Optional[str], role_scripts: Optional[List[str]], roles) -> List[SynthUnit]:
    roles = list(roles or [])
    if not roles:
        return []
    if dh_type == "sequential":
        rs = role_scripts or []
        out = []
        for i, role in enumerate(roles):
            t = (rs[i] if i < len(rs) else "") or ""
            if t.strip():
                out.append(_unit(i, role, t))
        return out
    if dh_type == "coframe":
        from chayuan.server.video_generation.steps.subtitle import _split_string_by_punctuations
        sents = [s.strip() for s in _split_string_by_punctuations(script or "") if s.strip()]
        if not sents:
            sents = [(script or "")]
        out = []
        for j, sent in enumerate(sents):
            i = j % len(roles)
            out.append(_unit(i, roles[i], sent))
        return out
    return [_unit(0, roles[0], script or "")]
