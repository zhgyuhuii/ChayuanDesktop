"""在线素材搜索 + 下载(原 chayuan-video-generation/app/services/material.py)。

迁移自上游 MoneyPrinterTurbo 1.2.7,做了以下改造:

- ``from loguru import logger`` → ``logging.getLogger("chayuan.video_generation.materials")``
- ``from app.config import config`` → ``video_generation._config_shim.vg_config``
  (一个轻量包装,把上游 ``config.app.get("pexels_api_keys")`` 这种 dict 风格调用
   桥接到 chayuan-server Settings;不引入新 toml 配置文件)
- 绝对 import 改相对 import
- ``logger.success`` (loguru 独有) → ``logger.info``
- 删除 ``if __name__ == "__main__"`` 测试块

定位:本模块只负责"在线源"分支(Pexels / Pixabay),前端 Wizard step 3
默认走"本地素材库"路径(M1.C11 store/materials.py + uploads)— 不联网
也能用。在线搜索仅在用户切到对应 tab + 配置好 API Key 时启用。
"""
from __future__ import annotations

import math
import os
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable, List, Optional
from urllib.parse import urlencode

import requests
import logging

logger = logging.getLogger("chayuan.video_generation.materials")
from moviepy.video.io.VideoFileClip import VideoFileClip

from chayuan.server.video_generation._config_shim import vg_config as config
from ..schemas import MaterialInfo, VideoAspect, VideoConcatMode
from .. import _helpers as utils

# Thread-safe counter for API key rotation
_api_key_counter = 0
_api_key_lock = threading.Lock()


def _get_tls_verify() -> bool:
    # 默认开启 TLS 证书校验，防止素材搜索和下载过程被中间人篡改。
    # 仅在企业代理、自签证书等明确需要的场景下，允许用户通过
    # `config.toml` 显式设置 `tls_verify = false` 临时关闭。
    tls_verify = config.app.get("tls_verify", True)
    if isinstance(tls_verify, str):
        tls_verify = tls_verify.strip().lower() not in ("0", "false", "no", "off")

    if not tls_verify:
        logger.warning(
            "TLS certificate verification is disabled by config.app.tls_verify=false. "
            "Only use this in trusted proxy environments."
        )

    return bool(tls_verify)


def get_api_key(cfg_key: str):
    api_keys = config.app.get(cfg_key)
    if not api_keys:
        raise ValueError(
            f"\n\n##### {cfg_key} is not set #####\n\nPlease set it in the config.toml file: {config.config_file}\n\n"
            f"{utils.to_json(config.app)}"
        )

    # if only one key is provided, return it
    if isinstance(api_keys, str):
        return api_keys

    global _api_key_counter
    with _api_key_lock:
        _api_key_counter += 1
        return api_keys[_api_key_counter % len(api_keys)]


def search_videos_pexels(
    search_term: str,
    minimum_duration: int,
    video_aspect: VideoAspect = VideoAspect.portrait,
) -> List[MaterialInfo]:
    aspect = VideoAspect(video_aspect)
    video_orientation = aspect.name
    video_width, video_height = aspect.to_resolution()
    api_key = get_api_key("pexels_api_keys")
    headers = {
        "Authorization": api_key,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    }
    # Build URL
    params = {"query": search_term, "per_page": 20, "orientation": video_orientation}
    query_url = f"https://api.pexels.com/videos/search?{urlencode(params)}"
    logger.info(f"searching videos: {query_url}, with proxies: {config.proxy}")

    try:
        r = requests.get(
            query_url,
            headers=headers,
            proxies=config.proxy,
            verify=_get_tls_verify(),
            timeout=(30, 60),
        )
        response = r.json()
        video_items = []
        if "videos" not in response:
            logger.error(f"search videos failed: {response}")
            return video_items
        videos = response["videos"]
        # loop through each video in the result
        for v in videos:
            duration = v["duration"]
            # check if video has desired minimum duration
            if duration < minimum_duration:
                continue
            video_files = v["video_files"]
            # loop through each url to determine the best quality
            for video in video_files:
                w = int(video["width"])
                h = int(video["height"])
                if w == video_width and h == video_height:
                    item = MaterialInfo()
                    item.provider = "pexels"
                    item.url = video["link"]
                    item.duration = duration
                    item.image = v.get("image", "")  # 预览帧缩略图
                    video_items.append(item)
                    break
        return video_items
    except Exception as e:
        logger.error(f"search videos failed: {str(e)}")

    return []


