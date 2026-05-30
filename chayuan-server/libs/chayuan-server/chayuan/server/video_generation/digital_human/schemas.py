"""数字人 P1 数据契约。"""
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field

AvatarKind = Literal["image", "video"]
DhTemplate = Literal["none", "corner", "side", "bg"]  # P1 仅用 none;corner/side/bg 留 P2/P3
DhState = Literal["pending", "running", "complete", "failed", "canceled"]


class DigitalHumanPreset(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=40)
    avatar_ref: str            # "bundled:<id>" 或 "user:<file>"
    avatar_kind: AvatarKind
    is_greenscreen: bool = False
    voice_provider: Literal["piper", "edge", "sherpa", "clone"] = "piper"
    voice_name: str = ""
    created: float = 0.0


class DhGenerateRequest(BaseModel):
    preset_id: str
    text: str = Field(min_length=1, max_length=5000)
    # 以下 P1 不消费,占位以便 P2/P3 前向兼容:
    product_image: Optional[str] = None
    template: DhTemplate = "none"
    matte: bool = False


class DhTaskStatus(BaseModel):
    task_id: str
    state: DhState
    progress: int = 0
    error: str = ""
    result_path: str = ""
