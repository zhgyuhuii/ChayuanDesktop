"""视频生成任务执行器 — 在线程池跑 moviepy 合成,asyncio 跟进度。

设计要点:
- moviepy 是 sync CPU 绑定:在 asyncio 主线程里跑会卡死 FastAPI 事件
  循环 → 用 ``ThreadPoolExecutor`` 把 ``_run_pipeline`` 整体调度到工
  作线程。
- 每个 task 内部仍是顺序 6 步(脚本→关键词→TTS→字幕→素材→合成);并发
  来自"多个 task 同时跑"。pool 上限 ``CHAYUAN_VG_RUNNER_WORKERS`` env,
  默认 2(单机用户场景),避免内存/磁盘 IO 抢占。
- 状态全写到 store.tasks(update_progress),wizard 前端订阅 SSE 拿到。
- 取消:cancel_task 把 in-flight task_id 加入 ``_canceled``,worker
  在每个 step 边界检查 — 后续 step 直接跳过 + 写 state=canceled。

注意:M1 阶段 ``_run_pipeline`` 是骨架版本,六步顺序明确但 generate_audio /
generate_final_videos 等还没完全 wire 到 steps 模块(尤其音频与字幕
之间的 audio_duration 传参、materials 下载到 task_dir 等);M2 API 路由
端接入时一次性补齐 + 端到端验证。
"""

from __future__ import annotations

import logging
import os
import re
import threading
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Optional

from .schemas import VgTaskState, VideoParams
from .store import tasks as tasks_store

logger = logging.getLogger("chayuan.video_generation.runner")


# ─────────────────────────────────────────────────────────────────────
# 全局 executor
# ─────────────────────────────────────────────────────────────────────


# 默认 4 worker(原 2)— 用户多任务并发(batch / 多 chat 会话)是常态;
# moviepy CPU 绑定,实际并发数受机器 vCPU 限制,env 仍可 override。
_WORKERS = max(1, int(os.environ.get("CHAYUAN_VG_RUNNER_WORKERS", "4")))
_executor: Optional[ThreadPoolExecutor] = None
_executor_lock = threading.Lock()
_canceled: set[str] = set()
_canceled_lock = threading.Lock()
_active_futures: dict[str, Future] = {}


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(
                max_workers=_WORKERS, thread_name_prefix="vg-runner"
            )
            logger.info("[runner] ThreadPoolExecutor workers=%d", _WORKERS)
        return _executor


def shutdown() -> None:
    """服务下线时调,优雅清理 executor。"""

    global _executor
    with _executor_lock:
        if _executor is not None:
            _executor.shutdown(wait=False, cancel_futures=True)
            _executor = None


# ─────────────────────────────────────────────────────────────────────
# 任务提交 / 取消
# ─────────────────────────────────────────────────────────────────────


def enqueue(task_id: str, params: VideoParams, *, stop_at: str = "video") -> Future:
    """提交任务到线程池。任务态 row 应该已经由 service.submit_task 写过。"""

    future = _get_executor().submit(_run_pipeline, task_id, params, stop_at)
    _active_futures[task_id] = future
    future.add_done_callback(lambda _f: _active_futures.pop(task_id, None))
    return future


def cancel(task_id: str) -> bool:
    """请求取消任务。worker 在 step 边界检查 → 跳过后续 step + 写
    state=canceled。若任务还在队列里没起来,直接 Future.cancel(); 已
    running 的只能等到下个边界。"""

    with _canceled_lock:
        _canceled.add(task_id)
    fut = _active_futures.get(task_id)
    if fut and not fut.running():
        fut.cancel()
    return True


def _is_canceled(task_id: str) -> bool:
    with _canceled_lock:
        return task_id in _canceled


# ─────────────────────────────────────────────────────────────────────
# 流水线 — 6 步骨架(M2 端到端验收时补完每步的 wiring)
# ─────────────────────────────────────────────────────────────────────