def search_videos_pixabay(
    search_term: str,
    minimum_duration: int,
    video_aspect: VideoAspect = VideoAspect.portrait,
) -> List[MaterialInfo]:
    aspect = VideoAspect(video_aspect)

    video_width, video_height = aspect.to_resolution()

    api_key = get_api_key("pixabay_api_keys")
    # Build URL
    params = {
        "q": search_term,
        "video_type": "all",  # Accepted values: "all", "film", "animation"
        "per_page": 50,
        "key": api_key,
    }
    query_url = f"https://pixabay.com/api/videos/?{urlencode(params)}"
    logger.info(f"searching videos: {query_url}, with proxies: {config.proxy}")

    try:
        r = requests.get(
            query_url, proxies=config.proxy, verify=_get_tls_verify(), timeout=(30, 60)
        )
        response = r.json()
        video_items = []
        if "hits" not in response:
            logger.error(f"search videos failed: {response}")
            return video_items
        videos = response["hits"]
        # loop through each video in the result
        for v in videos:
            duration = v["duration"]
            # check if video has desired minimum duration
            if duration < minimum_duration:
                continue
            video_files = v["videos"]
            # loop through each url to determine the best quality
            for video_type in video_files:
                video = video_files[video_type]
                w = int(video["width"])
                # h = int(video["height"])
                if w >= video_width:
                    item = MaterialInfo()
                    item.provider = "pixabay"
                    item.url = video["url"]
                    item.duration = duration
                    # 缩略图:优先用该清晰度对象自带的 thumbnail 直链(Pixabay 现行字段);
                    # 没有再回落老 picture_id→vimeocdn 拼接(已多不可用,仅兜底)。
                    thumb = str(video.get("thumbnail") or "").strip()
                    if not thumb:
                        pid = str(v.get("picture_id", "")).strip()
                        thumb = f"https://i.vimeocdn.com/video/{pid}_640x360.jpg" if pid else ""
                    item.image = thumb
                    if len(video_items) == 0:  # 诊断:首条打印实际字段,定位"无缩略图"
                        logger.info(
                            "[pixabay] sample url=%s thumb=%s video_keys=%s hit_keys=%s",
                            item.url, thumb or "(空)", list(video.keys()), list(v.keys()),
                        )
                    video_items.append(item)
                    break
        return video_items
    except Exception as e:
        logger.error(f"search videos failed: {str(e)}")

    return []


def save_video(video_url: str, save_dir: str = "", *, max_seconds: float = 0.0) -> str:
    if not save_dir:
        save_dir = utils.storage_dir("cache_videos")

    if not os.path.exists(save_dir):
        os.makedirs(save_dir)

    url_without_query = video_url.split("?")[0]
    url_hash = utils.md5(url_without_query)
    video_id = f"vid-{url_hash}"
    video_path = f"{save_dir}/{video_id}.mp4"

    # if video already exists, return the path
    if os.path.exists(video_path) and os.path.getsize(video_path) > 0:
        logger.info(f"video already exists: {video_path}")
        return video_path

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }

    # if video does not exist, download it(流式 → 临时文件 → 原子改名;
    # 避免超时/中断留下"半截但看着有效"的缓存被下次当成功命中)
    tmp_path = f"{video_path}.part"
    deadline = (time.monotonic() + max_seconds) if max_seconds and max_seconds > 0 else None
    try:
        with requests.get(
            video_url,
            headers=headers,
            proxies=config.proxy,
            verify=_get_tls_verify(),
            timeout=(30, 60),
            stream=True,
        ) as resp:
            resp.raise_for_status()
            with open(tmp_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=262144):
                    if not chunk:
                        continue
                    f.write(chunk)
                    if deadline is not None and time.monotonic() > deadline:
                        raise TimeoutError(
                            f"download exceeded {max_seconds:.0f}s budget: {video_url}"
                        )
        os.replace(tmp_path, video_path)
    except Exception:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
        raise

    if os.path.exists(video_path) and os.path.getsize(video_path) > 0:
        clip = None
        try:
            clip = VideoFileClip(video_path)
            duration = clip.duration
            fps = clip.fps
            if duration > 0 and fps > 0:
                return video_path
        except Exception as e:
            logger.warning(f"invalid video file: {video_path} => {str(e)}")
            try:
                os.remove(video_path)
            except Exception as remove_error:
                logger.warning(
                    f"failed to remove invalid video file: {video_path}, error: {str(remove_error)}"
                )
        finally:
            if clip is not None:
                try:
                    clip.close()
                except Exception as close_error:
                    logger.warning(
                        f"failed to close video clip: {video_path}, error: {str(close_error)}"
                    )
    return ""


def save_image(image_url: str, save_dir: str = "") -> str:
    """下载图像到 save_dir,返回本地路径;失败返回 ""。"""
    if not save_dir:
        save_dir = utils.storage_dir("cache_videos")
    if not os.path.exists(save_dir):
        os.makedirs(save_dir)
    url_without_query = image_url.split("?")[0]
    ext = os.path.splitext(url_without_query)[1].lower() or ".jpg"
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"):
        ext = ".jpg"
    img_id = f"img-{utils.md5(url_without_query)}"
    img_path = f"{save_dir}/{img_id}{ext}"
    if os.path.exists(img_path) and os.path.getsize(img_path) > 0:
        return img_path
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }
    try:
        content = requests.get(
            image_url, headers=headers, proxies=config.proxy,
            verify=_get_tls_verify(), timeout=(30, 120),
        ).content
        with open(img_path, "wb") as f:
            f.write(content)
    except Exception as e:  # noqa: BLE001
        logger.error(f"download image failed: {image_url} => {e}")
        return ""
    if os.path.exists(img_path) and os.path.getsize(img_path) > 0:
        return img_path
    return ""


