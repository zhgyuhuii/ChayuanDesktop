"""数字人 P1 数据契约。"""
from __future__ import annotations
from typing import Any, Dict, List, Literal, Optional, Union
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
    persona: str = ""        # 该角色人设/语气(多角色生成时注入 prompt)
    voice_rate: float = 1.0
    voice_volume: float = 1.0
    language: str = ""
    x: float = 0.0
    y: float = 0.0
    scale: float = 1.0
    z: Optional[int] = None   # 图层叠放顺序(大=靠前);None=按数组序


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
    # 绑定模型 + 知识库(P1);旧 presets.json 行无这些字段 → 默认值向后兼容
    model: str = ""
    ku_ids: List[str] = Field(default_factory=list)
    allow_model_override: bool = True
    allow_kb_override: bool = True
    # 商品图/视频(工作台画布可拖拽);product_ref 空=无商品图。
    # 坐标默认对齐 corner template,无坐标的老 preset 行为不变。
    product_ref: str = ""
    product_kind: Literal["image", "video"] = "image"
    product_x: float = 0.66
    product_y: float = 0.60
    product_scale: float = 0.32
    product_z: Optional[int] = None   # 商品层叠放顺序(同 AvatarSlot.z);None=排在角色之上

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
    text: str = Field(default="", max_length=5000)
    # 以下 P1 不消费,占位以便 P2/P3 前向兼容:
    product_image: Optional[str] = None
    template: DhTemplate = "none"
    matte: bool = False
    engine: DhEngine = "wav2lip"
    script: Optional[str] = None              # single 用
    role_scripts: Optional[List[str]] = None  # coframe 用:每角色一串,plan 按句轮流交织
    role_segments: Optional[List[Dict[str, Any]]] = None  # sequential 用:有序 [{role_index,text}]
    script_model: str = ""    # 生成文稿用的对话模型(列表视图显示;手输=空)


class DhTaskStatus(BaseModel):
    task_id: str
    state: DhState
    progress: int = 0
    error: str = ""
    result_path: str = ""
    script: str = ""          # 生成所用文案(供"送到时间轴"派生字幕 cue)
    script_model: str = ""    # 生成文稿用的对话模型(空=手输/未知)
    engine: str = ""          # 画质引擎(wav2lip/sadtalker/musetalk)
    created_at: float = 0.0   # 任务提交时间戳(列表视图显示)
    # 多形象各段元数据(coframe/sequential 才填;single 为 []),供模式相关多轨建轨:
    # [{"role_index": int, "path": str, "text": str, "duration_ms": int}]
    segments: List[Dict[str, Any]] = Field(default_factory=list)


class PublishedAvatar(BaseModel):
    """在线数字人发布记录:发布时对 preset 的配置快照 + 公开 token + owner 控制位。

    用快照(而非引用 preset)的原因:源 preset 之后被改/删不应弄坏已发布的公开页;
    重新发布(同 preset_id)覆盖快照。
    """
    token: str                       # 公开 URL 段(secrets.token_urlsafe)
    preset_id: str = ""              # 来源 preset(重新发布按此覆盖)
    owner_id: str = ""               # 发布者(列表过滤 + 公开对话记其额度)
    created: float = 0.0
    # ---- 配置快照 ----
    name: str = ""
    avatar_ref: str = ""
    avatar_kind: AvatarKind = "image"
    video_width: int = 720
    video_height: int = 1280
    model: str = ""
    ku_ids: List[str] = Field(default_factory=list)
    persona: str = ""                # 人设/系统提示(公开对话注入 metadata.system)
    voice_provider: str = "piper"
    voice_name: str = ""
    # ---- owner 控制 ----
    enabled: bool = True             # 上线开关;False=公开页显示「已下线」
    chat_enabled: bool = True        # 允许公开对话;False=公开页纯观看
    rate_per_min: int = 10           # 每访客 IP 每分钟消息上限
    daily_cap: int = 500             # 该 token 每日消息总上限
