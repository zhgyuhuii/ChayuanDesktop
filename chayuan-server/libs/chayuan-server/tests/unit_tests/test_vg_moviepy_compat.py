"""moviepy ffmpeg 输出解析兼容补丁回归测试。

复现:新版 ffmpeg(pexels 用 Lavf62 编码)的素材在 stream 信息里带无冒号的
side-data 行,moviepy 2.1.2 原 ``split(":", 1)`` 会解包崩溃。补丁后这类行被
容错处理为空 field(走 moviepy 续行逻辑)。
"""

import pytest

from chayuan.server.video_generation._moviepy_compat import (
    safe_parse_metadata_field_value,
)


# 触发 moviepy 崩溃的真实 side-data 行(无冒号)。
_NO_COLON = (
    "        Ambient Viewing Environment, ambient_illuminance=314.000000, "
    "ambient_light_x=0.312700, ambient_light_y=0.329000"
)


def test_original_moviepy_logic_crashes_on_no_colon_line():
    """佐证根因:moviepy 原逻辑 split(':',1) 在无冒号行上解包 ValueError。"""
    with pytest.raises(ValueError):
        _field, _value = _NO_COLON.split(":", 1)  # 原 moviepy 写法


def test_safe_parse_no_colon_returns_empty_field():
    """无冒号行返回空 field + 原文(空 field 触发 moviepy 续行分支)。"""
    field, value = safe_parse_metadata_field_value(_NO_COLON)
    assert field == ""
    assert value.startswith("Ambient Viewing Environment")


def test_safe_parse_normal_field_unchanged():
    """正常 "field : value" 行行为与 moviepy 原逻辑一致。"""
    assert safe_parse_metadata_field_value("    encoder         : Lavc62.28.101 libx264") == (
        "encoder",
        "Lavc62.28.101 libx264",
    )
    assert safe_parse_metadata_field_value("      Side data:") == ("Side data", "")


def test_safe_parse_value_with_colon_keeps_remainder():
    """值里含冒号只按首个冒号拆分。"""
    assert safe_parse_metadata_field_value("  handler_name : a:b:c") == (
        "handler_name",
        "a:b:c",
    )