def download_videos(
    task_id: str,
    search_terms: List[str],
    source: str = "pexels",
    video_aspect: VideoAspect = VideoAspect.portrait,
    video_contact_mode: VideoConcatMode = VideoConcatMode.random,
    audio_duration: float = 0.0,
    max_clip_duration: int = 5,
    *,
    on_progress: Optional[Callable[[int, int, float], None]] = None,
    phase_deadline: Optional[float] = None,
    max_workers: int = 0,
) -> List[str]:
    """搜索 + 并发下载在线片段。

    相比上游逐个串行下载,这里:
      - 搜索阶段(快,几个 HTTP)仍顺序;
      - 下载阶段用线程池**并发**(国内访问 Pexels/Pixabay 慢,串行是
        "卡在 50%" 的主因);
      - ``on_progress(done, target, frac)`` 每完成一个片段回调一次,
        让 runner 把进度从 50% 往 70% 推、并写 stage_hint;
      - ``phase_deadline``(time.monotonic 时刻)到点即停,不再无限等
        —— 拿到几段就用几段,一段没有则交由上层 fallback 本地库。
    """
    valid_video_items = []
    valid_video_urls = []
    found_duration = 0.0
    search_videos = search_videos_pexels
    if source == "pixabay":
        search_videos = search_videos_pixabay

    for search_term in search_terms:
        video_items = search_videos(
            search_term=search_term,
            minimum_duration=max_clip_duration,
            video_aspect=video_aspect,
        )
        logger.info(f"found {len(video_items)} videos for '{search_term}'")

        for item in video_items:
            if item.url not in valid_video_urls:
                valid_video_items.append(item)
                valid_video_urls.append(item.url)
                found_duration += item.duration

    logger.info(
        f"found total videos: {len(valid_video_items)}, required duration: {audio_duration} seconds, found duration: {found_duration} seconds"
    )

    material_directory = config.app.get("material_directory", "").strip()
    if material_directory == "task":
        material_directory = utils.task_dir(task_id)
    elif material_directory and not os.path.isdir(material_directory):
        material_directory = ""

    if video_contact_mode.value == VideoConcatMode.random.value:
        random.shuffle(valid_video_items)

    if not valid_video_items:
        logger.info("downloaded 0 videos")
        return []

    # 够时长需要多少段(+一半 buffer 给下载失败留余量)
    need = max(1, math.ceil(max(1.0, audio_duration) / max(1, max_clip_duration)))
    candidates = valid_video_items[: need + max(2, need // 2)]
    total_target = min(need, len(candidates))

    # 单片下载时间预算:整阶段剩余预算,限制在 [20s, 120s]
    if phase_deadline is not None:
        remain = max(5.0, phase_deadline - time.monotonic())
        per_dl = max(20.0, min(120.0, remain))
    else:
        per_dl = 120.0

    workers = max_workers if max_workers and max_workers > 0 else min(6, len(candidates))
    results: "dict[int, str]" = {}
    durations: "dict[int, float]" = {}

    executor = ThreadPoolExecutor(max_workers=workers)
    fut_index = {}
    for idx, item in enumerate(candidates):
        logger.info(f"downloading video: {item.url}")
        fut = executor.submit(
            save_video, item.url, material_directory, max_seconds=per_dl
        )
        fut_index[fut] = (idx, item)

    try:
        for fut in as_completed(fut_index):
            idx, item = fut_index[fut]
            try:
                saved_video_path = fut.result()
            except Exception as e:  # noqa: BLE001
                logger.error(
                    f"failed to download video: {utils.to_json(item)} => {str(e)}"
                )
                saved_video_path = ""
            if saved_video_path:
                logger.info(f"video saved: {saved_video_path}")
                results[idx] = saved_video_path
                durations[idx] = min(max_clip_duration, item.duration)

            acc = sum(durations.values())
            if on_progress is not None:
                try:
                    on_progress(
                        len(results),
                        max(total_target, len(results)),
                        min(1.0, acc / max(1.0, audio_duration)),
                    )
                except Exception:  # noqa: BLE001
                    pass

            over_budget = (
                phase_deadline is not None and time.monotonic() > phase_deadline
            )
            if acc > audio_duration:
                logger.info(
                    f"total duration of downloaded videos: {acc} seconds, skip downloading more"
                )
                break
            if over_budget:
                logger.warning(
                    "[materials] 阶段时间预算耗尽,停止等待剩余下载(已得 %d 段)",
                    len(results),
                )
                break
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    # 保留候选顺序(video_concat_mode=sequential 时拼接顺序有意义)
    video_paths = [results[i] for i in sorted(results.keys())]
    logger.info(f"downloaded {len(video_paths)} videos")
    return video_paths


