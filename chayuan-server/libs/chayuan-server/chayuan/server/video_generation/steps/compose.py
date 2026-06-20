"""moviepy 视频合成核心(原 chayuan-video-generation/app/services/video.py)。

迁移自上游 MoneyPrinterTurbo 1.2.7,做了三处替换:

- ``from loguru import logger`` → ``logging.getLogger(name)``,与
  chayuan-server 其它模块日志风格统一(走 chayuan.api.* logger 树)。
- ``from app.models import const`` 等绝对 import → 模块相对 import
  ``from .. import const / _helpers / _video_effects``。
- ``app.utils.file_security`` / ``app.utils.utils`` 中视频合成会用到的
  小工具(路径校验、storage/font/song 目录、parse_extension)拷到
  ``_helpers.py``,避免污染 ``chayuan.server.utils`` 全局命名空间。

业务逻辑保持原样(combine_videos / generate_video / wrap_text / 
SubClippedVideoClip 等)。外部依赖 ImageMagick 由 binaries.py(M1.C9)
启动时探测 vendor/bundled_binaries/<platform>/imagemagick/ 注入。
"""
from __future__ import annotations

import glob
import itertools
import io
import os
import random
import gc
import shutil
import subprocess
import tempfile
from contextlib import redirect_stdout
from typing import List
import logging

logger = logging.getLogger("chayuan.video_generation.compose")
from moviepy import (
    AudioFileClip,
    ColorClip,
    CompositeAudioClip,
    CompositeVideoClip,
    ImageClip,
    TextClip,
    VideoFileClip,
    afx,
    vfx,
)
from moviepy.video.tools.subtitles import SubtitlesClip
from PIL import Image, ImageDraw, ImageFont

from .. import const
from ..schemas import (
    MaterialInfo,
    VideoAspect,
    VideoConcatMode,
    VideoParams,
    VideoTransitionMode,
    resolve_resolution,
)
from .. import _video_effects as video_effects
from .. import _helpers as utils
from .._helpers import resolve_path_within_directory as _resolve_path_within_directory

class SubClippedVideoClip:
    def __init__(self, file_path, start_time=None, end_time=None, width=None, height=None, duration=None):
        self.file_path = file_path
        self.start_time = start_time
        self.end_time = end_time
        self.width = width
        self.height = height
        if duration is None:
            self.duration = end_time - start_time
        else:
            self.duration = duration

    def __str__(self):
        return f"SubClippedVideoClip(file_path={self.file_path}, start_time={self.start_time}, end_time={self.end_time}, duration={self.duration}, width={self.width}, height={self.height})"


audio_codec = "aac"
# Docker 里的 ffmpeg/AAC 组合在默认配置下更容易出现音频质量波动，
# 这里显式抬高音频码率，避免成片阶段因为默认值过低而引入明显失真。
audio_bitrate = "192k"
video_codec = "libx264"
fps = 30
_BGM_EXTENSIONS = (".mp3",)

# x264 编码 preset:moviepy/ffmpeg 默认 medium,对长视频很慢。EDL 路径要把整片
# 重编码 3-4 次(分段→concat→PIP→最终),medium 下 5 分钟 1080x1920 会跑十几到
# 几十分钟。改 veryfast 通常快 4-5 倍,体积略大、画质几乎无感。env 可调
# (ultrafast 最快/最大,medium/slow 更小更慢)。
_X264_PRESET = (os.environ.get("CHAYUAN_VG_X264_PRESET", "veryfast") or "veryfast").strip()

# CompositeAudioClip 里「比合成总时长短」的音频层会被 moviepy 2.x 读到超出自身末尾
# (write 时按 chunk 读 → 对每层 get_frame 整段 tt 再按 is_playing 掩码,掩码外的
#  帧仍被读),AudioFileClip 读越界直接抛 IOError(Accessing time t=.. clip duration=..),
# 整个合成失败。给每个文件型音频层尾部削掉一点(默认 120ms),让它在内容真正结束前
# 就被判 not-playing,避免越界读。削掉的是听感无关的尾音。env 可调。
try:
    _AUDIO_TAIL_TRIM_S = max(0.0, float(os.environ.get("CHAYUAN_VG_AUDIO_TAIL_TRIM_S", "0.12") or 0.12))
except (TypeError, ValueError):
    _AUDIO_TAIL_TRIM_S = 0.12


def _trim_audio_tail(ac, eps: float = _AUDIO_TAIL_TRIM_S):  # noqa: ANN001
    """文件型音频层尾部削 eps 秒,规避 moviepy 2.x 越界读 IOError。短到没法削就原样返回。

    注:这只是第一道防线。moviepy 2.x 在 CompositeAudioClip 里会对**整段 chunk**
    调 get_frame 再按 is_playing 掩码,掩码外的帧仍被读 → 削 clip 时长挡不住对
    底层文件的越界读。真正兜底靠 _patch_moviepy_audio_reader_overread()。
    """
    if eps <= 0:
        return ac
    try:
        d = float(getattr(ac, "duration", 0) or 0)
        if d > eps * 2:
            return ac.subclipped(0, d - eps)
    except Exception:  # noqa: BLE001
        pass
    return ac


_MOVIEPY_AUDIO_READER_PATCHED = False


def _patch_moviepy_audio_reader_overread() -> None:
    """给 moviepy FFMPEG_AudioReader.get_frame 打补丁:读越界(浮点/chunk 边界
    over-read,如 t=27.80 > 文件 27.78)不再抛 IOError 崩掉整片合成,而是把越界
    时间钳回有效范围;仍失败则返回静音。幂等 + 只 patch 一次。

    根因:CompositeAudioClip 里短于合成总长的音频层(EDL 片段内嵌音频),write
    时 moviepy 对每层整段 tt 调 get_frame 再按 is_playing 掩码 —— 掩码外的越界帧
    仍被读 → AudioFileClip 读越界直接 raise。用户实测任务 75% compose 必崩主因。
    """
    global _MOVIEPY_AUDIO_READER_PATCHED
    if _MOVIEPY_AUDIO_READER_PATCHED:
        return
    try:
        import numpy as _np
        from moviepy.audio.io.readers import FFMPEG_AudioReader  # type: ignore
    except Exception as e:  # noqa: BLE001
        logger.warning("[compose] moviepy 音频读补丁未生效(import 失败): %r", e)
        _MOVIEPY_AUDIO_READER_PATCHED = True  # 不重复尝试
        return
    if getattr(FFMPEG_AudioReader, "_chayuan_overread_patched", False):
        _MOVIEPY_AUDIO_READER_PATCHED = True
        return
    _orig_get_frame = FFMPEG_AudioReader.get_frame

    def _safe_get_frame(self, tt):  # noqa: ANN001
        try:
            return _orig_get_frame(self, tt)
        except (IOError, OSError):
            try:
                dur = float(getattr(self, "duration", 0) or 0)
                fps = float(getattr(self, "fps", 0) or 44100) or 44100
                if dur > 0:
                    ttc = _np.minimum(_np.asarray(tt, dtype="float64"), dur - 1.5 / fps)
                    ttc = _np.maximum(ttc, 0.0)
                    return _orig_get_frame(self, ttc)
            except Exception:  # noqa: BLE001
                pass
            # 兜底返回静音,绝不让单层越界读崩掉整片
            arr = _np.asarray(tt)
            n = arr.shape[0] if getattr(arr, "ndim", 0) else 1
            nch = int(getattr(self, "nchannels", 2) or 2)
            return _np.zeros((n, nch), dtype="float64")

    FFMPEG_AudioReader.get_frame = _safe_get_frame
    FFMPEG_AudioReader._chayuan_overread_patched = True
    _MOVIEPY_AUDIO_READER_PATCHED = True
    logger.info("[compose] 已给 moviepy FFMPEG_AudioReader.get_frame 打越界读补丁")


# 模块加载即打补丁 —— 覆盖 EDL 分段 / PIP / 最终合成所有 write_videofile(都可能越界读)
_patch_moviepy_audio_reader_overread()


def get_ffmpeg_binary():
    # 优先复用用户在 config.toml / 环境变量里显式指定的 ffmpeg，可避免
    # Windows 便携包、Docker、自定义安装目录等场景下 PATH 不一致。
    configured_ffmpeg = os.environ.get("IMAGEIO_FFMPEG_EXE")
    if configured_ffmpeg:
        return configured_ffmpeg

    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return system_ffmpeg

    try:
        import imageio_ffmpeg

        bundled_ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        if bundled_ffmpeg:
            return bundled_ffmpeg
    except Exception as exc:
        logger.warning(f"failed to resolve bundled ffmpeg binary: {str(exc)}")

    return "ffmpeg"


def _escape_ffmpeg_concat_path(file_path: str) -> str:
    # concat demuxer 使用单引号包裹路径，路径中的单引号需要先转义。
    return file_path.replace("'", "'\\''")


def concat_video_clips_with_ffmpeg(
    clip_files: List[str], output_file: str, threads: int, output_dir: str
):
    concat_list_file = os.path.join(output_dir, "ffmpeg-concat-list.txt")
    with open(concat_list_file, "w", encoding="utf-8") as fp:
        for clip_file in clip_files:
            absolute_path = os.path.abspath(clip_file)
            fp.write(f"file '{_escape_ffmpeg_concat_path(absolute_path)}'\n")

    command = [
        get_ffmpeg_binary(),
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concat_list_file,
        "-c:v",
        video_codec,
        "-preset",
        _X264_PRESET,
        "-crf",
        "23",
        "-threads",
        str(threads or 2),
        "-pix_fmt",
        "yuv420p",
        output_file,
    ]

    try:
        # 使用 ffmpeg 只做一次串联与编码，避免 MoviePy 逐段合并时反复重编码，
        # 从而降低画质劣化与颜色偏移风险。
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            error_message = (result.stderr or result.stdout or "").strip()
            raise RuntimeError(error_message or "ffmpeg concat failed")
    finally:
        delete_files(concat_list_file)


