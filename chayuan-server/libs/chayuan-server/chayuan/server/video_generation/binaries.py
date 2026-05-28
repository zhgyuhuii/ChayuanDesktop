"""外部二进制 / 资源路径解析 + 启动注入。

本项目 vendor 约定(跟 llama-server / whisper-server 一致):
    chayuan-server/vendor/services/<engine>-server/<platform>/<bin>[.exe]
    chayuan-server/vendor/bundled_fonts/<font>.ttc | .ttf | .otf
    chayuan-server/vendor/bundled_bgm/<song>.mp3
    chayuan-server/vendor/bundled_video_clips/<clip>.mp4

video_generation 模块需要:
  1) **ImageMagick** — moviepy TextClip 文字渲染必需。本项目首次加,放
     ``vendor/services/imagemagick/<platform>/magick(.exe)``,与 llama/
     whisper-server 同位置(同样是 server-style "随包带的外部程序")。
     探测命中后 ``os.environ["IMAGEMAGICK_BINARY"]`` 注入 — moviepy 启
     动时直接读这个变量。

  2) **ffmpeg** — 复用现有 ``imageio-ffmpeg`` Python wheel(已 ~30 MB
     跨平台 prebuilt 静态二进制)。``imageio_ffmpeg.get_ffmpeg_exe()``
     拿绝对路径 → 注入 ``IMAGEIO_FFMPEG_EXE``,moviepy 走这个。

  3) **字体** — 字幕渲染选择列表来源。bundle 5 个常用中文字体(从上游
     resource/fonts 拷;M3 阶段做实际拷贝)。索引层用 fonts_index.py。

  4) **BGM** — 内置背景音乐 ~10 首(从上游 resource/songs 拷)。索引层
     用 bgm_index.py。

  5) **内置视频素材片段**(可选,full 包预装) — 离线模式下"本地素材库"
     默认内容。M3 阶段做素材筛选 + 拷贝。

模块行为:
- ``configure(strict=False)`` 启动时调一次,完成所有探测 + 环境变量
  注入,把结果记到 module 级 ``_state``。
- ``get_imagemagick_path() / get_ffmpeg_path() / get_fonts_dir() /
  get_bgm_dir() / get_clips_dir()`` — 业务代码按需查询。
- 探测失败优雅降级:返回 None / 空目录,调用方决定是否报错(例如
  moviepy 撞到没 IMAGEMAGICK_BINARY 时 TextClip 会自报错,我们不预先
  blow up)。
"""

from __future__ import annotations

import logging
import os
import platform
import sys
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger("chayuan.video_generation.binaries")


# ─────────────────────────────────────────────────────────────────────
# 平台标识 — 跟 llama-server / whisper-server 子目录命名一致
# ─────────────────────────────────────────────────────────────────────


def _platform_tag() -> str:
    """返回 vendor 子目录名:win-x64 / win-x64-noavx / linux-x64 / linux-arm64 /
    macos-arm64 / macos-x64。

    简化版:M1 只 happy path 区分四个主平台;CPU 特性(noavx)等细分留给
    后续探测器,binaries.py 不做 fallback 兜底,撞不上就当作"没装"。
    """

    sys_p = platform.system().lower()
    mach = platform.machine().lower()
    if "windows" in sys_p:
        return "win-x64"  # noavx fallback 由 install_service 兜
    if "darwin" in sys_p:
        if "arm" in mach or "aarch64" in mach:
            return "macos-arm64"
        return "macos-x64"
    # Linux 系
    if "aarch64" in mach or "arm64" in mach:
        return "linux-arm64"
    return "linux-x64"


@lru_cache(maxsize=1)
def _vendor_root() -> Path:
    """定位 chayuan-server/vendor/ 目录。

    探测顺序:
      1) 开发模式:从 ``__file__`` 向上找直到含 ``vendor/services``
         的祖父目录(monorepo `/work/chayuan-desktop/chayuan-server/vendor`)
      2) frozen / 安装包:从 ``sys.executable`` 同级 ``vendor/`` 找
      3) 环境变量 ``CHAYUAN_VENDOR_ROOT`` 覆盖

    找不到返当前目录作哨兵 — 调用者通过 ``exists()`` 判定。
    """

    env = os.environ.get("CHAYUAN_VENDOR_ROOT")
    if env:
        p = Path(env)
        if p.exists():
            return p

    here = Path(__file__).resolve()
    for parent in [here.parent] + list(here.parents):
        candidate = parent / "vendor"
        if (candidate / "services").is_dir():
            return candidate

    # frozen 路径(PyInstaller):exe 同级
    try:
        exe_dir = Path(sys.executable).resolve().parent
        candidate = exe_dir / "vendor"
        if (candidate / "services").is_dir():
            return candidate
    except Exception:  # noqa: BLE001
        pass

    # 兜底:返一个一定不存在的路径,后续 exists() 判负
    return Path(__file__).resolve().parent / "__no_vendor__"


# ─────────────────────────────────────────────────────────────────────
# 状态
# ─────────────────────────────────────────────────────────────────────


@dataclass
class BinariesState:
    """``configure()`` 结果。业务代码查询用。"""

    imagemagick_path: Optional[str] = None
    ffmpeg_path: Optional[str] = None
    fonts_dir: Optional[str] = None
    bgm_dir: Optional[str] = None
    clips_dir: Optional[str] = None
    issues: List[str] = field(default_factory=list)


