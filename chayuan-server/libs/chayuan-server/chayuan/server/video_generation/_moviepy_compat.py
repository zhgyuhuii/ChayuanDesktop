"""moviepy 2.1.2 与新版 ffmpeg(8.x / Lavf62+)输出格式的兼容补丁。

## 背景

moviepy 2.1.2 的 ``FFmpegInfosParser.parse_metadata_field_value`` 用
``line.split(":", 1)`` 解包成 ``(field, value)``,**假设每条 metadata / side-data
行都含冒号**。新版 ffmpeg 在 stream 信息里会输出无冒号的 side-data 行,例如
pexels 用 ffmpeg 8 编码的素材:

    Stream #0:0(und): Video: h264 ...
        Side data:
          Ambient Viewing Environment, ambient_illuminance=314.0, ambient_light_x=...

``Ambient Viewing Environment, ...`` 这行没有冒号 → ``split(":", 1)`` 只返回 1 个
元素 → 元组解包 ``ValueError`` → 被 ``ffmpeg_parse_infos`` 包成
"Error passing `ffmpeg -i` command output" → moviepy 认为文件无效。表现为下载到
合法素材却被全部判废、合成「没有可用素材」。

## 修法

monkey-patch 该方法:无冒号行返回 ``("", stripped_line)``。空 field 会走 moviepy
已有的「多行 metadata 续行」分支(挂到上一字段 ``Side data`` 上),不再崩溃。

幂等:重复调用安全(已打过补丁则直接返回)。在 video_generation 包 ``__init__``
导入时调用一次,保证主进程与 multiprocessing 子进程(各自重 import)都生效。
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_PATCH_FLAG = "_chayuan_no_colon_safe"


def safe_parse_metadata_field_value(line: str) -> tuple[str, str]:
    """moviepy ``parse_metadata_field_value`` 的容错版(纯函数,便于单测)。

    有冒号:按 ``"field: value"`` 拆分(同 moviepy 原逻辑)。
    无冒号(如新 ffmpeg 的 "Ambient Viewing Environment, ...")返回 ``("", line)``,
    空 field 会走 moviepy 的多行续行分支,不再触发 ``split`` 解包 ValueError。
    """
    if ":" not in line:
        return ("", line.strip(" "))
    raw_field, raw_value = line.split(":", 1)
    return (raw_field.strip(" "), raw_value.strip(" "))


def apply_moviepy_compat_patches() -> None:
    """给 moviepy 的 ffmpeg 输出解析器打兼容补丁(幂等)。"""
    try:
        from moviepy.video.io import ffmpeg_reader
    except Exception as e:  # noqa: BLE001 — moviepy 不可用时静默跳过,合成阶段自有报错
        logger.warning("[vg] moviepy 兼容补丁跳过:import ffmpeg_reader 失败: %r", e)
        return

    parser_cls = getattr(ffmpeg_reader, "FFmpegInfosParser", None)
    if parser_cls is None:
        # 兜底:frozen(PyInstaller)下若该类被改名/重定位,按"含
        # parse_metadata_field_value 方法"扫模块里任意类,robust 到重命名。
        import inspect
        cands = [
            obj for _name, obj in vars(ffmpeg_reader).items()
            if inspect.isclass(obj) and hasattr(obj, "parse_metadata_field_value")
        ]
        if cands:
            parser_cls = cands[0]
            logger.info(
                "[vg] FFmpegInfosParser 直接 getattr 没到,按方法扫到 %s,继续打补丁",
                parser_cls.__name__,
            )
        else:
            # 打全诊断:到底装的哪个 moviepy、模块里有哪些类 —— 便于定位
            # 为何 frozen 找不到(dev 能找到)。
            try:
                import moviepy as _mp
                _ver = getattr(_mp, "__version__", "?")
                _file = getattr(_mp, "__file__", "?")
            except Exception:  # noqa: BLE001
                _ver = _file = "?"
            _classes = [n for n, o in vars(ffmpeg_reader).items() if inspect.isclass(o)]
            logger.warning(
                "[vg] moviepy 兼容补丁跳过:未找到 FFmpegInfosParser"
                "(moviepy=%s @ %s;ffmpeg_reader=%s;含类=%s)",
                _ver, _file, getattr(ffmpeg_reader, "__file__", "?"), _classes,
            )
            return

    orig = getattr(parser_cls, "parse_metadata_field_value", None)
    if orig is None or getattr(orig, _PATCH_FLAG, False):
        return  # 没这个方法 / 已打过补丁

    def parse_metadata_field_value(self, line):  # noqa: ANN001, ANN202
        # 无冒号行(如新 ffmpeg 的 "Ambient Viewing Environment, ...")返回空
        # field,交给 moviepy 已有的续行逻辑,避免 split 解包 ValueError。
        return safe_parse_metadata_field_value(line)

    parse_metadata_field_value._chayuan_no_colon_safe = True  # type: ignore[attr-defined]
    parser_cls.parse_metadata_field_value = parse_metadata_field_value
    logger.info("[vg] 已应用 moviepy ffmpeg 输出解析兼容补丁(无冒号 side-data 行)")
