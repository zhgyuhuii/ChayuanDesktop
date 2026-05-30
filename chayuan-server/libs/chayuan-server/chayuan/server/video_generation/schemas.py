"""视频生成模块 Pydantic v2 模型。

迁移自 chayuan-video-generation/app/models/schema.py(MoneyPrinterTurbo
上游),做了三处改造:

1. 扩展 ``script_source`` 三模式(ai/manual/srt)+ ``srt_cues`` 字段,
   支持"AI 生成 / 用户手写 / 粘贴 SRT"三条 wizard 分支。

2. 删除所有 ``BaseResponse / TaskResponse / ...Response`` 类。chayuan-
   server 走统一响应封装(status/message/data 由 ApiResponse 中间件包),
   路由层直接返 dict / pydantic 模型即可。

3. 删除依赖 ``app.config`` 的 ui 默认值(``subtitle_position`` /
   ``custom_position``),改为类常量 — chayuan-server 没有 ui 子配置,
   且默认值固化更利于 OpenAPI schema 稳定。
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

import pydantic
from pydantic import BaseModel, Field


# ─────────────────────────────────────────────────────────────────────
# 枚举
# ─────────────────────────────────────────────────────────────────────


class VideoConcatMode(str, Enum):
    """素材拼接顺序。"""

    random = "random"
    sequential = "sequential"


class VideoTransitionMode(str, Enum):
    """素材片段间过渡效果。``none`` 用空字符串表示便于 JSON 序列化。"""

    none = ""
    shuffle = "Shuffle"
    fade_in = "FadeIn"
    fade_out = "FadeOut"
    slide_in = "SlideIn"
    slide_out = "SlideOut"


class VideoAspect(str, Enum):
    """画幅。值即标准纵横比字符串便于前端直接展示。"""

    landscape = "16:9"
    portrait = "9:16"
    square = "1:1"

    def to_resolution(self) -> tuple[int, int]:
        """统一输出 1080p 等价分辨率(宽, 高)。"""

        if self.value == "16:9":
            return 1920, 1080
        if self.value == "9:16":
            return 1080, 1920
        if self.value == "1:1":
            return 1080, 1080
        return 1080, 1920


def resolve_resolution(aspect, width=None, height=None) -> tuple[int, int]:
    """成片分辨率:显式 width/height(都 >0)优先,否则回落到 aspect 枚举。

    显式像素做偶数化(H.264/x264 要求宽高为偶),并夹到合理范围,避免前端传非法值。
    """
    try:
        w = int(width or 0)
        h = int(height or 0)
    except (TypeError, ValueError):
        w = h = 0
    if w > 0 and h > 0:
        w = max(16, min(7680, w)) // 2 * 2
        h = max(16, min(7680, h)) // 2 * 2
        return w, h
    return VideoAspect(aspect).to_resolution()


class ScriptSource(str, Enum):
    """脚本来源 — 决定 wizard 走哪条分支。

    - ai:  调本项目 LLM gateway 生成,默认 chat capability 模型
    - manual: 用户在 ScriptStep 手写/粘贴纯文本
    - srt: 用户粘贴/上传 SRT/VTT,字幕时间已固化,TTS 走精准节奏模式
    """

    ai = "ai"
    manual = "manual"
    srt = "srt"


# ─────────────────────────────────────────────────────────────────────
# 数据载体
# ─────────────────────────────────────────────────────────────────────


class _Config:
    arbitrary_types_allowed = True


@pydantic.dataclasses.dataclass(config=_Config)
class MaterialInfo:
    """单个视频素材引用(在线 url 或本地 path)。"""

    provider: str = "pexels"
    url: str = ""
    duration: int = 0
    image: str = ""  # 预览缩略图 URL(pexels v["image"] / pixabay vimeo 缩略图)


class SrtCue(BaseModel):
    """SRT 单行(用户粘贴字幕模式 + 字幕编辑器都用这个结构)。

    start_ms/end_ms 用毫秒整数避免浮点精度问题,前端编辑时直接 slider 调。
    index 是 SRT 行号(1-based),保留方便用户跟原 SRT 对照。
    """

    index: int = Field(..., ge=1)
    start_ms: int = Field(..., ge=0)
    end_ms: int = Field(..., ge=0)
    text: str = ""


class TimelineClip(BaseModel):
    """时间轴上的一段素材引用(EDL clip)。"""
    id: str
    # source 三选一:material_id(库)/ path(本地)/ url(在线),按此优先级解析
    source: Dict[str, str] = Field(default_factory=dict)
    track_start_ms: int = Field(default=0, ge=0)   # 在轨道上的起点
    in_ms: int = Field(default=0, ge=0)             # 源素材裁剪入点
    out_ms: int = Field(default=0, ge=0)            # 源素材裁剪出点(0 表示到素材末尾)
    transition: str = "none"                        # none/fade/slide(P4)
    volume: float = 1.0                             # 音频轨用
    # 画中画(P5c-2):0-1 归一坐标/缩放 + 层级。主轨 clip 不填 = 铺满底层。
    x: float = 0.0
    y: float = 0.0
    scale: float = 1.0
    z: int = 0


class TimelineTrack(BaseModel):
    id: str
    kind: str = "video"                             # video / audio / subtitle
    clips: List[TimelineClip] = Field(default_factory=list)
    cues: List[SrtCue] = Field(default_factory=list)  # subtitle 轨复用 SrtCue
    removable: bool = False                          # 用户添加的轨可删;默认轨 False(P5c-2)
    label: str = ""


class Timeline(BaseModel):
    """用户编辑的剪辑决策表(EDL)。runner 有它就精确照渲,否则走自动路径。"""
    version: int = 1
    duration_ms: int = Field(default=0, ge=0)
    tracks: List[TimelineTrack] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────
# 主请求模型 — Wizard 各步骤参数聚合
# ─────────────────────────────────────────────────────────────────────


class VideoParams(BaseModel):
    """视频生成全参数。前端 vgComposer store 跟这套字段一一对应。

    设计原则:
    - 所有字段都给合理默认,前端只覆盖用户改过的;路由层 model_dump
      (exclude_unset=True) 跟 runner 已存 task 参数 merge。
    - 三模式分支字段共存(只有对应模式那个字段才有意义),便于前端在 chip
      间切换时保留各 slot 状态。
    """

    # ── 选题(ScriptStep 上半 / TopicStep) ──────────────────────
    video_subject: str = ""  # ScriptSource.ai 时必填
    video_language: str = ""  # 空 → LLM 按主题自动判断

    # ── 内容来源 三选一 ────────────────────────────────────
    script_source: ScriptSource = ScriptSource.ai
    video_script: str = ""  # ai/manual 都用这个字段承载文案
    srt_cues: Optional[List[SrtCue]] = None  # 仅 srt 模式填
    paragraph_number: int = Field(default=1, ge=1, le=10)  # ai 模式分段数

    # ── 关键词(materials 步驱动 — ai 模式时由 LLM 算,其它模式按文本算) ──
    video_terms: Optional[Union[str, List[str]]] = None

    # 脚本/关键词 LLM 用哪个模型(跟随对话框选的 chat 模型;空则走默认能力路由)。
    # 格式与 chat 一致:`<platform>::<id>` 或裸 id。
    model: Optional[str] = None

    # 时间轴编辑器(EDL);非空时 runner 按它精确渲染,空则自动拟合(向后兼容)。
    timeline: Optional[Timeline] = None

    # ── 画幅 + 拼接 ──────────────────────────────────────
    video_aspect: VideoAspect = VideoAspect.portrait
    # 精确像素覆盖(都 >0 时优先于 video_aspect);支持电脑尺寸 / 自定义画幅。
    video_width: Optional[int] = Field(default=None, ge=16, le=7680)
    video_height: Optional[int] = Field(default=None, ge=16, le=7680)
    video_concat_mode: VideoConcatMode = VideoConcatMode.random
    video_transition_mode: VideoTransitionMode = VideoTransitionMode.none
    video_clip_duration: int = Field(default=5, ge=1, le=60)
    video_count: int = Field(default=1, ge=1, le=5)  # 同主题生成几份

    # ── 素材来源 ──────────────────────────────────────────
    video_source: Literal["local", "pexels", "pixabay"] = "local"
    video_materials: Optional[List[MaterialInfo]] = None

    # ── 用户自带音频(可选;有则跳过 TTS 步) ──────────────────────────
    custom_audio_file: Optional[str] = None

    # ── 语音(TTS) ─────────────────────────────────────────
    voice_name: str = ""  # 空 → 走 modality.audio 默认 piper 中文女声
    voice_volume: float = Field(default=1.0, ge=0.0, le=2.0)
    voice_rate: float = Field(default=1.0, ge=0.5, le=2.0)
    voice_provider: Literal["piper", "edge", "sherpa", "clone"] = "piper"  # M4 加 sherpa

    # ── BGM ─────────────────────────────────────────────
    bgm_type: Literal["none", "random", "file"] = "random"
    bgm_file: str = ""  # bgm_type=file 时使用
    bgm_volume: float = Field(default=0.2, ge=0.0, le=1.0)

    # ── 字幕样式 ─────────────────────────────────────────
    subtitle_enabled: bool = True
    subtitle_position: Literal["top", "bottom", "center", "custom"] = "bottom"
    custom_position: float = Field(default=70.0, ge=0.0, le=100.0)
    font_name: str = "STHeitiMedium.ttc"
    font_size: int = Field(default=60, ge=20, le=200)
    text_fore_color: str = "#FFFFFF"
    text_background_color: Union[bool, str] = True  # True=黑底, False=无, str=自定义
    stroke_color: str = "#000000"
    stroke_width: float = Field(default=1.5, ge=0.0, le=10.0)

    # ── 渲染参数 ─────────────────────────────────────────
    n_threads: int = Field(default=2, ge=1, le=16)


# ─────────────────────────────────────────────────────────────────────
# 子任务请求(仅生成字幕/仅生成音频)
# ─────────────────────────────────────────────────────────────────────


class SubtitleRequest(BaseModel):
    """仅生成字幕场景的精简参数(对应 wizard step 4 单跑预览)。"""

    video_script: str
    video_language: str = ""
    voice_name: str = ""
    voice_volume: float = 1.0
    voice_rate: float = 1.2
    voice_provider: Literal["piper", "edge", "sherpa", "clone"] = "piper"
    bgm_type: Literal["none", "random", "file"] = "random"
    bgm_file: str = ""
    bgm_volume: float = 0.2
    subtitle_position: Literal["top", "bottom", "center", "custom"] = "bottom"
    font_name: str = "STHeitiMedium.ttc"
    text_fore_color: str = "#FFFFFF"
    text_background_color: Union[bool, str] = True
    font_size: int = 60
    stroke_color: str = "#000000"
    stroke_width: float = 1.5
    video_source: Literal["local", "pexels", "pixabay"] = "local"
    subtitle_enabled: bool = True


class AudioRequest(BaseModel):
    """仅生成音频场景的精简参数(对应 wizard step 3 单跑预览/试听)。"""

    video_script: str
    video_language: str = ""
    voice_name: str = ""
    voice_volume: float = 1.0
    voice_rate: float = 1.2
    voice_provider: Literal["piper", "edge", "sherpa", "clone"] = "piper"
    bgm_type: Literal["none", "random", "file"] = "random"
    bgm_file: str = ""
    bgm_volume: float = 0.2
    video_source: Literal["local", "pexels", "pixabay"] = "local"


# ─────────────────────────────────────────────────────────────────────
# LLM 辅助接口(脚本/关键词独立调试用)
# ─────────────────────────────────────────────────────────────────────


class VideoScriptRequest(BaseModel):
    """LLM 生成脚本 — wizard step 2 ai 模式的流式 endpoint 入参。"""

    video_subject: str = "春天的花海"
    video_language: str = ""
    paragraph_number: int = Field(default=1, ge=1, le=10)


class VideoTermsRequest(BaseModel):
    """LLM 生成搜索关键词 — wizard step 5 在线素材搜索的入参。"""

    video_subject: str = "春天的花海"
    video_script: str = ""
    amount: int = Field(default=5, ge=1, le=30)


# ─────────────────────────────────────────────────────────────────────
# 任务状态(对接 store/tasks.py 持久化)
# ─────────────────────────────────────────────────────────────────────


class VgTaskState(str, Enum):
    """任务执行状态。"""

    pending = "pending"
    processing = "processing"
    complete = "complete"
    failed = "failed"
    canceled = "canceled"


class VgTask(BaseModel):
    """任务全字段视图(GET /tasks/{id} 返回)。"""

    task_id: str
    owner_id: Optional[str] = None
    state: VgTaskState = VgTaskState.pending
    progress: int = Field(default=0, ge=0, le=100)
    stop_at: Literal["script", "terms", "audio", "subtitle", "materials", "video"] = (
        "video"
    )
    params: VideoParams
    # 中间产物路径(成功步骤产出会写回)
    script: Optional[str] = None
    terms: Optional[List[str]] = None
    audio_file: Optional[str] = None
    subtitle_path: Optional[str] = None
    materials: Optional[List[str]] = None
    final_videos: Optional[List[str]] = None
    combined_videos: Optional[List[str]] = None
    error: Optional[str] = None
    created_at: Optional[int] = None  # epoch ms
    updated_at: Optional[int] = None


class VgMaterial(BaseModel):
    """素材库一条记录(在线下载 / 用户上传 / 内置 clips 都用这个 schema)。"""

    material_id: str
    owner_id: Optional[str] = None  # NULL = 内置/全局
    source: Literal["upload", "pexels", "pixabay", "bundled"] = "upload"
    name: str
    path: str  # 相对 chayuan_root 的素材文件路径
    mime: str = ""
    size: int = 0
    duration_ms: int = 0
    width: int = 0
    height: int = 0
    thumbnail_path: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    used_count: int = 0
    created_at: Optional[int] = None


class VgVideo(BaseModel):
    """成品视频索引(我的视频页用)。"""

    video_id: str
    task_id: str
    owner_id: Optional[str] = None
    title: str
    path: str  # 相对 chayuan_root 的成品 mp4
    duration_ms: int = 0
    width: int = 0
    height: int = 0
    thumbnail_path: Optional[str] = None
    params_snapshot: dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[int] = None