def _sanitize_image_file(image_path: str) -> str:
    # 某些本地图片虽然能被 Pillow 打开，但会因为损坏的 EXIF/eXIf 元数据导致
    # ImageClip 在解析阶段直接抛异常。这里重新导出一份“干净图片”，把坏元数据剥离掉。
    image_root, _ = os.path.splitext(image_path)
    sanitized_path = f"{image_root}.sanitized.png"

    with Image.open(image_path) as image:
        image.load()
        # 统一导出为 PNG，避免 JPEG/PNG 不同元数据路径继续把坏块带过去。
        cleaned_image = Image.new(image.mode, image.size)
        cleaned_image.putdata(list(image.getdata()))
        cleaned_image.save(sanitized_path)

    return sanitized_path


def _open_image_clip_with_fallback(image_path: str):
    # 优先直接打开原始图片；如果因为损坏元数据失败，再尝试生成无元数据副本。
    try:
        return ImageClip(image_path), image_path
    except Exception as exc:
        logger.warning(
            f"failed to open image directly, trying sanitized copy: {image_path}, error: {str(exc)}"
        )
        sanitized_path = _sanitize_image_file(image_path)
        return ImageClip(sanitized_path), sanitized_path


_IMAGE_MATERIAL_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff")


def _open_video_clip_quietly(video_path: str, audio: bool = False, image_duration: float = 5.0):
    """
    安静地打开视频文件，避免 MoviePy 2.1.x 把 ffmpeg 探测信息直接打印到 stdout。

    背景：
    当前依赖版本的 `FFMPEG_VideoReader` 内部存在 `print(self.infos)` 和
    `print(ffmpeg command)`，读取无音轨的中间视频时会输出
    `audio_found: False`。这只是输入素材 metadata，不代表最终成片没有音频，
    但会误导 WebUI/终端用户以为生成失败。

    实现：
    1. 只在打开 VideoFileClip 的短窗口内重定向 stdout；
    2. 默认 `audio=False`，因为项目视频素材阶段不需要保留素材原声，
       最终音频会在 `generate_video()` 阶段统一挂载；
    3. 如果依赖库确实输出了内容，降级为 debug 日志，便于必要时排查。
    """
    # 静态图片素材(png/jpg…):moviepy 用 VideoFileClip 打开会因 ffmpeg "Duration: N/A"
    # → parse_duration 正则 None.group() 崩(OSError: failed to read the duration of file)。
    # 改用 ImageClip + 固定时长,当作一段静帧视频;下游 subclipped/resized/size 均兼容。
    if os.path.splitext(video_path)[1].lower() in _IMAGE_MATERIAL_EXTS:
        return ImageClip(video_path).with_duration(max(0.1, float(image_duration)))

    captured_stdout = io.StringIO()
    with redirect_stdout(captured_stdout):
        clip = VideoFileClip(video_path, audio=audio)

    moviepy_stdout = captured_stdout.getvalue().strip()
    if moviepy_stdout:
        logger.debug(
            "suppressed MoviePy video reader stdout for "
            f"{video_path}, chars: {len(moviepy_stdout)}"
        )

    return clip


def close_clip(clip):
    if clip is None:
        return
        
    try:
        # close main resources
        if hasattr(clip, 'reader') and clip.reader is not None:
            clip.reader.close()
            
        # close audio resources
        if hasattr(clip, 'audio') and clip.audio is not None:
            if hasattr(clip.audio, 'reader') and clip.audio.reader is not None:
                clip.audio.reader.close()
            del clip.audio
            
        # close mask resources
        if hasattr(clip, 'mask') and clip.mask is not None:
            if hasattr(clip.mask, 'reader') and clip.mask.reader is not None:
                clip.mask.reader.close()
            del clip.mask
            
        # handle child clips in composite clips
        if hasattr(clip, 'clips') and clip.clips:
            for child_clip in clip.clips:
                if child_clip is not clip:  # avoid possible circular references
                    close_clip(child_clip)
            
        # clear clip list
        if hasattr(clip, 'clips'):
            clip.clips = []
            
    except Exception as e:
        logger.error(f"failed to close clip: {str(e)}")
    
    del clip
    gc.collect()

def delete_files(files: List[str] | str):
    if isinstance(files, str):
        files = [files]

    for file in files:
        try:
            os.remove(file)
        except Exception as e:
            logger.debug(f"failed to delete file {file}: {str(e)}")

def _bgm_search_dirs() -> list:
    """BGM 候选目录:vendor 内置(binaries.get_bgm_dir)+ 用户上传(song_dir)。

    之前只看 song_dir → 入仓的 29 首内置 BGM(在 vendor/bundled_bgm)永远扫不到,
    random/指定都拿不到文件 → BGM 没合成进视频。这里把两处都纳入。
    """
    dirs: list = []
    try:
        from chayuan.server.video_generation import binaries
        bundled = binaries.get_bgm_dir()
        if bundled and os.path.isdir(bundled):
            dirs.append(bundled)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"resolve bundled bgm dir failed: {e}")
    try:
        sd = utils.song_dir()
        if sd and os.path.isdir(sd):
            dirs.append(sd)
    except Exception:  # noqa: BLE001
        pass
    return dirs


def get_bgm_file(bgm_type: str = "random", bgm_file: str = ""):
    if not bgm_type:
        return ""

    search_dirs = _bgm_search_dirs()

    if bgm_file:
        # bgm_file 可能是 list_bgm 给的内置/上传绝对路径,或裸文件名。安全:
        # 只接受 real-path 落在某个允许目录内、扩展名合法、文件存在的。
        base = os.path.basename(bgm_file)
        candidates = [bgm_file] if os.path.isabs(bgm_file) else []
        candidates += [os.path.join(d, base) for d in search_dirs]
        for d in search_dirs:
            for cand in candidates:
                try:
                    resolved = _resolve_path_within_directory(d, cand)
                except ValueError:
                    continue
                if resolved.lower().endswith(_BGM_EXTENSIONS) and os.path.isfile(resolved):
                    return resolved
        logger.warning(f"reject/notfound bgm file: {bgm_file}, dirs: {search_dirs}")
        return ""

    if bgm_type == "random":
        files: list = []
        for d in search_dirs:
            files += glob.glob(os.path.join(d, "*.mp3"))
        # 目录为空时回退“不使用 BGM”,避免 random.choice([]) 抛异常。
        if not files:
            logger.warning(f"no bgm files found in {search_dirs}")
            return ""
        return random.choice(files)

    return ""


def _build_edl_render_plan(timeline, video_aspect, *, source_resolver, width=None, height=None):
    """把 EDL 的 video 轨解析成有序渲染计划(纯函数,便于单测)。

    返回 list[dict]:{clip_id, path, start_s, end_s(None=到末尾), target_w, target_h}。
    - 取第一条 kind=='video' 的轨(P1 单视频轨)。
    - 按 track_start_ms 升序。
    - source 经 source_resolver(material_id/path/url -> 本地路径);解析空则跳过。
    - in_ms/out_ms -> 秒;out_ms==0 视为"到素材末尾"(end_s=None)。
    """
    target_w, target_h = resolve_resolution(video_aspect, width, height)
    video_tracks = [t for t in (timeline.tracks or []) if t.kind == "video"]
    if not video_tracks:
        return []
    clips = sorted(video_tracks[0].clips, key=lambda c: c.track_start_ms)
    plan = []
    for c in clips:
        path = (source_resolver(c.source) or "").strip()
        if not path:
            logger.warning("[edl] clip %s source 解析为空,跳过: %r", c.id, c.source)
            continue
        is_image = path.lower().rsplit(".", 1)[-1] in ("jpg", "jpeg", "png", "webp", "bmp", "gif")
        if is_image:
            # 图像无"素材末尾",out_ms>0 用其作时长,否则默认 3s
            end_s = (c.out_ms / 1000.0) if c.out_ms and c.out_ms > 0 else 3.0
        else:
            end_s = (c.out_ms / 1000.0) if c.out_ms and c.out_ms > c.in_ms else None
        plan.append({
            "clip_id": c.id,
            "path": path,
            "start_s": max(0.0, c.in_ms / 1000.0),
            "end_s": end_s,
            "is_image": is_image,
            "target_w": target_w,
            "target_h": target_h,
            "transition": (getattr(c, "transition", "none") or "none"),
            "rotation": float(getattr(c, "rotation", 0.0) or 0.0),
            "flip_h": bool(getattr(c, "flip_h", False)),
            "flip_v": bool(getattr(c, "flip_v", False)),
            "crop": (c.crop.model_dump() if getattr(c, "crop", None) else None),
            "opacity": float(getattr(c, "opacity", 1.0) or 1.0),
            "x": float(getattr(c, "x", 0.0) or 0.0),
            "y": float(getattr(c, "y", 0.0) or 0.0),
            "scale": float(getattr(c, "scale", 1.0) or 1.0),
            "speed": float(getattr(c, "speed", 1.0) or 1.0),
            "color": (c.color.model_dump() if getattr(c, "color", None) else None),
        })
    return plan


