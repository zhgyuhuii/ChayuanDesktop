"""数字人 P1 数据契约。"""
from __future__ import annotations
from typing import List, Literal, Optional, Union
from pydantic import BaseModel, Field, model_validator

AvatarKind = Literal["image", "video"]


class AvatarSlot(BaseModel):
    ref: str
    kind: AvatarKind = "image"
    label: str = ""
    lines: str = ""          # 该形象台词(同框/分段用);空=回退全局 text
    voice_provider: str = ""  # 该形象音色;空=继承预设级 voice_provider
    voice_name: str = ""      # 空=继承预设级 voice_name
    name: str = ""           # 角色昵称
    voice_rate: float = 1.0
    voice_volume: float = 1.0
    language: str = ""
    x: float = 0.0
    y: float = 0.0
    scale: float = 1.0


DhTemplate = Literal["none", "corner", "side", "bg"]  # P1 仅用 none;corner/side/bg 留 P2/P3
DhEngine = Literal["wav2lip", "sadtalker", "musetalk"]
DhState = Literal["pending", "running", "complete", "failed", "canceled"]


class DigitalHumanPreset(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=40)
    avatar_ref: str = ""       # "bundled:<id>" 或 "user:<file>"(首槽镜像)
    avatar_kind: AvatarKind = "image"
    is_greenscreen: bool = False
    voice_provider: Literal["piper", "edge", "sherpa", "clone"] = "piper"
    voice_name: str = ""
    created: float = 0.0
    # 多形象 + 合成模式(方案 B);旧 presets.json 行无这些字段 → 默认值 + validator 回填
    avatars: List[AvatarSlot] = Field(default_factory=list)
    compose_mode: Literal["single", "coframe", "sequential"] = "single"
    layout: Literal["side", "pip", "main_minor"] = "side"
    subtitle_enabled: bool = True
    subtitle_position: Literal["top", "bottom", "center", "custom"] = "bottom"
    font_name: str = "STHeitiMedium.ttc"
    font_size: int = 60
    text_fore_color: str = "#FFFFFF"
    text_background_color: Union[bool, str] = True
    stroke_color: str = "#000000"
    stroke_width: float = 1.5
    video_width: int = 720    # 画布尺寸(竖屏默认);生成沿用,前端可选常用比例
    video_height: int = 1280

    @model_validator(mode="after")
    def _sync_avatars(self) -> "DigitalHumanPreset":
        # 旧行(无 avatars)→ 用 avatar_ref 回填;有 avatars → 首槽镜像回旧字段,
        # 保证 jobs 单形象路径(读 preset.avatar_ref)对老/新数据都成立。
        if not self.avatars and self.avatar_ref:
            self.avatars = [AvatarSlot(ref=self.avatar_ref, kind=self.avatar_kind)]
        if self.avatars:
            self.avatar_ref = self.avatars[0].ref
            self.avatar_kind = self.avatars[0].kind
        return self


class DhGenerateRequest(BaseModel):
    preset_id: str
    text: str = Field(min_length=1, max_length=5000)
    # 以下 P1 不消费,占位以便 P2/P3 前向兼容:
    product_image: Optional[str] = None
    template: DhTemplate = "none"
    matte: bool = False
    engine: DhEngine = "wav2lip"
    script: Optional[str] = None
    role_scripts: Optional[List[str]] = None


class DhTaskStatus(BaseModel):
    task_id: str
    state: DhState
    progress: int = 0
    error: str = ""
    result_path: str = ""
    script: str = ""          # 生成所用文案(供"送到时间轴"派生字幕 cue)