_state: BinariesState = BinariesState()


# ─────────────────────────────────────────────────────────────────────
# 探测 + 注入
# ─────────────────────────────────────────────────────────────────────


def _probe_imagemagick() -> Optional[str]:
    """vendor/services/imagemagick/<platform>/magick(.exe);找不到回 None。

    跨平台命名约定:
      win-x64        magick.exe
      win-x64-noavx  magick.exe
      linux-x64      magick (静态 portable AppImage 解出来的)
      linux-arm64    magick
      macos-arm64    magick
      macos-x64      magick
    """

    tag = _platform_tag()
    bin_name = "magick.exe" if tag.startswith("win") else "magick"
    candidate = _vendor_root() / "services" / "imagemagick" / tag / bin_name
    if candidate.is_file():
        return str(candidate)

    # 兜底:用户已安装系统级 ImageMagick(linux apt/macOS brew)
    import shutil
    system_bin = shutil.which("magick") or shutil.which("convert")
    if system_bin:
        return system_bin
    return None


def _probe_ffmpeg() -> Optional[str]:
    """优先 imageio-ffmpeg(已是 deps),回退系统 PATH。"""

    try:
        import imageio_ffmpeg  # type: ignore
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.isfile(exe):
            return exe
    except Exception as e:  # noqa: BLE001
        logger.debug("[binaries] imageio_ffmpeg.get_ffmpeg_exe failed: %r", e)

    import shutil
    return shutil.which("ffmpeg")


def _probe_fonts_dir() -> Optional[str]:
    """vendor/bundled_fonts/;不存在返 None。"""

    p = _vendor_root() / "bundled_fonts"
    return str(p) if p.is_dir() else None


def _probe_bgm_dir() -> Optional[str]:
    p = _vendor_root() / "bundled_bgm"
    return str(p) if p.is_dir() else None


def _probe_clips_dir() -> Optional[str]:
    p = _vendor_root() / "bundled_video_clips"
    return str(p) if p.is_dir() else None


def configure(*, strict: bool = False) -> BinariesState:
    """启动时调,探测 + 注入环境变量,返结果(同时写 module 级 _state)。

    strict=True 且 ImageMagick 不在时 raise — 配置面板检查用。普通启动
    路径 strict=False,失败仅 logger.warning,让 wizard 在用户尝试合成
    视频(TextClip)那一步才暴露错误,启动期不阻塞。
    """

    global _state
    state = BinariesState()

    state.imagemagick_path = _probe_imagemagick()
    if state.imagemagick_path:
        os.environ["IMAGEMAGICK_BINARY"] = state.imagemagick_path
        logger.info("[binaries] IMAGEMAGICK_BINARY = %s", state.imagemagick_path)
    else:
        msg = (
            f"未找到 ImageMagick(平台 {_platform_tag()}) — "
            f"vendor/services/imagemagick/<platform>/magick(.exe) 不存在,"
            f"系统 PATH 也无 magick/convert。字幕 TextClip 渲染会失败,"
            f"请把 ImageMagick portable 二进制按 vendor 约定放置。"
        )
        state.issues.append(msg)
        logger.warning("[binaries] %s", msg)

    state.ffmpeg_path = _probe_ffmpeg()
    if state.ffmpeg_path:
        os.environ["IMAGEIO_FFMPEG_EXE"] = state.ffmpeg_path
        logger.info("[binaries] IMAGEIO_FFMPEG_EXE = %s", state.ffmpeg_path)
    else:
        msg = (
            "未找到 ffmpeg — imageio-ffmpeg 包未装且系统 PATH 无 ffmpeg。"
            "moviepy 写视频/读音频会失败。"
        )
        state.issues.append(msg)
        logger.warning("[binaries] %s", msg)

    state.fonts_dir = _probe_fonts_dir()
    state.bgm_dir = _probe_bgm_dir()
    state.clips_dir = _probe_clips_dir()
    if state.fonts_dir is None:
        state.issues.append(
            "vendor/bundled_fonts/ 不存在;字幕渲染将依赖系统字体或用户 "
            "手动上传字体到 chayuan_root。"
        )
    if state.bgm_dir is None:
        state.issues.append(
            "vendor/bundled_bgm/ 不存在;前端 BGM 选择只能用用户上传。"
        )

    _state = state

    if strict and state.imagemagick_path is None:
        raise RuntimeError(
            "ImageMagick 不可用 — 视频字幕合成必需。详见 issues: "
            + "; ".join(state.issues)
        )
    return state


# ─────────────────────────────────────────────────────────────────────
# 查询接口
# ─────────────────────────────────────────────────────────────────────


def get_state() -> BinariesState:
    """返回最近一次 configure() 的结果;未调用过 return 空 state。"""

    return _state


def get_imagemagick_path() -> Optional[str]:
    return _state.imagemagick_path


def get_ffmpeg_path() -> Optional[str]:
    return _state.ffmpeg_path


def get_fonts_dir() -> Optional[str]:
    return _state.fonts_dir


def get_bgm_dir() -> Optional[str]:
    return _state.bgm_dir


def get_clips_dir() -> Optional[str]:
    return _state.clips_dir