def _run_pipeline(task_id: str, params: VideoParams, stop_at: str) -> None:
    """6 步顺序执行,每步上报进度。失败/取消时写终态。

    步骤:
      1. script    — generate_script(LLM) 或直接用 params.video_script
                     (manual/srt 模式)
      2. terms     — 在线素材源用;本地素材模式跳过
      3. audio     — TTS 文本 → 音频文件 + cues
      4. subtitle  — cues(or ASR/SubMaker) → SRT 落盘
      5. materials — 在线下载 OR 用户预选 OR 内置 clips
      6. compose   — moviepy 合成最终 mp4

    stop_at 可截断流程(wizard 单步预览):"script" / "terms" / "audio" /
    "subtitle" / "materials" / "video"(默认全跑完)。
    """

    from . import binaries
    from .steps import script as _script_step
    from .steps import tts as _tts_step
    from .steps import subtitle as _subtitle_step

    # 任务态:processing 5%
    tasks_store.update_progress(task_id, state=VgTaskState.processing.value, progress=5)

    # 启动时确保二进制环境变量注入(idempotent;configure 已被 server 启动期调过)
    binaries.configure(strict=False)

    try:
        # ── 1. script ──────────────────────────────────────────────
        if _is_canceled(task_id):
            return _mark_canceled(task_id)

        if params.script_source.value == "ai":
            video_script = _script_step.generate_script(
                params.video_subject,
                language=params.video_language,
                paragraph_number=params.paragraph_number,
                model=params.model or None,
            )
        else:
            # manual / srt 模式 — script 由用户提供
            video_script = params.video_script
        if not video_script and params.script_source.value != "srt":
            return _mark_failed(task_id, "脚本为空(LLM 调用失败或用户未填)")
        tasks_store.update_progress(
            task_id, progress=10, result_patch={"script": video_script},
        )
        if stop_at == "script":
            return _mark_complete(task_id, progress=100)

        # ── 2. terms ───────────────────────────────────────────────
        if _is_canceled(task_id):
            return _mark_canceled(task_id)
        video_terms: list[str] = []
        # 在线源(pexels/pixabay)就需要搜索关键词 —— 跟脚本来源无关。
        # 旧逻辑限 script_source=='ai',但对话流"去生成"提交的是 manual,
        # 导致 video_terms 永远空 → _resolve_materials 在线分支被跳过 → 回退本地。
        # 已有 video_subject 优先,空则从脚本里抽关键词。
        if params.video_source != "local":
            # 优先用用户填/编辑的关键词(对齐上游 task.py:38);空了才 LLM 生成。
            # 之前漏了这步 → 用户编辑的关键词被覆盖 + LLM 失败时无退路。
            user_terms = params.video_terms
            if isinstance(user_terms, str):
                user_terms = [t.strip() for t in re.split(r"[,，\n]", user_terms) if t.strip()]
            elif isinstance(user_terms, list):
                user_terms = [str(t).strip() for t in user_terms if str(t).strip()]
            else:
                user_terms = []
            if user_terms:
                video_terms = user_terms
            else:
                subject = (params.video_subject or "").strip() or video_script[:80]
                video_terms = _script_step.generate_terms(
                    subject, video_script, amount=5,
                    model=params.model or None,
                )
                if not video_terms:
                    logger.warning(
                        "[runner] 在线源 %s 但 generate_terms 返空 — 在线搜索将被跳过,"
                        "检查 chat 模型是否可用 / 脚本是否为空", params.video_source,
                    )
        tasks_store.update_progress(
            task_id, progress=20, result_patch={"terms": video_terms},
        )
        if stop_at == "terms":
            return _mark_complete(task_id, progress=100)

        # ── 3. audio (TTS) ─────────────────────────────────────────
        if _is_canceled(task_id):
            return _mark_canceled(task_id)
        audio_file = _resolve_audio_path(task_id)
        tts_result = _tts_step.synthesize(
            video_script, audio_file,
            voice_provider=params.voice_provider,
            voice_name=params.voice_name or None,
            voice_rate=params.voice_rate, voice_volume=params.voice_volume,
        )
        if not tts_result:
            return _mark_failed(task_id, "TTS 失败 — provider 都没成功")
        tasks_store.update_progress(
            task_id, progress=35,
            result_patch={
                "audio_file": tts_result.audio_file,
                "audio_duration_ms": tts_result.duration_ms,
                "tts_provider": tts_result.provider,
            },
        )
        if stop_at == "audio":
            return _mark_complete(task_id, progress=100)

        # ── 4. subtitle ────────────────────────────────────────────
        if _is_canceled(task_id):
            return _mark_canceled(task_id)
        subtitle_path = _resolve_subtitle_path(task_id)
        if params.script_source.value == "srt" and params.srt_cues:
            cues = list(params.srt_cues)
        else:
            cues = tts_result.cues
        if cues:
            _subtitle_step.write_srt(cues, subtitle_path)
        tasks_store.update_progress(
            task_id, progress=50, result_patch={"subtitle_path": subtitle_path},
        )
        if stop_at == "subtitle":
            return _mark_complete(task_id, progress=100)

        # ── 5. materials ──────────────────────────────────────────
        if _is_canceled(task_id):
            return _mark_canceled(task_id)
        materials_paths = _resolve_materials(
            task_id, params, video_terms,
            audio_duration_ms=tts_result.duration_ms,
        )
        if not materials_paths:
            return _mark_failed(task_id, _materials_failure_reason(params, video_terms))
        tasks_store.update_progress(
            task_id, progress=70, result_patch={"materials": materials_paths},
        )
        if stop_at == "materials":
            return _mark_complete(task_id, progress=100)

        # ── 6. compose ────────────────────────────────────────────
        if _is_canceled(task_id):
            return _mark_canceled(task_id)
        if _use_edl(params):
            final_videos = [_compose_via_edl(task_id, params, tts_result.audio_file, subtitle_path)]
            combined_videos = []
        else:
            final_videos, combined_videos = _compose_videos(
                task_id, params, materials_paths,
                audio_file=tts_result.audio_file, subtitle_path=subtitle_path,
            )
        if not final_videos:
            return _mark_failed(task_id, "moviepy 合成失败 — 详见日志")

        # 同步 vg_videos 表
        _persist_vg_videos(task_id, params, final_videos)

        tasks_store.update_progress(
            task_id, progress=100,
            result_patch={
                "final_videos": final_videos,
                "combined_videos": combined_videos,
            },
        )
        return _mark_complete(task_id, progress=100)

    except Exception as e:  # noqa: BLE001
        logger.error(
            "[runner] task %s pipeline 异常: %s\n%s",
            task_id, e, traceback.format_exc(),
        )
        return _mark_failed(task_id, f"{type(e).__name__}: {e}")
    finally:
        # 取消标记一次性,任务终态后从集合移除
        with _canceled_lock:
            _canceled.discard(task_id)


