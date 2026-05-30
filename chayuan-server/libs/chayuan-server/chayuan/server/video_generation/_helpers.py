"""视频生成模块内部小工具。

从上游 chayuan-video-generation/app/utils/{file_security,utils}.py 中
拷贝**仅**视频合成步骤会用到的子集,避免污染 chayuan.server.utils 全局
命名空间。

收纳:
    resolve_path_within_directory  — 路径越权校验(防 ../ 逃逸)
    md5_for_file                   — moviepy 缓存命中需要
    storage_dir / task_dir / font_dir / song_dir / clips_dir
                                   — 跟 chayuan_root 锚定的存储路径,
                                     vendor bundled 资源由 binaries.py
                                     统一解析(M1.C9),这里先用 chayuan_root
                                     子目录占位
    parse_extension                — 取文件扩展名(小写无前缀点)
    PUNCTUATIONS 等常量直接从 const.py 取,这里不重复
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Optional


def resolve_path_within_directory(
    base_dir: str,
    unsafe_path: str,
    *,
    require_file: bool = True,
) -> str:
    """统一解析用户传入路径,校验仍在 base_dir 白名单目录内。

    适用于上传目录、素材目录、任务产物目录;比简单字符串前缀判断可靠(覆盖
    符号链接、Windows 不同盘符、相对路径中的 ``../``)。

    Raises:
        ValueError: 路径越权或文件不存在(require_file=True 时)。
    """
    if not unsafe_path:
        raise ValueError("empty path is not allowed")

    base_dir_real = os.path.realpath(base_dir)
    candidate_path = unsafe_path
    if not os.path.isabs(candidate_path):
        candidate_path = os.path.join(base_dir_real, candidate_path)

    resolved_path = os.path.realpath(candidate_path)
    try:
        common_path = os.path.commonpath([base_dir_real, resolved_path])
    except ValueError as exc:
        # Windows 下不同盘符会触发 ValueError,这类路径一定不属于允许目录
        raise ValueError("path is outside the allowed directory") from exc

    if common_path != base_dir_real:
        raise ValueError("path is outside the allowed directory")

    if require_file and not os.path.isfile(resolved_path):
        raise ValueError("file does not exist")

    return resolved_path


def md5_for_file(file_path: str, chunk_size: int = 1 << 20) -> Optional[str]:
    """流式算文件 MD5,返回 hex digest。文件不存在返 None。

    moviepy 缓存命中 / 素材去重 / 任务结果指纹 都用得上。
    """
    if not os.path.isfile(file_path):
        return None
    h = hashlib.md5()
    with open(file_path, "rb") as f:
        for block in iter(lambda: f.read(chunk_size), b""):
            h.update(block)
    return h.hexdigest()


def md5(text: str) -> str:
    """字符串 MD5 hex(上游 utils.md5)。素材下载用 URL 算稳定文件名。"""
    return hashlib.md5(str(text).encode("utf-8")).hexdigest()


def to_json(obj: Any) -> str:
    """对象 → JSON 字符串(上游 utils.to_json),递归处理自定义对象 / bytes。

    materials.download_videos 出错日志、get_api_key 报错都用它;之前 _helpers
    漏了这个函数 → 下载异常处理时自身又抛 AttributeError,掩盖真因 + 中断整批下载。
    """
    def _serialize(o: Any) -> Any:
        if isinstance(o, (int, float, bool, str)) or o is None:
            return o
        if isinstance(o, bytes):
            return "*** binary data ***"
        if isinstance(o, dict):
            return {k: _serialize(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [_serialize(i) for i in o]
        if hasattr(o, "__dict__"):
            return _serialize(vars(o))
        return None

    try:
        return json.dumps(_serialize(obj), ensure_ascii=False, indent=2)
    except Exception:  # noqa: BLE001
        return str(obj)


# ─────────────────────────────────────────────────────────────────────
# 路径解析 — 锚定 chayuan_root,vendor bundled 资源 fallback 由 M1.C9
# binaries.py 统一处理
# ─────────────────────────────────────────────────────────────────────


def _chayuan_root() -> Path:
    """主数据根目录 — 跟 chayuan.settings.CHAYUAN_ROOT 对齐。

    单独包成 fn 避免 import 时即时求值;懒解析方便测试中替换。
    """

    try:
        from chayuan.settings import CHAYUAN_ROOT  # type: ignore
        return Path(CHAYUAN_ROOT)
    except Exception:  # noqa: BLE001
        # 测试 / 早期启动场景:fallback 到 ~/.chayuan
        return Path.home() / ".chayuan"


def storage_dir(sub_dir: str = "", *, create: bool = False) -> str:
    """``<CHAYUAN_ROOT>/video_generation/storage[/<sub>]``。"""

    d = _chayuan_root() / "video_generation" / "storage"
    if sub_dir:
        d = d / sub_dir
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return str(d)


def voice_clones_dir(*, create: bool = False) -> str:
    """克隆音色样本目录 ``<CHAYUAN_ROOT>/video_generation/storage/voice_clones``。
    每个克隆音色:``<id>.wav``(参考人声,24k mono)+ ``<id>.json``(name/ref_text)。
    随用户数据保留,跨重建不丢。"""
    return storage_dir("voice_clones", create=create)


def digital_human_dir(*, create: bool = False) -> str:
    """数字人用户数据根 ``<CHAYUAN_ROOT>/data/digital_human``(预设 + 上传形象)。"""
    d = _chayuan_root() / "data" / "digital_human"
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return str(d)


def dh_avatars_dir(*, create: bool = False) -> str:
    """用户上传形象目录 ``.../data/digital_human/avatars``。"""
    d = _chayuan_root() / "data" / "digital_human" / "avatars"
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return str(d)


def dh_products_dir(*, create: bool = False) -> str:
    """商品图目录 ``.../data/digital_human/products``(数字人讲解用,只存本机)。"""
    d = _chayuan_root() / "data" / "digital_human" / "products"
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return str(d)


def dh_presets_path() -> str:
    """数字人预设清单 ``.../data/digital_human/presets.json``。"""
    return str(_chayuan_root() / "data" / "digital_human" / "presets.json")


def task_dir(task_id: str, *, create: bool = True) -> str:
    """``<CHAYUAN_ROOT>/video_generation/storage/tasks/<task_id>/``。"""

    d = _chayuan_root() / "video_generation" / "storage" / "tasks" / task_id
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return str(d)


def font_dir() -> str:
    """字体根目录 — M1 阶段占位指向 chayuan_root/video_generation/fonts;
    M1.C9 binaries.py 启动时会用 vendor/bundled_fonts/ 内容 seed/sync 到此处
    或直接通过 IMAGEMAGICK 字体扫描路径暴露给 moviepy。
    """

    d = _chayuan_root() / "video_generation" / "fonts"
    d.mkdir(parents=True, exist_ok=True)
    return str(d)


def song_dir() -> str:
    """BGM 根目录 — 用户上传 + vendor/bundled_bgm 内置 BGM 合并视图。

    M1 占位实现:只看 chayuan_root 下的用户目录;
    M1.C9/M3 时 binaries.py 把 vendor/bundled_bgm 软链/复制过来或在
    bgm_index 层 union 两源,前端列表自然合并。
    """

    d = _chayuan_root() / "video_generation" / "bgm"
    d.mkdir(parents=True, exist_ok=True)
    return str(d)


def clips_dir() -> str:
    """内置离线素材片段目录(可选,full 包预装)。"""

    d = _chayuan_root() / "video_generation" / "clips"
    d.mkdir(parents=True, exist_ok=True)
    return str(d)


def parse_extension(filename: str) -> str:
    """取小写无前缀点的扩展名;空/无扩展返空串。"""

    return Path(filename).suffix.lower().lstrip(".")