def _apply_transition(clip, transition: str):
    """逐片段转场:作用于本片段入场(上一片段→本片段切点)。none 原样返回。
    映射前端值(fade/slide_left|right|top|bottom/shuffle)到 _video_effects。"""
    t = (transition or "none").lower()
    if t in ("none", ""):
        return clip
    try:
        if t == "fade":
            return video_effects.fadein_transition(clip, 1)
        if t.startswith("slide_"):
            return video_effects.slidein_transition(clip, 1, t.split("_", 1)[1])
        if t == "shuffle":
            side = random.choice(["left", "right", "top", "bottom"])
            fn = random.choice([
                lambda c: video_effects.fadein_transition(c, 1),
                lambda c: video_effects.slidein_transition(c, 1, side),
            ])
            return fn(clip)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[edl] 转场 %s 应用失败,跳过: %s", t, exc)
    return clip


def _build_pip_layers(timeline, *, source_resolver) -> list:
    """第 2+ 条 video 轨的 clips → PIP 层 [{path,x,y,scale,z,start_s,dur,is_image}]。

    层级 = 轨道顺序:轨道列表里越靠前(索引小)= 越上层(遮盖靠后),与前端实时画布
    一致。返回顺序已排好,供 CompositeVideoClip([base, *overlays]) 直接叠(列表越靠后越上层),
    所以靠前的 PIP 轨排在列表末尾。
    """
    video_tracks = [t for t in (timeline.tracks or []) if t.kind == "video"]
    layers: list = []
    for ti, tr in enumerate(video_tracks[1:]):  # 跳过主轨;ti=0 为第一条 PIP 轨
        for c in tr.clips:
            path = (source_resolver(c.source) or "").strip()
            if not path:
                logger.warning("[pip] clip %s 解析为空,跳过: %r", c.id, c.source)
                continue
            is_image = path.lower().rsplit(".", 1)[-1] in ("jpg", "jpeg", "png", "webp", "bmp", "gif")
            dur = (c.out_ms / 1000.0) if (c.out_ms and c.out_ms > 0) else (3.0 if is_image else None)
            layers.append({
                "path": path,
                "x": float(getattr(c, "x", 0.0) or 0.0),
                "y": float(getattr(c, "y", 0.0) or 0.0),
                "scale": float(getattr(c, "scale", 0.4) or 0.4),
                "speed": float(getattr(c, "speed", 1.0) or 1.0),
                "z": ti,  # 轨道索引派生:小 = 上层
                "start_s": max(0.0, c.track_start_ms / 1000.0),
                "dur": dur,
                "is_image": is_image,
                "transition": (getattr(c, "transition", "none") or "none"),
                "opacity": float(getattr(c, "opacity", 1.0) or 1.0),
                "rotation": float(getattr(c, "rotation", 0.0) or 0.0),
                "flip_h": bool(getattr(c, "flip_h", False)),
                "flip_v": bool(getattr(c, "flip_v", False)),
                "crop": (c.crop.model_dump() if getattr(c, "crop", None) else None),
                "color": (c.color.model_dump() if getattr(c, "color", None) else None),
            })
    # ti 小的(上层)要排到列表末尾 → 降序
    layers.sort(key=lambda ly: ly["z"], reverse=True)
    return layers


def _speed_scaled(clip, sp):
    """变速(P3):自然变速(原声跟着变调)。1 或异常返回原 clip。"""
    sp = float(sp or 1.0)
    if abs(sp - 1) < 0.001:
        return clip
    try:
        return clip.with_speed_scaled(sp)
    except Exception:  # noqa: BLE001
        try:
            return clip.with_effects([vfx.MultiplySpeed(sp)])
        except Exception:  # noqa: BLE001
            return clip


def _apply_color(clip, color):
    """调色(P4):亮度*b → 对比度(x-128)*c+128 → 饱和度灰度混合。全 1 或无则跳过。"""
    if not color:
        return clip
    b = float(color.get("brightness", 1.0) or 1.0)
    c = float(color.get("contrast", 1.0) or 1.0)
    s = float(color.get("saturation", 1.0) or 1.0)
    if abs(b - 1) < 0.001 and abs(c - 1) < 0.001 and abs(s - 1) < 0.001:
        return clip
    import numpy as np

    def _fn(frame):
        f = frame.astype("float32")
        if abs(b - 1) >= 0.001:
            f = f * b
        if abs(c - 1) >= 0.001:
            f = (f - 128.0) * c + 128.0
        if abs(s - 1) >= 0.001 and f.ndim == 3 and f.shape[2] >= 3:
            gray = (f[..., 0] * 0.299 + f[..., 1] * 0.587 + f[..., 2] * 0.114)[..., None]
            f = gray + (f - gray) * s
        return np.clip(f, 0, 255).astype("uint8")

    try:
        return clip.image_transform(_fn)
    except Exception:  # noqa: BLE001
        return clip


def _apply_pip_geometry(clip, ly):
    """对 PIP clip 按固定顺序应用 crop -> flip -> rotate(在 resize/position 之前)。

    与前端预览(LivePreviewCanvas)同序:crop(clip-path)-> rotate/flip(transform)。
    crop 归一基准 = 源帧(clip.w/clip.h),与前端裁剪框一致。
    """
    crop = ly.get("crop")
    if crop:
        W, H = clip.w, clip.h
        x1, y1 = int(crop["x"] * W), int(crop["y"] * H)
        x2, y2 = int((crop["x"] + crop["w"]) * W), int((crop["y"] + crop["h"]) * H)
        if x2 > x1 and y2 > y1:
            try:
                clip = clip.cropped(x1=x1, y1=y1, x2=x2, y2=y2)
            except Exception:  # noqa: BLE001
                pass
    eff = []
    if ly.get("flip_h"):
        eff.append(vfx.MirrorX())
    if ly.get("flip_v"):
        eff.append(vfx.MirrorY())
    if eff:
        try:
            clip = clip.with_effects(eff)
        except Exception:  # noqa: BLE001
            pass
    rot = ly.get("rotation") or 0.0
    if abs(rot) > 0.01:
        try:
            clip = clip.rotated(rot)
        except Exception:  # noqa: BLE001
            pass
    clip = _apply_color(clip, ly.get("color"))
    return clip


def _bg_rgb(params) -> tuple:
    """params.background_color (#rrggbb) -> (r,g,b);缺失/非法回退黑。"""
    v = str(getattr(params, "background_color", "") or "").strip().lstrip("#")
    if len(v) == 6:
        try:
            return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16))
        except ValueError:
            pass
    return (0, 0, 0)


def _render_main_segment(clip, item, W, H, bg=(0, 0, 0)):
    """主轨单段:crop/flip/rotate 总应用;有自由变换(scale/位置/opacity)则合成黑底,否则 resize 填满(零回归)。"""
    clip = _apply_pip_geometry(clip, item)
    scale = float(item.get("scale", 1.0) or 1.0)
    x = float(item.get("x", 0.0) or 0.0)
    y = float(item.get("y", 0.0) or 0.0)
    op = float(item.get("opacity", 1.0) or 1.0)
    free = scale < 0.999 or abs(x) > 1e-3 or abs(y) > 1e-3 or op < 0.999
    if not free:
        return clip.resized(new_size=(W, H))
    inner = clip.resized(width=max(2, int(W * max(0.05, min(1.0, scale)))))
    inner = inner.with_position((int(x * W), int(y * H)))
    if op < 0.999 and hasattr(inner, "with_opacity"):
        try:
            inner = inner.with_opacity(op)
        except Exception:  # noqa: BLE001
            pass
    base = ColorClip(size=(W, H), color=bg).with_duration(clip.duration)
    return CompositeVideoClip([base, inner])


def _build_extra_audios(timeline, *, source_resolver) -> list:
    """抽 timeline 各轨音频 → [{path, start_s, volume, in_s?, out_s?}],解析为空的跳过。

    - audio 轨:插入音频 clip(整段)。
    - video 轨:**未静音(muted=False)的视频 clip 的内嵌音频**也混入(按 track_start 定位、
      按 in/out 裁剪、按 volume 调音量)。数字人各段的声音、上传视频的原声都靠这条进成片;
      静音的 clip 跳过;无音轨的素材在 generate_video 里 AudioFileClip 失败被静默跳过。
    """
    out: list = []
    for tr in (timeline.tracks or []):
        if tr.kind == "audio":
            for c in tr.clips:
                path = (source_resolver(c.source) or "").strip()
                if not path:
                    logger.warning("[edl] 插入音频 clip %s 解析为空,跳过: %r", c.id, c.source)
                    continue
                out.append({"path": path, "start_s": max(0.0, c.track_start_ms / 1000.0),
                            "volume": float(getattr(c, "volume", None) or 1.0)})
        elif tr.kind == "video":
            for c in tr.clips:
                if bool(getattr(c, "muted", False)):
                    continue
                path = (source_resolver(c.source) or "").strip()
                if not path:
                    continue
                _out = (c.out_ms / 1000.0) if (c.out_ms and c.out_ms > 0) else None
                out.append({"path": path, "start_s": max(0.0, c.track_start_ms / 1000.0),
                            "volume": float(getattr(c, "volume", None) or 1.0),
                            "in_s": max(0.0, (c.in_ms or 0) / 1000.0), "out_s": _out})
    return out


