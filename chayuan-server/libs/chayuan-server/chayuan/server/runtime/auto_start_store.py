"""本地服务的"是否随 chayuan-server 启动时自动拉起"持久化设置。

用单个文件 ``<CHAYUAN_ROOT>/data/sidecar_settings.json``:

  {
    "auto_start": {
      "rapidocr":        true,
      "chat":            false,
      "embedding":       false,
      "rerank":          false,
      "asr":             false,
      "image-embedding": false
    }
  }

兼容老 schema(rapidocr_lifecycle 一开始用的扁平字段 ``rapidocr_auto_start``):
读取时若没有 ``auto_start`` 字典 + 有老字段,自动迁移。

为什么默认值有差异:
  - rapidocr 默认 ``true`` — 装了就能用(用户报 OCR 该开箱即用)
  - 5 个 capability 默认 ``false`` — 老用户原本就是手动启,贸然全开会拉起一堆没装
    模型的进程出 failed 状态污染 UI;用户在 UI 显式打开后再生效。
"""
from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, Iterable

logger = logging.getLogger("chayuan.runtime.auto_start_store")

_SETTINGS_FILE_NAME = "sidecar_settings.json"
_LOCK = threading.Lock()

# 各 key 默认值 — 装了就该用的(OCR)默认开;其它显式打开
_DEFAULTS: Dict[str, bool] = {
    "rapidocr": True,
    "chat": False,
    "embedding": False,
    "rerank": False,
    "asr": False,
    "image-embedding": False,
}

# UI / 前端用的所有已知 key — POST .../auto-start 会校验
KNOWN_KEYS = tuple(_DEFAULTS.keys())


def _settings_path() -> Path:
    """<CHAYUAN_ROOT>/data/sidecar_settings.json。"""
    from chayuan.settings import Settings
    base = Path(Settings.basic_settings.DATA_PATH)
    base.mkdir(parents=True, exist_ok=True)
    return base / _SETTINGS_FILE_NAME


def _read_raw() -> Dict[str, Any]:
    p = _settings_path()
    if not p.is_file():
        return {}
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError) as e:
        logger.warning("[auto-start-store] 读 %s 失败: %r;视作空配置", p, e)
        return {}


def _read_auto_start_dict() -> Dict[str, bool]:
    """读 auto_start 字典;兼容老的扁平 ``rapidocr_auto_start`` 字段。"""
    raw = _read_raw()
    auto = raw.get("auto_start") or {}
    if not isinstance(auto, dict):
        auto = {}
    auto_norm: Dict[str, bool] = {k: bool(v) for k, v in auto.items()}
    # 兼容老 schema:rapidocr_lifecycle 早期写过扁平 ``rapidocr_auto_start``
    legacy = raw.get("rapidocr_auto_start")
    if "rapidocr" not in auto_norm and isinstance(legacy, bool):
        auto_norm["rapidocr"] = legacy
    return auto_norm


def _write_raw(data: Dict[str, Any]) -> None:
    p = _settings_path()
    tmp = p.with_suffix(p.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)


def get(key: str) -> bool:
    """返回 key 的 auto-start 值;未设过返默认。"""
    with _LOCK:
        return bool(_read_auto_start_dict().get(key, _DEFAULTS.get(key, False)))


def set_(key: str, enabled: bool) -> bool:
    """设置某个 key 的 auto-start 并持久化。返回写入后的值。"""
    with _LOCK:
        raw = _read_raw()
        auto = dict(_read_auto_start_dict())
        auto[key] = bool(enabled)
        raw["auto_start"] = auto
        # 同时清理掉老的扁平字段(以新 schema 为准)
        raw.pop("rapidocr_auto_start", None)
        _write_raw(raw)
        logger.info("[auto-start-store] %s := %s", key, enabled)
        return bool(enabled)


def list_all(keys: Iterable[str] | None = None) -> Dict[str, bool]:
    """返回 {key: auto_start} 字典;keys 不给就返已知全集。"""
    target = list(keys) if keys is not None else list(KNOWN_KEYS)
    with _LOCK:
        stored = _read_auto_start_dict()
    return {k: bool(stored.get(k, _DEFAULTS.get(k, False))) for k in target}
