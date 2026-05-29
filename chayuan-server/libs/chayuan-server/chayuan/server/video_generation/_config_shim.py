"""上游 config.app 字典调用 → chayuan-server Settings 桥接层。

上游 chayuan-video-generation 用 ``app.config.config.app.get("key")`` 这种
"全局 dict" 风格读配置(原本来自 ``config.toml``)。本项目用 pydantic-
settings 的 ``Settings`` 单例,字段类型严格。为避免大面积改 materials /
tts / 等模块里的零散 ``config.app.get(...)`` 调用,这里提供一个轻量
shim:

    from .._config_shim import vg_config as config
    config.app.get("pexels_api_keys")   # → Settings.video_generation 子段或 ENV

支持的配置键(按上游需求穷举):
    pexels_api_keys      list[str] | str  CHAYUAN_VG_PEXELS_API_KEYS(逗号分隔)
    pixabay_api_keys     list[str] | str  CHAYUAN_VG_PIXABAY_API_KEYS
    material_directory   str              CHAYUAN_VG_MATERIAL_DIR("task" 表示
                                          按 task 隔离存放,其它字符串当固定目录)
    tls_verify           bool             CHAYUAN_VG_TLS_VERIFY (默认 True)
    edge_tts_timeout     int              CHAYUAN_VG_EDGE_TTS_TIMEOUT (秒)

未来 M2/M3 加更多源时,只需在 _VG_KEYS 注册;调用方零改动。

为什么不直接走 ``chayuan.settings``:
    chayuan.settings 字段是强类型 pydantic 字段,加新字段要改主 settings
    schema + 配置面板;视频生成模块属"集成进来的子系统",其外部 API key
    这类配置走 ENV 变量更轻量,不污染主 settings。
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, List, Optional

logger = logging.getLogger("chayuan.video_generation.config_shim")


def _get_env(name: str, default: Any = None) -> Any:
    """读 ENV,大小写不敏感。"""

    v = os.environ.get(name)
    if v is None:
        v = os.environ.get(name.lower())
    return v if v is not None else default


def _csv(value: Optional[str]) -> List[str]:
    """逗号分隔字符串 → list[str],strip 空白,丢弃空元素。"""

    if not value:
        return []
    return [s.strip() for s in str(value).split(",") if s.strip()]


def _bool(value: Any, default: bool = True) -> bool:
    """松字符串解析:'0/false/no/off' 均 False,空/None 走 default。"""

    if value is None:
        return default
    if isinstance(value, bool):
        return value
    s = str(value).strip().lower()
    if s in ("1", "true", "yes", "on"):
        return True
    if s in ("0", "false", "no", "off"):
        return False
    return default


# 配置键 → (env 变量名, 默认值, 类型转换 fn)
_VG_KEYS = {
    "pexels_api_keys": ("CHAYUAN_VG_PEXELS_API_KEYS", "", _csv),
    "pixabay_api_keys": ("CHAYUAN_VG_PIXABAY_API_KEYS", "", _csv),
    "material_directory": ("CHAYUAN_VG_MATERIAL_DIR", "task", str),
    "tls_verify": ("CHAYUAN_VG_TLS_VERIFY", True, lambda v: _bool(v, True)),
    "edge_tts_timeout": ("CHAYUAN_VG_EDGE_TTS_TIMEOUT", 30, int),
}


# api_key 类配置键 → vg_sources_config 表里的 source_name。
# 用户在「素材设置」面板录入的 key 存这张表(/sources/config),合成时也得从这读。
_KEY_TO_SOURCE = {
    "pexels_api_keys": "pexels",
    "pixabay_api_keys": "pixabay",
}


def _keys_from_sources_config(cfg_key: str) -> List[str]:
    """从 vg_sources_config 表读对应源的 api_key,支持多 key(逗号/换行分隔,轮换用)。

    返回 key 列表(可能空)。失败不再静默吞 —— 记 warning+exc_info,
    否则"配了 key 却报没配"这类问题永远查不到真因(见血泪纪律)。
    """
    source = _KEY_TO_SOURCE.get(cfg_key)
    if not source:
        return []
    try:
        from chayuan.server.video_generation.sources import config_store
        cfg = config_store.get_config(source, reveal=True)  # type: ignore[call-arg]
    except Exception:  # noqa: BLE001
        logger.warning(
            "[vg_config] 读取在线源 %s 的 api_key 失败(vg_sources_config)",
            source, exc_info=True,
        )
        return []
    raw = (cfg or {}).get("api_key") or ""
    return [k.strip() for k in re.split(r"[,\n]", str(raw)) if k.strip()]


class _AppProxy:
    """模拟上游 ``config.app`` dict 行为(get/dict-like)。"""

    def get(self, key: str, default: Any = None) -> Any:
        spec = _VG_KEYS.get(key)
        if spec is None:
            # 未注册的键:回 default,跟上游 dict.get 行为一致
            return default
        env_name, fallback_default, conv = spec
        raw = _get_env(env_name)
        if raw is not None and raw != "":
            try:
                return conv(raw)
            except Exception:  # noqa: BLE001
                pass
        # ENV 未配 → 回落到 vg_sources_config 表(素材设置面板录入的 key)。
        # 多 key 时返回 list,get_api_key 会轮换(对齐上游 pexels_api_keys 列表)。
        db_keys = _keys_from_sources_config(key)
        if db_keys:
            return db_keys if len(db_keys) > 1 else db_keys[0]
        return fallback_default if default is None else default

    def __contains__(self, key: str) -> bool:
        return key in _VG_KEYS

    def __getitem__(self, key: str) -> Any:
        v = self.get(key)
        if v is None:
            raise KeyError(key)
        return v


class _VgConfig:
    """模拟上游 ``config`` 模块顶层对象。"""

    def __init__(self) -> None:
        self.app = _AppProxy()
        self.config_file = "<chayuan-server Settings,无 toml 文件>"

    @property
    def proxy(self):
        """上游 ``config.proxy``:requests 的 proxies 参数(dict 或 None)。

        上游来自 config.toml ``[proxy]`` 段。本项目默认 None —— ``requests``
        收到 ``proxies=None`` 会自动读取 HTTP_PROXY / HTTPS_PROXY 环境变量,
        所以单机版用户配了系统代理也能走通。若要显式指定,设
        ``CHAYUAN_VG_HTTP_PROXY`` / ``CHAYUAN_VG_HTTPS_PROXY``。
        """
        http = _get_env("CHAYUAN_VG_HTTP_PROXY")
        https = _get_env("CHAYUAN_VG_HTTPS_PROXY")
        proxies = {}
        if http:
            proxies["http"] = http
        if https:
            proxies["https"] = https
        return proxies or None


vg_config = _VgConfig()
