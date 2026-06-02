"""把(类型+台词+角色)规划成合成单元列表。纯函数,无 IO,可测。
SynthUnit = 一段要合成的语音(属于某角色,带该角色音色/语速/音量)。"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


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


def plan(dh_type: str, script: Optional[str] = None,
         role_scripts: Optional[List[str]] = None,
         role_segments: Optional[List[Dict[str, Any]]] = None,
         *, roles) -> List[SynthUnit]:
    """规划合成单元。
    - single:全局 script 整段,角色 0。
    - coframe:role_segments 为有序 [{role_index,text}] 时按序逐段产出(AI 多角色产物);
      无 segments 时回退 role_scripts(每角色一串,各自按句切分后按句序轮流交织 甲1,乙1,甲2,...)。
    - sequential:role_segments 为有序 [{role_index,text}],逐段产出;无 segments 时回退
      role_scripts(每角色整串,跳过空串)。
    roles 为 keyword-only,避免位置参数误传。"""
    out: List[SynthUnit] = []
    roles = list(roles or [])
    n = len(roles)
    if not n:
        return out
    if dh_type == "single" or n <= 1:
        t = (script or "").strip()
        if t:
            out.append(_unit(0, roles[0], t))
        return out
    if dh_type == "coframe":
        segs = role_segments or []
        if segs:
            # AI 多角色产物:按 role_segments 顺序逐段产出,越界跳过。
            for seg in segs:
                idx = int(seg.get("role_index", 0))
                t = (seg.get("text") or "").strip()
                if 0 <= idx < n and t:
                    out.append(_unit(idx, roles[idx], t))
            return out
        from chayuan.server.video_generation.steps.subtitle import _split_string_by_punctuations
        rs = role_scripts or []
        per = []
        for i in range(n):
            sline = (rs[i] if i < len(rs) else "") or ""
            per.append([x for x in _split_string_by_punctuations(sline) if x.strip()])
        maxk = max((len(p) for p in per), default=0)
        for k in range(maxk):
            for i in range(n):
                if k < len(per[i]):
                    out.append(_unit(i, roles[i], per[i][k]))
        return out
    if dh_type == "sequential":
        segs = role_segments or []
        if segs:
            for seg in segs:
                idx = int(seg.get("role_index", 0))
                t = (seg.get("text") or "").strip()
                if 0 <= idx < n and t:
                    out.append(_unit(idx, roles[idx], t))
        else:
            rs = role_scripts or []
            for i in range(n):
                t = (rs[i] if i < len(rs) else "") or ""
                if t.strip():
                    out.append(_unit(i, roles[i], t))
        return out
    return out