# ─────────────────────────────────────────────────────────────────────
# 内部 helpers
# ─────────────────────────────────────────────────────────────────────


def _mark_canceled(task_id: str) -> None:
    tasks_store.update_progress(task_id, state=VgTaskState.canceled.value)


def _mark_complete(task_id: str, *, progress: int = 100) -> None:
    tasks_store.update_progress(
        task_id, state=VgTaskState.complete.value, progress=progress,
    )


def _mark_failed(task_id: str, msg: str) -> None:
    logger.warning("[runner] task %s failed: %s", task_id, msg)
    tasks_store.update_progress(task_id, state=VgTaskState.failed.value, error=msg)


def _resolve_audio_path(task_id: str) -> str:
    from ._helpers import task_dir
    return os.path.join(task_dir(task_id), "audio.wav")


def _resolve_subtitle_path(task_id: str) -> str:
    from ._helpers import task_dir
    return os.path.join(task_dir(task_id), "subtitle.srt")


# ─────────────────────────────────────────────────────────────────────
# materials 步骤 — 从用户预选 / 在线下载 / 本地素材库 三档来源拿视频
# ─────────────────────────────────────────────────────────────────────


def _materials_failure_reason(params, video_terms) -> str:
    """素材解析返空时,给出可区分真因的报错(不再固定甩"没配 Key")。"""
    src = params.video_source
    if src == "local":
        return ("本地素材库为空 — 请上传素材,或切到在线源(Pexels/Pixabay)"
                "并在「素材设置」配置 API Key")
    # 在线源:实际探测 key 是否读得到
    key_map = {"pexels": "pexels_api_keys", "pixabay": "pixabay_api_keys"}
    try:
        from ._config_shim import vg_config
        has_key = bool(vg_config.app.get(key_map.get(src, "")))
    except Exception:  # noqa: BLE001
        has_key = False
    if not has_key:
        return (f"在线源 {src} 未读到 API Key — 请在「素材设置」配置;"
                f"若已配置仍报此错,多半是服务端未重启使配置/修复生效,请重启后端")
    if not video_terms:
        return (f"在线源 {src} 已配 Key,但搜索关键词为空 — "
                f"检查脚本是否为空 / chat 模型是否可用")
    return (f"在线源 {src} 已配 Key 且有关键词,但未搜到/下载到素材 — "
            f"可能网络不通或关键词无结果,详见服务端日志")


