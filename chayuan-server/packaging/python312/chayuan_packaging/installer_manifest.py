"""layout.yaml → 归一化 InstallerManifest（皮 resolveComponents 消费）。

复用 manifest.Layout/Resource;只解析 http(s)/hf-mirror 直链(离线可算),
github:// 源发出 ``github://owner/repo#asset`` 引用(下载侧解析,[VERIFY])。
"""
from __future__ import annotations

import os
from typing import Optional

from chayuan_packaging.manifest import Layout, Resource

ALL_PLATFORMS = [
    "linux-x86_64", "linux-arm64",
    "mac-x86_64", "mac-arm64",
    "win-x86_64", "win-arm64",
]
ALL_TIERS = ["lite", "standard", "pro"]


def _hf_mirror_host() -> str:
    return os.environ.get("HF_MIRROR_URL", "https://hf-mirror.com").rstrip("/")


def resolve_asset_url(resource: Resource, platform: str) -> Optional[str]:
    """把 resource+platform 解析成一个具体下载 URL。
    - source=https://...{platform_tag}.{ext} → 用 matrix 行变量插值
    - source=hf-mirror://repo + file → hf-mirror 直链
    - source=github://owner/repo → 返 ``github://owner/repo#<asset_pattern>``(下载侧解析)
    - 无法解析 → None
    """
    row = resource.matrix_for(platform)
    if row is None:
        return None
    source = resource.source or ""
    # hf-mirror 模型直链
    if source.startswith("hf-mirror://") or resource.repo:
        repo = resource.repo or source[len("hf-mirror://"):]
        fname = resource.file or row.get("asset", "")
        if repo and fname:
            return f"{_hf_mirror_host()}/{repo}/resolve/main/{fname}"
        return None
    # github://owner/repo → 引用(asset 在 matrix 行)
    if source.startswith("github://"):
        asset = row.get("asset", "")
        return f"{source}#{asset}" if asset else source
    # http(s) 模板:用 matrix 行变量 + version 插值
    if source.startswith(("http://", "https://")):
        url = source
        repl = {"version": resource.version, **row}
        for k, v in repl.items():
            url = url.replace("{" + str(k) + "}", str(v))
        return url
    # matrix 行自带完整 url
    if isinstance(row.get("source"), str) and row["source"].startswith(("http", "github://")):
        return row["source"]
    return None


def build_installer_manifest(layout: Layout, *, version: str = "0.0.0") -> dict:
    """遍历全部 resource × 6 平台 → 归一化 manifest dict。"""
    components = []
    for r in layout.all_resources():
        platforms = {}
        for plat in ALL_PLATFORMS:
            url = resolve_asset_url(r, plat)
            if not url:
                continue
            platforms[plat] = {"url": url, "unpack": r.unpack or "none"}
        if not platforms:
            continue
        tiers = list(r.release_tags) if r.release_tags else list(ALL_TIERS)
        components.append({
            "name": r.name,
            "tiers": tiers,
            "dest": r.dest,
            "optional": bool(r.optional),
            "platforms": platforms,
        })
    return {"version": version, "components": components}