def _timeline_audio_end_s(timeline) -> float:
    """插入音频轨最右 clip 的结束秒(track_start + 时长);无则 0。"""
    end = 0.0
    for tr in (timeline.tracks or []):
        if tr.kind != "audio":
            continue
        for c in tr.clips:
            # 后端 TimelineClip 只有 out_ms(整段=0 时长未知,不计入延伸);
            # 前端 appendAudioClip 已把 out_ms 设为素材时长。
            dur = c.out_ms if (c.out_ms and c.out_ms > 0) else 0
            end = max(end, (c.track_start_ms + dur) / 1000.0)
    return end


def _timeline_video_end_s(timeline) -> float:
    """所有视频轨(含 PIP)最右 clip 的结束秒(track_start + out_ms);out_ms=0(整段)不计入。"""
    end = 0.0
    for tr in (timeline.tracks or []):
        if tr.kind != "video":
            continue
        for c in tr.clips:
            dur = c.out_ms if (c.out_ms and c.out_ms > 0) else 0
            end = max(end, (c.track_start_ms + dur) / 1000.0)
    return end


def cues_to_srt(cues: list) -> str:
    """[{startMs,endMs,text}] -> SRT 文本(编辑后字幕回传 compose 用)。"""
    def _ts(ms) -> str:
        ms = max(0, int(ms or 0))
        h, ms = divmod(ms, 3600000)
        m, ms = divmod(ms, 60000)
        s, ms = divmod(ms, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    lines = []
    for i, c in enumerate(cues, 1):
        lines.append(str(i))
        lines.append(f"{_ts(c.get('startMs', 0))} --> {_ts(c.get('endMs', 0))}")
        lines.append(str(c.get("text", "")).strip())
        lines.append("")
    return "\n".join(lines)


def render_from_edl(
    timeline,
    audio_file: str,
    subtitle_path: str,
    output_file: str,
    params,
    *,
    source_resolver,
    threads: int = 2,
) -> str:
    """按 EDL 渲染:裁剪每段 -> 规整到画幅 -> ffmpeg concat -> 叠音频+字幕。

    时长策略:总长 > 音频 -> generate_video 用音频长截断(沿用现有);
    < 音频 -> 末段定格补足到音频长。
    """
    video_width, video_height = resolve_resolution(
        params.video_aspect, getattr(params, "video_width", None), getattr(params, "video_height", None)
    )
    output_dir = os.path.dirname(output_file)

    plan = _build_edl_render_plan(
        timeline, params.video_aspect, source_resolver=source_resolver,
        width=getattr(params, "video_width", None), height=getattr(params, "video_height", None),
    )
    if not plan:
        raise RuntimeError("EDL 没有可渲染的视频片段(video 轨为空或素材解析失败)")

    # 无旁白合成(纯素材/音乐):audio_file 为空 → 时长由视频/音频轨决定
    audio_duration = 0.0
    if audio_file and os.path.exists(audio_file):
        audio_clip = AudioFileClip(audio_file)
        try:
            audio_duration = audio_clip.duration
        finally:
            close_clip(audio_clip)

    clip_files: list[str] = []
    total = 0.0
    for i, p in enumerate(plan):
        if p.get("is_image"):
            dur = p["end_s"] if p["end_s"] is not None else 3.0
            seg_path = os.path.join(output_dir, f"edl-seg-{i}.mp4")
            try:
                img = _render_main_segment(ImageClip(p["path"]).with_duration(dur), p, video_width, video_height, _bg_rgb(params))
                if i > 0:
                    img = _apply_transition(img, p.get("transition", "none"))
                img.write_videofile(seg_path, logger=None, fps=fps, codec=video_codec, preset=_X264_PRESET)
                close_clip(img)
                clip_files.append(seg_path)
                total += dur
            except Exception as exc:  # noqa: BLE001
                logger.warning("[edl] 图像 clip 渲染失败,跳过 %s: %s", p["path"], exc)
            continue
        clip = _open_video_clip_quietly(p["path"])
        try:
            src_dur = clip.duration
            start_s = min(p["start_s"], max(0.0, src_dur - 0.1))
            end_s = p["end_s"] if p["end_s"] is not None else src_dur
            end_s = min(end_s, src_dur)
            if end_s <= start_s:
                end_s = min(start_s + 1.0, src_dur)
            seg = _render_main_segment(_speed_scaled(clip.subclipped(start_s, end_s), p.get("speed", 1.0)), p, video_width, video_height, _bg_rgb(params))
            if i > 0:
                seg = _apply_transition(seg, p.get("transition", "none"))
            seg_path = os.path.join(output_dir, f"edl-seg-{i}.mp4")
            seg.write_videofile(seg_path, logger=None, fps=fps, codec=video_codec, preset=_X264_PRESET)
            clip_files.append(seg_path)
            total += (end_s - start_s) / max(0.1, float(p.get("speed", 1.0) or 1.0))
        finally:
            close_clip(clip)

    # 合成总时长 = max(旁白末尾, 主视频实长, 所有视频轨末尾, 插入音频末尾)
    # #24:以「最后占位元素」为准,主视频不足处用黑底填充(不再定格末帧)。
    target_dur = max(
        audio_duration, total,
        _timeline_video_end_s(timeline), _timeline_audio_end_s(timeline),
    )
    if clip_files and total < target_dur - 0.2:
        try:
            gap = target_dur - total
            black = ColorClip(size=(video_width, video_height), color=_bg_rgb(params)).with_duration(gap)
            black_path = os.path.join(output_dir, "edl-black.mp4")
            black.write_videofile(black_path, logger=None, fps=fps, codec=video_codec, preset=_X264_PRESET)
            close_clip(black)
            clip_files.append(black_path)
        except Exception as exc:
            logger.warning("[edl] 黑底补足失败,跳过(将以现有片段长度交付): %s", exc)

    combined_path = os.path.join(output_dir, "edl-combined.mp4")
    concat_video_clips_with_ffmpeg(clip_files, combined_path, threads=threads, output_dir=output_dir)

    # 多视频层画中画(P5c-2):第 2+ 视频轨按 x/y/scale/z 叠在主轨之上
    base_for_compose = combined_path
    pip_layers = _build_pip_layers(timeline, source_resolver=source_resolver)
    if pip_layers:
        try:
            base_clip = _open_video_clip_quietly(combined_path)
            overlays = []
            for ly in pip_layers:
                w = int(video_width * max(0.05, min(1.0, ly["scale"])))
                if ly["is_image"]:
                    oc = ImageClip(ly["path"]).with_duration(ly["dur"] or base_clip.duration)
                else:
                    oc = _open_video_clip_quietly(ly["path"])
                    if ly["dur"]:
                        oc = oc.subclipped(0, min(ly["dur"], oc.duration))
                    oc = _speed_scaled(oc, ly.get("speed", 1.0))
                oc = _apply_pip_geometry(oc, ly)
                # 绝对像素定位:左上角 = (x*W, y*H),与前端预览 left:x% / top:y% 一一对应。
                # 不用 relative=True —— moviepy 的相对定位是 x*(W-w)(右缘锚定)语义,
                # 跟前端"左上角按比例"不一致,会导致"调了位置但成片没按调的来"。
                oc = oc.resized(width=w).with_position(
                    (int(ly["x"] * video_width), int(ly["y"] * video_height))
                ).with_start(ly["start_s"])
                _op = ly.get("opacity", 1.0)
                if _op is not None and _op < 0.999 and hasattr(oc, "with_opacity"):
                    try: oc = oc.with_opacity(float(_op))
                    except Exception:  # noqa: BLE001
                        pass
                if ly.get("transition", "none") not in ("none", ""):
                    try: oc = video_effects.fadein_transition(oc, 1)  # PIP 用淡入(slide 会覆盖定位)
                    except Exception:  # noqa: BLE001
                        pass
                overlays.append(oc)
            comp = CompositeVideoClip([base_clip, *overlays])
            pip_path = os.path.join(output_dir, "edl-pip.mp4")
            comp.write_videofile(pip_path, logger=None, fps=fps, codec=video_codec, preset=_X264_PRESET)
            for oc in overlays:
                close_clip(oc)
            close_clip(base_clip)
            close_clip(comp)
            base_for_compose = pip_path
        except Exception as exc:  # noqa: BLE001
            logger.warning("[pip] 分层合成失败,退回主轨: %s", exc)

    generate_video(
        video_path=base_for_compose,
        audio_path=audio_file,
        subtitle_path=subtitle_path,
        output_file=output_file,
        params=params,
        extra_audios=_build_extra_audios(timeline, source_resolver=source_resolver),
        overlays=getattr(timeline, "overlays", None),
    )
    return output_file


def render_proxy_from_timeline(
    timeline,
    video_aspect,
    output_file: str,
    *,
    source_resolver,
    scale: float = 0.5,
    threads: int = 2,
    width=None,
    height=None,
    audio_path: str | None = None,
    subtitle_path: str | None = None,
    params=None,
) -> str:
    """低清代理预览:按 EDL 顺序裁剪+缩放到 scale 倍分辨率拼接。

    默认只拼画面(出片快)。传入 audio_path/params 时(#25 精确预览要完整):在低清画面上
    再走 generate_video 挂旁白音频 + 背景音乐 + 插入音频轨 + 烧字幕(subtitle_path),
    得到带声音和字幕的精确预览。"""
    w, h = resolve_resolution(video_aspect, width, height)
    pw = max(2, int(w * scale) // 2 * 2)
    ph = max(2, int(h * scale) // 2 * 2)
    output_dir = os.path.dirname(output_file)

    plan = _build_edl_render_plan(
        timeline, video_aspect, source_resolver=source_resolver, width=width, height=height,
    )
    if not plan:
        raise RuntimeError("时间轴没有可预览的视频片段")

    clip_files: list = []
    for i, p in enumerate(plan):
        seg_path = os.path.join(output_dir, f"proxy-seg-{i}.mp4")
        # 图像 clip 不能用 VideoFileClip 打开(png_pipe 无 duration → ffmpeg 报
        # "At least one output file must be specified");走 ImageClip 定格成片段。
        if p.get("is_image"):
            img_dur = p["end_s"] if p["end_s"] and p["end_s"] > 0 else 3.0
            seg = ImageClip(p["path"]).with_duration(img_dur).resized(new_size=(pw, ph))
            try:
                seg.write_videofile(seg_path, logger=None, fps=15, codec=video_codec, preset=_X264_PRESET)
                clip_files.append(seg_path)
            finally:
                close_clip(seg)
            continue
        clip = _open_video_clip_quietly(p["path"])
        try:
            src_dur = clip.duration
            start_s = min(p["start_s"], max(0.0, src_dur - 0.1))
            end_s = p["end_s"] if p["end_s"] is not None else src_dur
            end_s = min(end_s, src_dur)
            if end_s <= start_s:
                end_s = min(start_s + 1.0, src_dur)
            seg = clip.subclipped(start_s, end_s).resized(new_size=(pw, ph))
            seg.write_videofile(seg_path, logger=None, fps=15, codec=video_codec, preset=_X264_PRESET)
            clip_files.append(seg_path)
        finally:
            close_clip(clip)

    # 是否要挂音轨/字幕(精确预览)。要的话画面先出到临时文件,最后统一 mux。
    want_av = bool(audio_path and params is not None)
    visual_path = os.path.join(output_dir, "proxy-visual.mp4") if want_av else output_file

    # 主轨 concat;若有 PIP 层(第 2+ 视频轨)再分层合成(低清预览也显真实画中画)
    pip_layers = _build_pip_layers(timeline, source_resolver=source_resolver)
    if not pip_layers:
        concat_video_clips_with_ffmpeg(clip_files, visual_path, threads=threads, output_dir=output_dir)
    else:
        combined_path = os.path.join(output_dir, "proxy-combined.mp4")
        concat_video_clips_with_ffmpeg(clip_files, combined_path, threads=threads, output_dir=output_dir)
        try:
            base_clip = _open_video_clip_quietly(combined_path)
            overlays = []
            for ly in pip_layers:
                ow = max(2, int(pw * max(0.05, min(1.0, ly["scale"]))))
                if ly["is_image"]:
                    oc = ImageClip(ly["path"]).with_duration(ly["dur"] or base_clip.duration)
                else:
                    oc = _open_video_clip_quietly(ly["path"])
                    if ly["dur"]:
                        oc = oc.subclipped(0, min(ly["dur"], oc.duration))
                    oc = _speed_scaled(oc, ly.get("speed", 1.0))
                oc = _apply_pip_geometry(oc, ly)
                # 绝对像素定位(同 render_from_edl):左上角 = (x*pw, y*ph),对齐前端预览。
                oc = oc.resized(width=ow).with_position(
                    (int(ly["x"] * pw), int(ly["y"] * ph))
                ).with_start(ly["start_s"])
                if ly.get("transition", "none") not in ("none", ""):
                    try: oc = video_effects.fadein_transition(oc, 1)
                    except Exception:  # noqa: BLE001
                        pass
                overlays.append(oc)
            comp = CompositeVideoClip([base_clip, *overlays])
            comp.write_videofile(visual_path, logger=None, fps=15, codec=video_codec, preset=_X264_PRESET)
            for oc in overlays:
                close_clip(oc)
            close_clip(base_clip)
            close_clip(comp)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[pip] proxy 分层合成失败,退回主轨: %s", exc)
            shutil.move(combined_path, visual_path)

    if want_av:
        # 低清画面 + 旁白/BGM/插入音频 + 烧字幕 → 精确预览(#25)。
        # 用低清分辨率覆盖 params,避免 generate_video 按全分辨率重渲染。
        low_params = params.model_copy(update={"video_width": pw, "video_height": ph})
        generate_video(
            video_path=visual_path,
            audio_path=audio_path,
            subtitle_path=subtitle_path or "",
            output_file=output_file,
            params=low_params,
            extra_audios=_build_extra_audios(timeline, source_resolver=source_resolver),
            overlays=getattr(timeline, "overlays", None),
        )
    return output_file


def combine_videos(
    combined_video_path: str,
    video_paths: List[str],
    audio_file: str,
    video_aspect: VideoAspect = VideoAspect.portrait,
    video_concat_mode: VideoConcatMode = VideoConcatMode.random,
    video_transition_mode: VideoTransitionMode = None,
    max_clip_duration: int = 5,
    threads: int = 2,
    video_width: int | None = None,
    video_height: int | None = None,
    background_color: tuple = (0, 0, 0),  # letterbox 补边色(RGB);调用方按 params.background_color 传入
) -> str:
    audio_clip = AudioFileClip(audio_file)
    try:
        # 这里只需要读取旁白音频时长来决定素材视频拼接长度；后续不会再使用
        # audio_clip。读取完成后立即关闭，避免早退或异常路径泄漏文件句柄。
        audio_duration = audio_clip.duration
    finally:
        close_clip(audio_clip)
    logger.info(f"audio duration: {audio_duration} seconds")
    logger.info(f"maximum clip duration: {max_clip_duration} seconds")

    # 兼容 API 直接调用时未传转场模式的情况，避免后续访问 .value 时崩溃。
    transition_value = getattr(video_transition_mode, "value", video_transition_mode)
    output_dir = os.path.dirname(combined_video_path)

    video_width, video_height = resolve_resolution(video_aspect, video_width, video_height)

    processed_clips = []
    subclipped_items = []
    video_duration = 0
    for video_path in video_paths:
        clip = _open_video_clip_quietly(video_path)
        clip_duration = clip.duration
        clip_w, clip_h = clip.size
        close_clip(clip)
        
        start_time = 0

        while start_time < clip_duration:
            end_time = min(start_time + max_clip_duration, clip_duration)

            # 保留所有有效分段。
            # 这样既不会丢掉“整段视频本身就短于 max_clip_duration”的素材，
            # 也不会吞掉长视频最后剩下的一小段尾部内容。
            if end_time > start_time:
                subclipped_items.append(
                    SubClippedVideoClip(
                        file_path=video_path,
                        start_time=start_time,
                        end_time=end_time,
                        width=clip_w,
                        height=clip_h,
                    )
                )

            start_time = end_time
            if video_concat_mode.value == VideoConcatMode.sequential.value:
                break

    # random subclipped_items order
    if video_concat_mode.value == VideoConcatMode.random.value:
        random.shuffle(subclipped_items)
        
    logger.debug(f"total subclipped items: {len(subclipped_items)}")
    
    # Add downloaded clips over and over until the duration of the audio (max_duration) has been reached
    for i, subclipped_item in enumerate(subclipped_items):
        if video_duration > audio_duration:
            break
        
        logger.debug(f"processing clip {i+1}: {subclipped_item.width}x{subclipped_item.height}, current duration: {video_duration:.2f}s, remaining: {audio_duration - video_duration:.2f}s")
        
        try:
            clip = _open_video_clip_quietly(subclipped_item.file_path).subclipped(
                subclipped_item.start_time, subclipped_item.end_time
            )
            clip_duration = clip.duration
            # Not all videos are same size, so we need to resize them
            clip_w, clip_h = clip.size
            if clip_w != video_width or clip_h != video_height:
                clip_ratio = clip.w / clip.h
                video_ratio = video_width / video_height
                logger.debug(f"resizing clip, source: {clip_w}x{clip_h}, ratio: {clip_ratio:.2f}, target: {video_width}x{video_height}, ratio: {video_ratio:.2f}")
                
                if clip_ratio == video_ratio:
                    clip = clip.resized(new_size=(video_width, video_height))
                else:
                    if clip_ratio > video_ratio:
                        scale_factor = video_width / clip_w
                    else:
                        scale_factor = video_height / clip_h

                    new_width = int(clip_w * scale_factor)
                    new_height = int(clip_h * scale_factor)

                    background = ColorClip(size=(video_width, video_height), color=background_color).with_duration(clip_duration)
                    clip_resized = clip.resized(new_size=(new_width, new_height)).with_position("center")
                    clip = CompositeVideoClip([background, clip_resized])
                    
            shuffle_side = random.choice(["left", "right", "top", "bottom"])
            if transition_value in (None, VideoTransitionMode.none.value):
                clip = clip
            elif transition_value == VideoTransitionMode.fade_in.value:
                clip = video_effects.fadein_transition(clip, 1)
            elif transition_value == VideoTransitionMode.fade_out.value:
                clip = video_effects.fadeout_transition(clip, 1)
            elif transition_value == VideoTransitionMode.slide_in.value:
                clip = video_effects.slidein_transition(clip, 1, shuffle_side)
            elif transition_value == VideoTransitionMode.slide_out.value:
                clip = video_effects.slideout_transition(clip, 1, shuffle_side)
            elif transition_value == VideoTransitionMode.shuffle.value:
                transition_funcs = [
                    lambda c: video_effects.fadein_transition(c, 1),
                    lambda c: video_effects.fadeout_transition(c, 1),
                    lambda c: video_effects.slidein_transition(c, 1, shuffle_side),
                    lambda c: video_effects.slideout_transition(c, 1, shuffle_side),
                ]
                shuffle_transition = random.choice(transition_funcs)
                clip = shuffle_transition(clip)

            if clip.duration > max_clip_duration:
                clip = clip.subclipped(0, max_clip_duration)
                
            # wirte clip to temp file
            clip_file = f"{output_dir}/temp-clip-{i+1}.mp4"
            clip.write_videofile(clip_file, logger=None, fps=fps, codec=video_codec, preset=_X264_PRESET)

            # Store clip duration before closing
            clip_duration_saved = clip.duration
            close_clip(clip)

            processed_clips.append(SubClippedVideoClip(file_path=clip_file, duration=clip_duration_saved, width=clip_w, height=clip_h))
            video_duration += clip_duration_saved
            
        except Exception as e:
            logger.error(f"failed to process clip: {str(e)}")
    
    # loop processed clips until the video duration matches or exceeds the audio duration.
    if video_duration < audio_duration:
        logger.warning(f"video duration ({video_duration:.2f}s) is shorter than audio duration ({audio_duration:.2f}s), looping clips to match audio length.")
        base_clips = processed_clips.copy()
        for clip in itertools.cycle(base_clips):
            if video_duration >= audio_duration:
                break
            processed_clips.append(clip)
            video_duration += clip.duration
        logger.info(f"video duration: {video_duration:.2f}s, audio duration: {audio_duration:.2f}s, looped {len(processed_clips)-len(base_clips)} clips")
     
    # merge video clips progressively, avoid loading all videos at once to avoid memory overflow
    logger.info("starting clip merging process")
    if not processed_clips:
        logger.warning("no clips available for merging")
        return combined_video_path
    
    # if there is only one clip, use it directly
    if len(processed_clips) == 1:
        logger.info("using single clip directly")
        shutil.copy(processed_clips[0].file_path, combined_video_path)
        delete_files([processed_clips[0].file_path])
        logger.info("video combining completed")
        return combined_video_path

    clip_files = [clip.file_path for clip in processed_clips]
    logger.info(f"concatenating {len(clip_files)} clips with ffmpeg")
    concat_video_clips_with_ffmpeg(
        clip_files=clip_files,
        output_file=combined_video_path,
        threads=threads,
        output_dir=output_dir,
    )
    
    # clean temp files
    delete_files(clip_files)
            
    logger.info("video combining completed")
    return combined_video_path


def wrap_text(text, max_width, font="Arial", fontsize=60):
    # Create ImageFont
    font = ImageFont.truetype(font, fontsize)

    def get_text_size(inner_text):
        inner_text = inner_text.strip()
        left, top, right, bottom = font.getbbox(inner_text)
        return right - left, bottom - top

    width, height = get_text_size(text)
    if width <= max_width:
        return text, height

    processed = True

    _wrapped_lines_ = []
    words = text.split(" ")
    _txt_ = ""
    for word in words:
        _before = _txt_
        _txt_ += f"{word} "
        _width, _height = get_text_size(_txt_)
        if _width <= max_width:
            continue
        else:
            if _txt_.strip() == word.strip():
                processed = False
                break
            _wrapped_lines_.append(_before)
            _txt_ = f"{word} "
    _wrapped_lines_.append(_txt_)
    if processed:
        _wrapped_lines_ = [line.strip() for line in _wrapped_lines_]
        result = "\n".join(_wrapped_lines_).strip()
        height = len(_wrapped_lines_) * height
        return result, height

    _wrapped_lines_ = []
    chars = list(text)
    _txt_ = ""
    for word in chars:
        _txt_ += word
        _width, _height = get_text_size(_txt_)
        if _width <= max_width:
            continue
        else:
            _wrapped_lines_.append(_txt_)
            _txt_ = ""
    _wrapped_lines_.append(_txt_)
    result = "\n".join(_wrapped_lines_).strip()
    height = len(_wrapped_lines_) * height
    return result, height


def _hex_rgba(s, alpha=255):
    v = str(s or "").strip().lstrip("#")
    if len(v) == 6:
        try:
            return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16), alpha)
        except ValueError:
            pass
    return None


def _render_shape_image(ov, W, H):
    """PIL 画 rect/ellipse/line/arrow 到透明 RGBA PNG,返回临时路径(失败 None)。"""
    try:
        w = max(2, int((getattr(ov, "w", 0.3) or 0.3) * W))
        h = max(2, int((getattr(ov, "h", 0.2) or 0.2) * H))
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        fill = _hex_rgba(getattr(ov, "fill", None)) if getattr(ov, "fill", None) else None
        sw = max(0, int(round(float(getattr(ov, "stroke_width", 1.5) or 0))))
        stroke = _hex_rgba(getattr(ov, "stroke_color", "#000000")) if sw > 0 else None
        t = getattr(ov, "type", "rect")
        m = sw // 2 + 1
        box = [m, m, w - m - 1, h - m - 1]
        if t == "rect":
            rad = max(0, int(float(getattr(ov, "corner_radius", 0.0) or 0.0)))
            d.rounded_rectangle(box, radius=rad, fill=fill, outline=stroke, width=(max(1, sw) if stroke else 0))
        elif t == "ellipse":
            d.ellipse(box, fill=fill, outline=stroke, width=(max(1, sw) if stroke else 0))
        elif t in ("line", "arrow"):
            col = stroke or (0, 0, 0, 255)
            y = h // 2
            d.line([(m, y), (w - m - 1, y)], fill=col, width=max(1, sw or 2))
            if t == "arrow":
                a = max(6, (sw or 2) * 3)
                d.polygon([(w - m - 1, y), (w - m - 1 - a, y - a // 2), (w - m - 1 - a, y + a // 2)], fill=col)
        fd, path = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        img.save(path)
        return path
    except Exception as exc:  # noqa: BLE001
        logger.warning("[overlay] 图形渲染失败 %s: %s", getattr(ov, "id", "?"), exc)
        return None


def _render_overlays(video_clip, overlays, W, H, font_path):
    """A 期只渲染 type=='text' 的叠加元素;其它 type 跳过(B-D 期)。单个失败跳过不影响成片。"""
    if not overlays:
        return video_clip
    clips = []
    for ov in overlays:
        try:
            ovtype = getattr(ov, "type", "text")
            start_s = max(0.0, (getattr(ov, "track_start_ms", 0) or 0) / 1000.0)
            dur = max(0.2, (getattr(ov, "duration_ms", 3000) or 3000) / 1000.0)
            if ovtype == "text":
                txt = (getattr(ov, "text", "") or "").strip()
                if not txt:
                    continue
                w_px = max(2, int((getattr(ov, "w", 0.5) or 0.5) * W))
                ov_font = getattr(ov, "font_name", "") or ""
                if ov_font and not os.path.isfile(ov_font):
                    cand = os.path.join(utils.font_dir(), ov_font)
                    ov_font = cand if os.path.isfile(cand) else font_path
                tc = TextClip(
                    text=txt, font=(ov_font or font_path),
                    font_size=int(getattr(ov, "font_size", 48) or 48),
                    color=getattr(ov, "text_color", "#ffffff") or "#ffffff",
                    stroke_color=getattr(ov, "stroke_color", "#000000") or "#000000",
                    stroke_width=float(getattr(ov, "stroke_width", 1.5) or 0),
                    bg_color=(getattr(ov, "bg", None) or None),
                    method="caption", size=(w_px, None),
                    text_align=getattr(ov, "align", "center") or "center",
                )
            elif ovtype in ("rect", "ellipse", "line", "arrow"):
                sp = _render_shape_image(ov, W, H)
                if not sp:
                    continue
                tc = ImageClip(sp)
            elif ovtype == "image":
                src = getattr(ov, "src", None)
                if not src:
                    continue
                from .._helpers import overlay_assets_dir
                sp = src if (os.path.isabs(src) and os.path.isfile(src)) else os.path.join(overlay_assets_dir(), os.path.basename(src))
                if not os.path.isfile(sp):
                    continue
                tc = ImageClip(sp).resized(width=max(2, int((getattr(ov, "w", 0.3) or 0.3) * W)))
            else:
                continue
            tc = tc.with_start(start_s).with_end(start_s + dur)
            tc = tc.with_position((int((getattr(ov, "x", 0.1) or 0) * W), int((getattr(ov, "y", 0.1) or 0) * H)))
            _kfs = sorted(getattr(ov, "keyframes", None) or [], key=lambda k: getattr(k, "t", 0))
            if len(_kfs) >= 2:
                def _posfn(time, kfs=_kfs, _dur=dur, _W=W, _H=H):
                    rel = 0.0 if _dur <= 0 else max(0.0, min(1.0, time / _dur))
                    if rel <= kfs[0].t:
                        kx, ky = kfs[0].x, kfs[0].y
                    elif rel >= kfs[-1].t:
                        kx, ky = kfs[-1].x, kfs[-1].y
                    else:
                        kx, ky = kfs[-1].x, kfs[-1].y
                        for i in range(len(kfs) - 1):
                            a, b = kfs[i], kfs[i + 1]
                            if a.t <= rel <= b.t:
                                f = (rel - a.t) / (b.t - a.t) if b.t > a.t else 0.0
                                kx = a.x + (b.x - a.x) * f
                                ky = a.y + (b.y - a.y) * f
                                break
                    return (int(kx * _W), int(ky * _H))
                try:
                    tc = tc.with_position(_posfn)
                except Exception:  # noqa: BLE001
                    pass

                def _sizefn(time, kfs=_kfs, _dur=dur, _W=W, _H=H):
                    rel = 0.0 if _dur <= 0 else max(0.0, min(1.0, time / _dur))
                    if rel <= kfs[0].t:
                        kw, kh = getattr(kfs[0], "w", 0.5), getattr(kfs[0], "h", 0.2)
                    elif rel >= kfs[-1].t:
                        kw, kh = getattr(kfs[-1], "w", 0.5), getattr(kfs[-1], "h", 0.2)
                    else:
                        kw, kh = getattr(kfs[-1], "w", 0.5), getattr(kfs[-1], "h", 0.2)
                        for i in range(len(kfs) - 1):
                            a, b = kfs[i], kfs[i + 1]
                            if a.t <= rel <= b.t:
                                f = (rel - a.t) / (b.t - a.t) if b.t > a.t else 0.0
                                kw = getattr(a, "w", 0.5) + (getattr(b, "w", 0.5) - getattr(a, "w", 0.5)) * f
                                kh = getattr(a, "h", 0.2) + (getattr(b, "h", 0.2) - getattr(a, "h", 0.2)) * f
                                break
                    return (max(2, int(kw * _W)), max(2, int(kh * _H)))
                if any(abs(getattr(k, "w", 0.5) - getattr(_kfs[0], "w", 0.5)) > 0.001 or abs(getattr(k, "h", 0.2) - getattr(_kfs[0], "h", 0.2)) > 0.001 for k in _kfs):
                    try:
                        tc = tc.resized(_sizefn)
                    except Exception:  # noqa: BLE001
                        pass
            rot = float(getattr(ov, "rotation", 0.0) or 0.0)
            if abs(rot) > 0.01:
                tc = tc.rotated(rot)
            op = float(getattr(ov, "opacity", 1.0) or 1.0)
            if op < 0.999 and hasattr(tc, "with_opacity"):
                tc = tc.with_opacity(op)
            _ain = getattr(ov, "anim_in", "none") or "none"
            _aout = getattr(ov, "anim_out", "none") or "none"
            _ad = min(float(getattr(ov, "anim_dur", 0.5) or 0.5), max(0.1, dur / 2.0))
            _eff = []
            if _ain == "fade" and hasattr(vfx, "CrossFadeIn"):
                _eff.append(vfx.CrossFadeIn(_ad))
            if _aout == "fade" and hasattr(vfx, "CrossFadeOut"):
                _eff.append(vfx.CrossFadeOut(_ad))
            if _eff:
                try:
                    tc = tc.with_effects(_eff)
                except Exception:  # noqa: BLE001
                    pass
            clips.append(tc)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[overlay] 跳过一个叠加元素: %s", exc)
    return CompositeVideoClip([video_clip, *clips]) if clips else video_clip


def _apply_mosaics(output_file, overlays, W, H):
    """对 mosaic 叠加元素:ffmpeg 各区域 boxblur + 按时间段 overlay 回原片(原地替换)。失败保留原片。"""
    mos = [o for o in (overlays or []) if getattr(o, "type", "") == "mosaic"]
    if not mos or not output_file or not os.path.isfile(output_file):
        return output_file
    try:
        from .outro import _ffmpeg
        ff = _ffmpeg()
        n = len(mos)
        parts = ["[0:v]split=%d[base]%s" % (n + 1, "".join("[c%d]" % i for i in range(n)))]
        prev = "base"
        for i, o in enumerate(mos):
            x = max(0, int((getattr(o, "x", 0.1) or 0) * W))
            y = max(0, int((getattr(o, "y", 0.1) or 0) * H))
            w = max(2, int((getattr(o, "w", 0.3) or 0.3) * W)); w -= w % 2
            h = max(2, int((getattr(o, "h", 0.2) or 0.2) * H)); h -= h % 2
            ss = max(0.0, (getattr(o, "track_start_ms", 0) or 0) / 1000.0)
            ee = ss + max(0.2, (getattr(o, "duration_ms", 3000) or 3000) / 1000.0)
            parts.append("[c%d]crop=%d:%d:%d:%d,boxblur=12:2[b%d]" % (i, w, h, x, y, i))
            out = "vout" if i == n - 1 else "v%d" % (i + 1)
            parts.append("[%s][b%d]overlay=%d:%d:enable='between(t,%.3f,%.3f)'[%s]" % (prev, i, x, y, ss, ee, out))
            prev = out
        fc = ";".join(parts)
        tmp = output_file + ".mosaic.mp4"
        cmd = [ff, "-y", "-i", output_file, "-filter_complex", fc, "-map", "[vout]",
               "-map", "0:a?", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", tmp]
        r = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if r.returncode != 0 or not os.path.isfile(tmp):
            logger.warning("[mosaic] ffmpeg 失败,保留原片: %s", (r.stderr or r.stdout or "").strip()[-400:])
            if os.path.isfile(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass
            return output_file
        os.replace(tmp, output_file)
        logger.info("[mosaic] 已应用 %d 个马赛克区域: %s", n, output_file)
        return output_file
    except Exception as exc:  # noqa: BLE001
        logger.warning("[mosaic] 异常,保留原片: %s", exc)
        return output_file


def generate_video(
    video_path: str,
    audio_path: str,
    subtitle_path: str,
    output_file: str,
    params: VideoParams,
    extra_audios: list | None = None,
    overlays: list | None = None,
):
    # 合成前确保 moviepy 音频读越界补丁已生效(防 CompositeAudioClip 越界读崩片)
    _patch_moviepy_audio_reader_overread()

    video_width, video_height = resolve_resolution(
        params.video_aspect, getattr(params, "video_width", None), getattr(params, "video_height", None)
    )

    logger.info(f"generating video: {video_width} x {video_height}")
    logger.info(f"  ① video: {video_path}")
    logger.info(f"  ② audio: {audio_path}")
    logger.info(f"  ③ subtitle: {subtitle_path}")
    logger.info(f"  ④ output: {output_file}")

    # https://github.com/harry0703/MoneyPrinterTurbo/issues/217
    # PermissionError: [WinError 32] The process cannot access the file because it is being used by another process: 'final-1.mp4.tempTEMP_MPY_wvf_snd.mp3'
    # write into the same directory as the output file
    output_dir = os.path.dirname(output_file)

    font_path = ""
    if params.subtitle_enabled:
        if not params.font_name:
            params.font_name = "STHeitiMedium.ttc"
        # font_name 可能是:
        #   - 裸文件名(bundled/user 字体)→ 拼字体目录
        #   - 绝对路径(系统字体,/fonts?source=system 返回的)→ 直接用
        if os.path.isabs(params.font_name) and os.path.isfile(params.font_name):
            font_path = params.font_name
        else:
            font_path = os.path.join(utils.font_dir(), params.font_name)
        if os.name == "nt":
            font_path = font_path.replace("\\", "/")

        # 默认 STHeitiMedium.ttc 是 macOS 专有;干净 Windows/Linux 上不存在 →
        # ImageFont.truetype 会 FileNotFoundError 让字幕渲染整段失败。平台兜底:
        # bundled 字体目录 → 平台常见中文系统字体 → 任意可用。
        if font_path and not os.path.isfile(font_path):
            import glob as _glob
            import sys as _sys
            _cands: list[str] = []
            try:
                from chayuan.server.video_generation import binaries as _bin
                _fd = _bin.get_fonts_dir()
                if _fd and os.path.isdir(_fd):
                    for _ext in ("*.ttc", "*.ttf", "*.otf"):
                        _cands.extend(sorted(_glob.glob(os.path.join(_fd, _ext))))
            except Exception:  # noqa: BLE001
                pass
            if _sys.platform == "win32":
                _win = os.environ.get("WINDIR", "C:\\Windows")
                _cands += [os.path.join(_win, "Fonts", _n) for _n in
                           ("msyh.ttc", "simhei.ttf", "simsun.ttc", "msyhbd.ttc")]
            elif _sys.platform == "darwin":
                _cands += ["/System/Library/Fonts/STHeiti Medium.ttc",
                           "/System/Library/Fonts/PingFang.ttc"]
            else:
                _cands += _glob.glob("/usr/share/fonts/**/*.tt[cf]", recursive=True)
            for _c in _cands:
                if _c and os.path.isfile(_c):
                    _resolved = _c.replace("\\", "/") if os.name == "nt" else _c
                    logger.warning("  ⑤ 默认字体 %s 不存在,回退 %s", params.font_name, _resolved)
                    font_path = _resolved
                    break

        logger.info(f"  ⑤ font: {font_path}")

    def resolve_subtitle_background_color():
        # 兼容历史参数：API 里 `text_background_color` 既可能是布尔值，
        # 也可能是实际颜色字符串。统一在这里归一化，避免把 True/False
        # 直接传给 TextClip 后出现不可预期的渲染结果。
        if isinstance(params.text_background_color, bool):
            return "#000000" if params.text_background_color else None
        return params.text_background_color

    def create_text_clip(subtitle_item):
        params.font_size = int(params.font_size)
        params.stroke_width = int(params.stroke_width)
        phrase = subtitle_item[1]
        max_width = video_width * 0.9
        wrapped_txt, txt_height = wrap_text(
            phrase, max_width=max_width, font=font_path, fontsize=params.font_size
        )
        interline = int(params.font_size * 0.25)
        line_count = wrapped_txt.count("\n") + 1
        vertical_padding = int(params.font_size * 0.35)
        # MoviePy 在 `method=label` 下会自动收缩文本框高度，遇到多行字幕、
        # 描边或背景色时，容易把最后一行的下半部分裁掉。这里显式传入
        # 一个更保守的高度，把行间距和额外上下留白一并算进去，保证字幕
        # 背景框与文字本身都能完整渲染出来。
        size = (
            int(max_width),
            int(txt_height + vertical_padding + (interline * line_count)),
        )

        _clip = TextClip(
            text=wrapped_txt,
            font=font_path,
            font_size=params.font_size,
            color=params.text_fore_color,
            bg_color=resolve_subtitle_background_color(),
            stroke_color=params.stroke_color,
            stroke_width=params.stroke_width,
            interline=interline,
            size=size,
            text_align="center",
        )
        duration = subtitle_item[0][1] - subtitle_item[0][0]
        _clip = _clip.with_start(subtitle_item[0][0])
        _clip = _clip.with_end(subtitle_item[0][1])
        _clip = _clip.with_duration(duration)
        if params.subtitle_position == "bottom":
            _clip = _clip.with_position(("center", video_height * 0.95 - _clip.h))
        elif params.subtitle_position == "top":
            _clip = _clip.with_position(("center", video_height * 0.05))
        elif params.subtitle_position == "custom":
            # Ensure the subtitle is fully within the screen bounds
            margin = 10  # Additional margin, in pixels
            max_y = video_height - _clip.h - margin
            min_y = margin
            custom_y = (video_height - _clip.h) * (params.custom_position / 100)
            custom_y = max(
                min_y, min(custom_y, max_y)
            )  # Constrain the y value within the valid range
            _clip = _clip.with_position(("center", custom_y))
        else:  # center
            _clip = _clip.with_position(("center", "center"))
        return _clip

    video_clip = _open_video_clip_quietly(video_path)
    # 旁白(可空):无旁白合成时仅靠背景音乐 / 音频轨 / 视频原声;按层收集后再统一合成
    audio_layers: list = []
    if audio_path and os.path.exists(audio_path):
        audio_layers.append(
            _trim_audio_tail(AudioFileClip(audio_path)).with_effects([afx.MultiplyVolume(params.voice_volume)])
        )

    def make_textclip(text):
        return TextClip(
            text=text,
            font=font_path,
            font_size=params.font_size,
        )

    if subtitle_path and os.path.exists(subtitle_path):
        sub = SubtitlesClip(
            subtitles=subtitle_path, encoding="utf-8", make_textclip=make_textclip
        )
        text_clips = []
        for item in sub.subtitles:
            clip = create_text_clip(subtitle_item=item)
            text_clips.append(clip)
        video_clip = CompositeVideoClip([video_clip, *text_clips])

    # 叠加元素(A 期文字)— 叠在画面/字幕之上
    try:
        video_clip = _render_overlays(video_clip, overlays or [], video_width, video_height, font_path)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[overlay] 渲染叠加失败,跳过: %s", exc)

    bgm_file = get_bgm_file(bgm_type=params.bgm_type, bgm_file=params.bgm_file)
    if bgm_file:
        try:
            bgm_clip = AudioFileClip(bgm_file).with_effects(
                [
                    afx.MultiplyVolume(params.bgm_volume),
                    afx.AudioFadeOut(3),
                    afx.AudioLoop(duration=video_clip.duration),
                ]
            )
            audio_layers.append(bgm_clip)
        except Exception as e:
            logger.error(f"failed to add bgm: {str(e)}")

    # 插入音频轨(P5b)+ 视频 clip 内嵌音频:每条按 start_s 定位、按 in/out 裁剪、按 volume 混入。
    # 无音轨的视频素材在此 AudioFileClip 抛错被静默跳过(不影响出片)。
    for ea in (extra_audios or []):
        try:
            _ac = AudioFileClip(ea["path"])
            _in = ea.get("in_s")
            _out = ea.get("out_s")
            if (_in and _in > 0) or (_out and _out > 0):
                try:
                    _ac = _ac.subclipped(float(_in or 0.0), float(_out) if _out else None)
                except Exception:  # noqa: BLE001
                    pass
            # 尾部削一点,规避 moviepy 2.x 在合成里越界读该层音频抛 IOError(任务报错主因)
            _ac = _trim_audio_tail(_ac)
            ea_clip = _ac.with_effects(
                [afx.MultiplyVolume(float(ea.get("volume", 1.0)))]
            ).with_start(float(ea.get("start_s", 0.0)))
            audio_layers.append(ea_clip)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[compose] 插入音频混音失败,跳过 %s: %s", ea.get("path"), exc)

    if audio_layers:
        audio_clip = audio_layers[0] if len(audio_layers) == 1 else CompositeAudioClip(audio_layers)
        video_clip = video_clip.with_audio(audio_clip)
        # 显式沿用输入音频的采样率；如果取不到，再回退到 MoviePy 默认的 44100Hz。
        # 这样可以减少不同运行环境，尤其是 Docker 环境中再次重采样带来的音质波动。
        output_audio_fps = int(getattr(audio_clip, "fps", 0) or 44100)
        video_clip.write_videofile(
            output_file,
            audio_codec=audio_codec,
            audio_fps=output_audio_fps,
            audio_bitrate=audio_bitrate,
            temp_audiofile_path=output_dir,
            threads=params.n_threads or 2,
            logger=None,
            fps=fps,
            preset=_X264_PRESET,
        )
    else:
        # 完全无音频(无旁白 + 无音乐 + 无可混的视频原声)→ 写纯画面,避免 moviepy 对空音频报错
        video_clip.write_videofile(
            output_file,
            temp_audiofile_path=output_dir,
            threads=params.n_threads or 2,
            logger=None,
            fps=fps,
            preset=_X264_PRESET,
        )
    video_clip.close()
    del video_clip
    try:
        _apply_mosaics(output_file, overlays, video_width, video_height)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[mosaic] 后处理跳过: %s", exc)


def preprocess_video(materials: List[MaterialInfo], clip_duration=4):
    # WebUI 在某些二次生成场景下可能传入空素材列表，这里直接返回空结果，避免抛出 NoneType 异常。
    if not materials:
        return []

    # 仅返回通过预处理校验的素材，避免低分辨率图片继续进入后续的视频合成流程。
    valid_materials = []
    local_videos_dir = utils.storage_dir("local_videos", create=True)

    for material in materials:
        if not material.url:
            continue

        try:
            material_source_path = _resolve_path_within_directory(
                local_videos_dir, material.url
            )
        except ValueError as exc:
            # local video_source 的素材路径来自 API 参数，必须限制在专用素材目录。
            # 允许用户传文件名，也兼容历史返回的绝对路径，但不允许逃逸到系统
            # 其他目录，避免任意文件读取或通过 MoviePy 探测本地敏感文件。
            logger.warning(
                f"skip unsafe local material: {material.url}, "
                f"local_videos_dir: {local_videos_dir}, error: {str(exc)}"
            )
            continue

        ext = utils.parse_extension(material_source_path)
        try:
            # 图片素材直接按图片方式读取，避免先走 VideoFileClip 误判后触发不稳定的回退分支。
            if ext in const.FILE_TYPE_IMAGES:
                clip, material_source_path = _open_image_clip_with_fallback(
                    material_source_path
                )
            else:
                clip = _open_video_clip_quietly(material_source_path)
        except Exception:
            # 非标准扩展名或探测失败时再回退到图片模式，兼容历史上直接传本地图片路径的情况。
            try:
                clip, material_source_path = _open_image_clip_with_fallback(
                    material_source_path
                )
            except Exception as exc:
                logger.warning(
                    f"skip unreadable local material: {material.url}, error: {str(exc)}"
                )
                continue
        try:
            width = clip.size[0]
            height = clip.size[1]
            if width < 480 or height < 480:
                logger.warning(f"low resolution material: {width}x{height}, minimum 480x480 required")
                # 探测到低分辨率素材后立即关闭资源，并且不要把该素材返回给后续流程。
                close_clip(clip)
                continue

            if ext in const.FILE_TYPE_IMAGES:
                logger.info(f"processing image: {material_source_path}")
                # 探测尺寸时已经打开过一次素材，这里先释放探测句柄，再重新创建用于导出的图片 clip。
                close_clip(clip)
                # Create an image clip and set its duration to 3 seconds
                clip = (
                    ImageClip(material_source_path)
                    .with_duration(clip_duration)
                    .with_position("center")
                )
                # Apply a zoom effect using the resize method.
                # A lambda function is used to make the zoom effect dynamic over time.
                # The zoom effect starts from the original size and gradually scales up to 120%.
                # t represents the current time, and clip.duration is the total duration of the clip (3 seconds).
                # Note: 1 represents 100% size, so 1.2 represents 120% size.
                zoom_clip = clip.resized(
                    lambda t: 1 + (clip_duration * 0.03) * (t / clip.duration)
                )

                # Optionally, create a composite video clip containing the zoomed clip.
                # This is useful when you want to add other elements to the video.
                final_clip = CompositeVideoClip([zoom_clip])

                # Output the video to a file.
                video_file = f"{material_source_path}.mp4"
                final_clip.write_videofile(video_file, fps=30, logger=None, preset=_X264_PRESET)
                close_clip(clip)
                close_clip(final_clip)
                material.url = video_file
                logger.success(f"image processed: {video_file}")
            else:
                # 普通视频素材只需要读取尺寸做校验，校验完成后立即释放句柄即可。
                close_clip(clip)
        except Exception:
            close_clip(clip)
            raise

        valid_materials.append(material)

    return valid_materials
