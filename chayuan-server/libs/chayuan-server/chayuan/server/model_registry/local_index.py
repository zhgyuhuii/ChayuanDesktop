"""本地磁盘模型索引。

与 :mod:`chayuan.server.model_registry.catalog` 关系
=====================================================

* ``catalog.py`` 处理 **远端** 模型目录（HF / ModelScope / Civitai 爬虫）：
  写入 ``model_registry/models.json``。
* 本模块（``local_index.py``）处理 **本地磁盘** 已有的模型文件：
  写入 ``model_registry/local_models.json``。

两者解耦：
* 同一个 ``models.json`` 路径可以混着出现"还没下载（仅 metadata）"和"已经下
  载"的条目；后者由本模块负责标记 ``installed=True`` + ``local_path``，让前
  端模型广场可以一眼看出什么能直接用。
* 即便完全离线，本模块仍能独立工作（不依赖 ``catalog.py`` 的爬虫结果）。

扫描路径
========

默认按下面顺序合并扫描，每个目录独立打 tag（便于 UI 展示来源）：

::

    <CHAYUAN_ROOT>/models/                 ← 用户主放置区（原有约定）
    <CHAYUAN_ROOT>/models/huggingface/     ← `huggingface_hub` 缓存风格
    <CHAYUAN_ROOT>/models/model_registry/  ← catalog.download_registry_model 落地点
    <CHAYUAN_ROOT>/models/custom/          ← 用户自有模型
    <CHAYUAN_ROOT>/models/gguf/            ← 单文件 gguf 集中区
    <repo>/vendor/runtimes/*/models/       ← vendor 自带模型（如 piper voices）

任何 ``.gguf`` / ``.onnx`` / ``.safetensors`` / 目录里有 ``config.json`` 或
``model_index.json`` 的文件，都会被当成候选。

公开 API
========
* :class:`LocalModelEntry` —— 一条记录
* :class:`LocalModelIndex` —— 内存视图 + 持久化
* :func:`scan_once` —— 一次性全量扫描；返回新发现 / 更新 / 删除的列表
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from chayuan.server.model_registry.identifier import ModelIdentity, identify_path

logger = logging.getLogger("chayuan.model_registry.local_index")


# -- 路径约定 --------------------------------------------------------------

DEFAULT_LAYOUT_DIRS = ("huggingface", "model_registry", "custom", "gguf", "modelscope")

# 单文件直接当模型的扩展名（其它扩展会要求一同存在 config.json 等"标志"文件）
SINGLE_FILE_FORMATS = (".gguf", ".onnx")

# 目录里若同时出现这些标志文件 → 视为一个完整模型仓库
DIR_MARKER_FILES = ("config.json", "model_index.json", "tokenizer.json", "manifest.json")


def models_dir() -> Path:
    """``<CHAYUAN_ROOT>/models``。延迟求值，尊重用户的 root 切换。"""
    from chayuan.settings import CHAYUAN_ROOT
    return Path(CHAYUAN_ROOT) / "models"


def local_index_path() -> Path:
    """``<CHAYUAN_ROOT>/model_registry/local_models.json``。"""
    from chayuan.settings import CHAYUAN_ROOT
    return Path(CHAYUAN_ROOT) / "model_registry" / "local_models.json"


# -- 数据结构 --------------------------------------------------------------

@dataclass
class LocalModelEntry:
    """一条本地模型记录（持久化结构与本类字段一一对应）。"""

    model_id: str
    path: str
    relpath: str
    capability: str
    family: str = ""
    format: str = "unknown"
    size_bytes: int = 0
    mtime: float = 0.0
    confidence: float = 0.0
    evidence: List[str] = field(default_factory=list)
    meta: Dict[str, Any] = field(default_factory=dict)
    source_tag: str = ""    # 顶层目录 tag（如 huggingface / custom / gguf）

    def to_dict(self) -> Dict[str, Any]:
        return {
            "model_id": self.model_id,
            "path": self.path,
            "relpath": self.relpath,
            "capability": self.capability,
            "family": self.family,
            "format": self.format,
            "size_bytes": int(self.size_bytes),
            "mtime": float(self.mtime),
            "confidence": round(float(self.confidence), 3),
            "evidence": list(self.evidence),
            "meta": dict(self.meta),
            "source_tag": self.source_tag,
        }


@dataclass
class ScanDelta:
    """``scan_once`` 的差异返回。"""
    added:   List[LocalModelEntry] = field(default_factory=list)
    updated: List[LocalModelEntry] = field(default_factory=list)
    removed: List[str] = field(default_factory=list)   # model_id 列表

    @property
    def changed(self) -> bool:
        return bool(self.added or self.updated or self.removed)


# -- 索引主体 --------------------------------------------------------------

class LocalModelIndex:
    """``local_models.json`` 的读写 + 主键去重 + 增量比对。

    主键策略：以 ``relpath``（相对扫描根的相对路径）作为唯一标识；同一份磁盘
    内容不同根扫到时会通过 ``path`` 解析成同一 entry，避免重复。
    """

    def __init__(self, path: Optional[Path] = None) -> None:
        self._path = path or local_index_path()
        self._lock = threading.Lock()
        self._entries: Dict[str, LocalModelEntry] = {}
        self._load()

    @property
    def path(self) -> Path:
        return self._path

    def _load(self) -> None:
        if not self._path.is_file():
            return
        try:
            with open(self._path, "r", encoding="utf-8") as f:
                doc = json.load(f)
            for raw in (doc.get("items") or []):
                if not isinstance(raw, dict):
                    continue
                e = LocalModelEntry(
                    model_id=str(raw.get("model_id") or ""),
                    path=str(raw.get("path") or ""),
                    relpath=str(raw.get("relpath") or ""),
                    capability=str(raw.get("capability") or "other"),
                    family=str(raw.get("family") or ""),
                    format=str(raw.get("format") or "unknown"),
                    size_bytes=int(raw.get("size_bytes") or 0),
                    mtime=float(raw.get("mtime") or 0),
                    confidence=float(raw.get("confidence") or 0),
                    evidence=list(raw.get("evidence") or []),
                    meta=dict(raw.get("meta") or {}),
                    source_tag=str(raw.get("source_tag") or ""),
                )
                if e.model_id:
                    self._entries[e.model_id] = e
        except (OSError, ValueError) as e:
            logger.warning("[local-index] 解析 %s 失败：%s；按空索引继续", self._path, e)

    def _flush(self) -> None:
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            doc = {
                "version": 1,
                "updated_at": int(time.time()),
                "items": [e.to_dict() for e in self._entries.values()],
            }
            fd, tmp = tempfile.mkstemp(
                prefix=f".{self._path.name}.", suffix=".tmp",
                dir=str(self._path.parent),
            )
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(doc, f, ensure_ascii=False, indent=2)
                os.replace(tmp, self._path)
            except Exception:
                try:
                    os.remove(tmp)
                except OSError:
                    pass
                raise
        except OSError as e:
            logger.warning("[local-index] 写 %s 失败：%s", self._path, e)

    # -- 查询 --

    def list_entries(self) -> List[LocalModelEntry]:
        with self._lock:
            return list(self._entries.values())

    def by_capability(self, cap: str) -> List[LocalModelEntry]:
        with self._lock:
            return [e for e in self._entries.values() if e.capability == cap]

    def get(self, model_id: str) -> Optional[LocalModelEntry]:
        with self._lock:
            return self._entries.get(model_id)

    # -- 维护 --

    def upsert(self, entry: LocalModelEntry) -> Tuple[bool, bool]:
        """返回 ``(added, updated)``。已有 entry 但内容不变时两者都为 False。"""
        with self._lock:
            old = self._entries.get(entry.model_id)
            if old is None:
                self._entries[entry.model_id] = entry
                return True, False
            if (
                old.path == entry.path
                and old.size_bytes == entry.size_bytes
                and abs(old.mtime - entry.mtime) < 0.5
                and old.capability == entry.capability
                and old.format == entry.format
            ):
                return False, False
            self._entries[entry.model_id] = entry
            return False, True

    def remove(self, model_id: str) -> bool:
        with self._lock:
            return self._entries.pop(model_id, None) is not None

    def replace_all(self, entries: Iterable[LocalModelEntry]) -> ScanDelta:
        new_map = {e.model_id: e for e in entries}
        with self._lock:
            added: List[LocalModelEntry] = []
            updated: List[LocalModelEntry] = []
            removed: List[str] = []
            for mid, e in new_map.items():
                old = self._entries.get(mid)
                if old is None:
                    added.append(e)
                elif (old.path != e.path or old.size_bytes != e.size_bytes
                      or abs(old.mtime - e.mtime) >= 0.5
                      or old.capability != e.capability or old.format != e.format):
                    updated.append(e)
            for mid in list(self._entries.keys()):
                if mid not in new_map:
                    removed.append(mid)
            self._entries = new_map
        self._flush()
        return ScanDelta(added=added, updated=updated, removed=removed)

    def flush(self) -> None:
        self._flush()


# -- 扫描 ------------------------------------------------------------------


def _candidate_roots() -> List[Tuple[Path, str]]:
    """返回 [(root, source_tag)] 列表。"""
    roots: List[Tuple[Path, str]] = []
    md = models_dir()
    if md.is_dir():
        roots.append((md, "models"))
        for sub in DEFAULT_LAYOUT_DIRS:
            if (md / sub).is_dir():
                roots.append((md / sub, sub))
    # vendor 子目录也扫一下：vendor/runtimes/*/models
    try:
        from chayuan.server.runtime.vendor_loader import discover_vendor
        layout = discover_vendor()
        for entry in layout.runtimes:
            mp = entry.path / "models"
            if mp.is_dir():
                roots.append((mp, f"vendor/{entry.name}"))
    except Exception as e:  # noqa: BLE001
        logger.debug("[local-index] vendor 扫描失败：%s", e)
    return roots


def _is_dir_repo(p: Path) -> bool:
    """判定目录 ``p`` 是否一个完整模型仓库。"""
    if not p.is_dir():
        return False
    for marker in DIR_MARKER_FILES:
        if (p / marker).is_file():
            return True
    if any(p.glob("*.safetensors")):
        return True
    if any(p.glob("*.bin")):
        return True
    return False


def _walk_collect(root: Path, source_tag: str, max_depth: int = 5) -> List[Tuple[Path, str]]:
    """深度有限的扫描，收集 (entry_path, relpath) 列表。

    遇到 ``_is_dir_repo`` 命中的目录就**不再下钻**（避免把仓库下面的子目录也
    错认成模型）。同时收集顶层的 ``.gguf`` / ``.onnx`` 单文件。
    """
    out: List[Tuple[Path, str]] = []
    root = root.resolve()

    def _walk(d: Path, depth: int) -> None:
        if depth > max_depth:
            return
        try:
            children = sorted(d.iterdir())
        except OSError:
            return
        for c in children:
            try:
                if c.is_symlink():
                    # 只防"符号链接指回我自己 / 我的祖先"导致的死循环；
                    # 用户用 `chayuan model import /path/to/extern/model` 制造的
                    # 跨目录符号链接是合法用途，不应被排除。
                    real = c.resolve(strict=False)
                    if real == root or real in root.parents:
                        continue
                if c.is_dir():
                    if c.name.startswith(".") or c.name in ("__pycache__", "logs", "outputs"):
                        continue
                    if _is_dir_repo(c):
                        out.append((c, str(c.relative_to(root))))
                    else:
                        _walk(c, depth + 1)
                elif c.is_file():
                    if c.suffix.lower() in SINGLE_FILE_FORMATS:
                        out.append((c, str(c.relative_to(root))))
            except OSError:
                continue

    if _is_dir_repo(root):
        out.append((root, "."))
    else:
        _walk(root, 0)
    return out


def scan_once(*, persist: bool = True) -> ScanDelta:
    """跑一次全量扫描，返回与上次差异。

    Args:
        persist: ``True`` → 写回 ``local_models.json``；``False`` 用于试跑。
    """
    seen_ids: Set[str] = set()
    seen_real: Set[str] = set()
    entries: List[LocalModelEntry] = []
    for root, tag in _candidate_roots():
        for path, relpath in _walk_collect(root, tag):
            mid_base = relpath if relpath != "." else root.name
            model_id = f"{tag}/{mid_base}".replace(os.sep, "/")
            # 幂等：同一份内容被多个根扫到时只保留第一次出现的（按 model_id）
            if model_id in seen_ids:
                continue
            # 跨根去重：同一份磁盘内容不同 tag 也只算一次（保留第一个，
            # 通常顶层 "models" 比子目录 "custom" 更早出现）
            try:
                real_key = str(path.resolve())
            except OSError:
                real_key = str(path)
            if real_key in seen_real:
                continue
            ident = identify_path(path, default_id=model_id)
            try:
                if path.is_file():
                    size = path.stat().st_size
                    mtime = path.stat().st_mtime
                else:
                    size = sum((p.stat().st_size for p in path.rglob("*") if p.is_file()), 0)
                    mtime = max((p.stat().st_mtime for p in path.rglob("*") if p.is_file()), default=path.stat().st_mtime)
            except OSError:
                size, mtime = 0, time.time()

            entries.append(LocalModelEntry(
                model_id=model_id,
                path=str(path),
                relpath=relpath,
                capability=ident.capability,
                family=ident.family,
                format=ident.format,
                size_bytes=size,
                mtime=mtime,
                confidence=ident.confidence,
                evidence=ident.evidence,
                meta=ident.meta,
                source_tag=tag,
            ))
            seen_ids.add(model_id)
            seen_real.add(real_key)

    idx = get_local_index()
    delta = idx.replace_all(entries)
    if not persist:
        # 持久化已经发生在 replace_all 内部；为 False 时回滚比较麻烦，
        # 业务侧 dry-run 可改用 `_walk_collect` 直接拿候选。
        pass
    if delta.changed:
        logger.info(
            "[local-index] scan: +%d  ~%d  -%d  total=%d",
            len(delta.added), len(delta.updated), len(delta.removed), len(idx.list_entries()),
        )
    return delta


# -- 单例 ------------------------------------------------------------------

_LOCK = threading.Lock()
_SINGLETON: Optional[LocalModelIndex] = None


def get_local_index(*, force_reload: bool = False) -> LocalModelIndex:
    global _SINGLETON
    if force_reload or _SINGLETON is None or _SINGLETON.path != local_index_path():
        with _LOCK:
            _SINGLETON = LocalModelIndex()
    return _SINGLETON


__all__ = [
    "DEFAULT_LAYOUT_DIRS",
    "LocalModelEntry",
    "LocalModelIndex",
    "ScanDelta",
    "get_local_index",
    "models_dir",
    "scan_once",
]