def _resolve_materials(
    task_id: str,
    params,
    video_terms,
    *,
    audio_duration_ms: int,
) -> list[str]:
    """三档来源优先级:
      1) params.video_materials(用户在 wizard step 5 显式拖选的 MaterialInfo 列表)
      2) video_source != local → 在线下载(Pexels/Pixabay)
      3) video_source == local 但用户没指定 → 从素材库 vg_materials 拉
         owner_id 关联的 + bundled 全局 union(按 used_count + 随机取够时长)
    """

    from ._helpers import task_dir
    from .schemas import VideoConcatMode
    from .store import materials as materials_store
    from .steps import materials as materials_step

    audio_duration_s = max(1.0, audio_duration_ms / 1000.0)
    max_clip = max(1, int(params.video_clip_duration))
    out_dir = task_dir(task_id)

    # 1) 用户预选
    if params.video_materials:
        paths: list[str] = []
        for mi in params.video_materials:
            if not mi.url:
                continue
            # url 既可能是 http(s) 也可能是本地路径(用户从素材库拖入)
            if mi.url.startswith(("http://", "https://")):
                saved = materials_step.save_video(mi.url, save_dir=out_dir)
                if saved:
                    paths.append(saved)
            elif os.path.isfile(mi.url):
                paths.append(mi.url)
        if paths:
            return paths

    # 2) 在线源
    if params.video_source != "local" and video_terms:
        try:
            paths = materials_step.download_videos(
                task_id, list(video_terms),
                source=params.video_source,
                video_aspect=params.video_aspect,
                video_contact_mode=VideoConcatMode(params.video_concat_mode.value),
                audio_duration=audio_duration_s,
                max_clip_duration=max_clip,
            )
            # 下载到的在线片段持久化进素材库,库里「网络/pexels」可浏览+复用(best-effort)
            _persist_online_materials(task_id, params.video_source, paths)
            return paths
        except Exception as e:  # noqa: BLE001
            logger.warning("[runner] 在线源 %s 失败,fallback 本地: %r",
                           params.video_source, e)

    # 3) 本地素材库
    return _pick_from_local_library(task_id, audio_duration_s, max_clip)


