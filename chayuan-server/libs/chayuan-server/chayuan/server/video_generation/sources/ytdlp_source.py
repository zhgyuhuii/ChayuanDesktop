"""yt-dlp 通用 URL 抓取 connector。

接 1000+ 视频站点(YouTube/bilibili/抖音/西瓜/头条/Twitter ...)。不做"搜索"
(yt-dlp 没有跨站点统一搜索 API),只做"用户粘 URL -> 下载"。MaterialsSection
用户在 URL 输入框粘链接 -> 调 download(url) 把视频拉到本地 vg_materials。

法律风险用户自负;UI 上有显眼"仅限 CC0/自有素材"提示。
"""
from __future__ import annotations

import logging
import os
import uuid
from typing import Optional

from chayuan.server.video_generation.sources import register_source

logger = logging.getLogger("chayuan.video_generation.sources.ytdlp")


class YtdlpSource:
    name = "ytdlp"
    requires_api_key = False

    def search(self, query: str, aspect: str = "9:16", limit: int = 10) -> list:
        # yt-dlp 不做统一搜索;返空让 UI 不暴露"搜索"按钮,只暴露"粘 URL"
        return []

    def download(self, url: str, save_dir: str) -> Optional[str]:
        try:
            import yt_dlp  # type: ignore[import-not-found]
        except Exception as e:  # noqa: BLE001
            logger.warning("[ytdlp] yt_dlp 未装,跳过: %r", e)
            return None
        os.makedirs(save_dir, exist_ok=True)
        target = os.path.join(save_dir, f"ytdlp-{uuid.uuid4().hex[:8]}.%(ext)s")
        opts = {
            "outtmpl": target,
            "format": "best[ext=mp4]/best",
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            # 限大小防爆磁盘
            "max_filesize": 200 * 1024 * 1024,  # 200 MB
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
                # 真正落盘的文件路径
                if info and "requested_downloads" in info:
                    rd = info["requested_downloads"]
                    if rd and "filepath" in rd[0]:
                        return rd[0]["filepath"]
                # fallback 用 prepare_filename
                fn = ydl.prepare_filename(info)
                return fn if os.path.isfile(fn) else None
        except Exception as e:  # noqa: BLE001
            logger.warning("[ytdlp] download %s 失败: %r", url, e)
            return None


register_source(YtdlpSource())