def _persist_online_materials(task_id: str, source: str, paths: list) -> None:
    """把在线下载的片段复制到持久素材目录 + 登记 vg_materials,供库里浏览/复用。

    best-effort:任何失败只 warning,绝不影响本次生成。去重按文件名(Pexels/
    Pixabay 文件名含 video id,稳定)—— 目标已存在则跳过复制和登记。
    owner_id 从 vg_tasks 倒查(跟当前任务归属一致)。
    """
    import os
    import shutil

    try:
        from . import service as vg_service
        from ._helpers import storage_dir
        from .store import materials as materials_store
    except Exception as e:  # noqa: BLE001
        logger.warning("[persist-online] import 失败,跳过: %r", e)
        return

    try:
        row = vg_service.get_task(task_id)
        owner_id = row.get("owner_id") if row else None
    except Exception:  # noqa: BLE001
        owner_id = None

    try:
        mat_dir = storage_dir("materials", create=True)
    except Exception as e:  # noqa: BLE001
        logger.warning("[persist-online] 素材目录不可用,跳过: %r", e)
        return

    for p in paths or []:
        try:
            if not p or not os.path.isfile(p):
                continue
            base = os.path.basename(p)
            # 文件名带源前缀,避免不同源同名冲突;含 video id 天然去重
            dest_name = f"{source}_{base}"
            dest = os.path.join(mat_dir, dest_name)
            if os.path.isfile(dest) and os.path.getsize(dest) > 0:
                continue  # 已在库里(之前下过同一片段)→ 跳过
            shutil.copy2(p, dest)
            size = os.path.getsize(dest)
            materials_store.create_material(
                source=source,
                name=dest_name,
                path=dest,
                owner_id=owner_id,
                mime="video/mp4",
                size=size,
                tags=["online", source],
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("[persist-online] 持久化 %s 失败(忽略): %r", p, e)


def _pick_from_local_library(
    task_id: str, audio_duration_s: float, max_clip: int,
) -> list[str]:
    """从 vg_materials 拉 owner_id + 全局 bundled 取够音频时长的本地素材。

    M2 简版:返第一页 50 个,按 used_count 升序(平衡使用)再随机洗牌,累加
    duration 到够 audio_duration_s 为止。M5 + 用户体验阶段可加更智能的
    "按 tags / 文件名 ↔ video_terms 软匹配"。
    """

    import random
    from .store import materials as materials_store

    rows, _total = materials_store.list_materials(
        owner_id=None, source=None, page=1, page_size=50,
    )
    if not rows:
        return []
    # 按 used_count 升序 + 内部洗牌 — 避免每次都拿同一批
    rows.sort(key=lambda r: r.get("used_count") or 0)
    random.shuffle(rows)
    out: list[str] = []
    accumulated_s = 0.0
    for r in rows:
        p = r.get("path")
        if not p or not os.path.isfile(p):
            continue
        out.append(p)
        accumulated_s += min(max_clip, (r.get("duration_ms") or 0) / 1000.0 or max_clip)
        if accumulated_s >= audio_duration_s:
            break
    return out


# ─────────────────────────────────────────────────────────────────────
# compose 步骤 — moviepy 合成 N 份成品(video_count)
# ─────────────────────────────────────────────────────────────────────


def _compose_videos(
    task_id: str,
    params,
    materials_paths: list[str],
    *,
    audio_file: str,
    subtitle_path: str,
) -> tuple[list[str], list[str]]:
    """对每个 video_count 跑一次 combine_videos + generate_video,落盘到 task_dir。

    返回 (final_videos[], combined_videos[]) 两个列表。失败任一份 → 跳过
    但其它仍尝试;全失败返双空列表。
    """

    from ._helpers import task_dir
    from .steps import compose as compose_step

    out_dir = task_dir(task_id)
    finals: list[str] = []
    combineds: list[str] = []

    for idx in range(1, max(1, int(params.video_count)) + 1):
        combined_path = os.path.join(out_dir, f"combined-{idx}.mp4")
        final_path = os.path.join(out_dir, f"final-{idx}.mp4")
        try:
            compose_step.combine_videos(
                combined_video_path=combined_path,
                video_paths=materials_paths,
                audio_file=audio_file,
                video_aspect=params.video_aspect,
                video_concat_mode=params.video_concat_mode,
                video_transition_mode=params.video_transition_mode,
                max_clip_duration=max(1, int(params.video_clip_duration)),
                threads=max(1, int(params.n_threads)),
            )
            compose_step.generate_video(
                video_path=combined_path,
                audio_path=audio_file,
                subtitle_path=subtitle_path,
                output_file=final_path,
                params=params,
            )
            finals.append(final_path)
            combineds.append(combined_path)
        except Exception as e:  # noqa: BLE001
            logger.error(
                "[runner] compose video #%d failed: %s\n%s",
                idx, e, traceback.format_exc(),
            )
    return finals, combineds


def _use_edl(params) -> bool:
    """有 timeline 且至少一条 video 轨有 clip 才走 EDL 渲染;否则走自动路径。"""
    tl = getattr(params, "timeline", None)
    if tl is None:
        return False
    for t in (tl.tracks or []):
        if t.kind == "video" and t.clips:
            return True
    return False


def _compose_via_edl(task_id: str, params, audio_file: str, subtitle_path: str) -> str:
    """EDL 渲染单份成品,返回 final 路径。source 解析:material_id->库路径 /
    url->下载到 task_dir / path->直通。"""
    from ._helpers import task_dir
    from .steps import compose as compose_step
    from .steps import materials as materials_step
    from .store import materials as materials_store

    out_dir = task_dir(task_id)

    def _resolve(source: dict) -> str:
        mid = source.get("material_id")
        if mid:
            try:
                row = materials_store.get_material(mid)
            except Exception:  # noqa: BLE001
                row = None
            return (row or {}).get("path") or ""
        url = source.get("url") or ""
        if url.startswith(("http://", "https://")):
            return materials_step.save_video(url, save_dir=out_dir) or ""
        return source.get("path") or ""

    final_path = os.path.join(out_dir, "final-0.mp4")
    return compose_step.render_from_edl(
        params.timeline, audio_file, subtitle_path, final_path, params,
        source_resolver=_resolve, threads=max(1, int(params.n_threads)),
    )


# ─────────────────────────────────────────────────────────────────────
# vg_videos 同步 — 成品视频进"我的视频"页索引
# ─────────────────────────────────────────────────────────────────────


def _persist_vg_videos(task_id: str, params, final_videos: list[str]) -> None:
    """每份成品写一行 vg_videos。owner_id 从 vg_tasks 倒查。"""

    from .store import tasks as tasks_store
    from .store import videos as videos_store

    row = tasks_store.get_task(task_id)
    owner_id = row.get("owner_id") if row else None
    snap = params.model_dump(mode="json")

    aspect_res = params.video_aspect.to_resolution()
    # 标题:主题(对话模式可能空)→ 退化用脚本首句 → 兜底"视频";一律附生成时间。
    import datetime as _dt
    base_name = (params.video_subject or "").strip()
    if not base_name and params.video_script:
        first_line = next(
            (ln.strip() for ln in str(params.video_script).splitlines() if ln.strip()), "",
        )
        base_name = first_line[:30]
    base_name = (base_name or "视频")[:40]
    title = f"{base_name} · {_dt.datetime.now().strftime('%Y-%m-%d %H:%M')}"

    for path in final_videos:
        try:
            size = os.path.getsize(path) if os.path.isfile(path) else 0
        except OSError:
            size = 0
        try:
            videos_store.create_video(
                task_id=task_id,
                title=title,
                path=path,
                owner_id=owner_id,
                duration_ms=0,  # 真实时长由前端 video meta load 拿,或 M3 调 ffprobe 写回
                width=aspect_res[0],
                height=aspect_res[1],
                thumbnail_path=None,
                params_snapshot=snap,
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("[runner] persist vg_video failed: %r", e)
