"""在线数字人**公开**路由(无 auth)。

外部浏览器访问 ``/dh/{token}`` → sidecar 直接吐自包含 HTML 公开页;页面内的
config / avatar / presence(WS) / chat(SSE) / tts 都走 token 网关,免登录。
对话与 TTS 带进程内限流(按 IP 令牌桶 + 按 token 每日上限)+ owner 开关门控。

公网可达性由部署/网络层负责(public_host + 端口转发/反代),本模块不内置隧道。
"""
from __future__ import annotations

import logging
import mimetypes
import os
import re
import subprocess
import tempfile
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from sse_starlette.sse import EventSourceResponse

from chayuan.server.video_generation.digital_human import jobs as dh_jobs
from chayuan.server.video_generation.digital_human import online_presence, published_store, store

logger = logging.getLogger("chayuan.digital_human.public")

digital_human_public_router = APIRouter(tags=["digital-human-public"])

_PUB = "/api/v1/digital-human/public"
_VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv", ".avi"}

# wav2lip 串行锁:CPU 上单次推理已占满核,并发跑多个只会互抢、首句更慢 + handle 非线程安全。
# 锁只包推理本身;TTS 在锁外,故句 N 的推理跑时句 N+1 的 TTS 可重叠(前端多路预取的收益来源)。
_W2L_LOCK = threading.Lock()

# ---- 进程内限流(sidecar 单 worker) ----
_BUCKETS: Dict[Tuple[str, str], List[float]] = {}   # (token, ip) -> [tokens, last_ts]
_DAILY: Dict[str, List[int]] = {}                    # token -> [day, count]


def _client_ip(req: Optional[Request], ws: Optional[WebSocket] = None) -> str:
    src = req or ws
    try:
        return (src.client.host if src and src.client else "") or "-"
    except Exception:  # noqa: BLE001
        return "-"


def _rate_ok(token: str, ip: str, rate_per_min: int, daily_cap: int) -> bool:
    now = time.time()
    # 令牌桶:容量 = rate_per_min,每 60s 回满
    cap = max(1, int(rate_per_min or 1))
    b = _BUCKETS.get((token, ip))
    if b is None:
        b = [float(cap), now]
        _BUCKETS[(token, ip)] = b
    b[0] = min(float(cap), b[0] + (now - b[1]) * (cap / 60.0))
    b[1] = now
    if b[0] < 1.0:
        return False
    # 每日上限
    day = int(now // 86400)
    d = _DAILY.get(token)
    if d is None or d[0] != day:
        d = [day, 0]
        _DAILY[token] = d
    if d[1] >= max(1, int(daily_cap or 1)):
        return False
    b[0] -= 1.0
    d[1] += 1
    return True


def _live(token: str):
    """返回已上线的发布记录,否则 404。"""
    rec = published_store.get_by_token(token)
    if not rec or not rec.enabled:
        raise HTTPException(status_code=404, detail="该数字人未发布或已下线")
    return rec


# --------------------------------------------------------------------------
# 公开页 HTML
# --------------------------------------------------------------------------
@digital_human_public_router.get("/dh/{token}", response_class=HTMLResponse)
def public_page(token: str) -> HTMLResponse:
    rec = published_store.get_by_token(token)
    if not rec or not rec.enabled:
        return HTMLResponse(_OFFLINE_PAGE, status_code=404)
    # no-store:公开页 HTML 内嵌 JS,每次发版都变。不禁缓存则浏览器拿旧 HTML/JS,
    # 「改了没生效」(形象不显示等修复白做)。每次都取最新。
    return HTMLResponse(_PUBLIC_PAGE.replace("__TOKEN__", token),
                        headers={"Cache-Control": "no-store, no-cache, must-revalidate"})


@digital_human_public_router.get(_PUB + "/{token}/config")
def public_config(token: str) -> Dict[str, Any]:
    rec = _live(token)
    from urllib.parse import quote
    base = _PUB + "/" + token
    # 页面打开即后台预热 wav2lip 模型,首句不再等「loading models」
    if bool(rec.chat_enabled):
        try:
            import threading
            from chayuan.server.video_generation.digital_human.engine import warm_wav2lip
            threading.Thread(target=warm_wav2lip, daemon=True).start()
        except Exception:  # noqa: BLE001
            pass
    prods = [{
        "kind": p.kind, "x": p.x, "y": p.y, "scale": p.scale,
        "z": p.z, "opacity": p.opacity,
        "link": getattr(p, "link", None),
        "title": getattr(p, "title", None), "price": getattr(p, "price", None), "desc": getattr(p, "desc", None),
        "url": base + "/product?ref=" + quote(p.ref),
    } for p in (rec.products or [])]
    return {
        "name": rec.name,
        "welcome": getattr(rec, "welcome", "") or "",
        "idle_script": getattr(rec, "idle_script", "") or "",
        "ratio": {"w": rec.video_width, "h": rec.video_height},
        "chat_enabled": bool(rec.chat_enabled),
        "viewers": online_presence.count(token),
        "avatar": {
            "kind": rec.avatar_kind, "x": rec.avatar_x, "y": rec.avatar_y,
            "scale": rec.avatar_scale, "opacity": rec.avatar_opacity, "z": rec.avatar_z,
            "url": base + "/avatar",
        },
        "products": prods,
    }


@digital_human_public_router.get(_PUB + "/{token}/product")
def public_product(token: str, ref: str = "") -> FileResponse:
    rec = _live(token)
    if not ref or ref not in [p.ref for p in (rec.products or [])]:
        raise HTTPException(status_code=404, detail="商品资源不存在")
    path = store.resolve_product_path(ref)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="商品资源不存在")
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return FileResponse(path, media_type=mime)


def _bg_key_color(path: str):
    """从图片四角探测背景纯色 (r,g,b);+ 按亮度自适应阈值。失败返 None。"""
    try:
        from PIL import Image
        import numpy as np
        im = Image.open(path).convert("RGB")
        arr = np.asarray(im).astype(int)
        h, w = arr.shape[:2]
        m = max(2, int(min(h, w) * 0.04))
        corners = np.concatenate([
            arr[:m, :m].reshape(-1, 3), arr[:m, w - m:].reshape(-1, 3),
            arr[h - m:, :m].reshape(-1, 3), arr[h - m:, w - m:].reshape(-1, 3)])
        key = np.median(corners, axis=0)
        s = float(key.sum())
        thr = 55 if s > 620 else (80 if s > 430 else 110)
        return (int(key[0]), int(key[1]), int(key[2])), thr
    except Exception:  # noqa: BLE001
        return None


def _matte_png_bytes(path: str, sim=None):
    """抠像:把图片背景纯色键成透明,返回 PNG 字节(仅留人像)。失败返 None。
    sim(0-1):用户设的抠图强度,越大抠越狠;None=按背景亮度自适应阈值。"""
    try:
        from PIL import Image
        import numpy as np
        kc = _bg_key_color(path)
        if not kc:
            return None
        key, thr = kc
        if sim is not None:
            thr = max(8.0, float(sim) * 441.0)   # sim 0-1 → RGB 距离阈值(441≈sqrt(3)*255 满量程)
        im = Image.open(path).convert("RGBA")
        arr = np.asarray(im).astype(int)
        rgb = arr[:, :, :3]
        dist = np.sqrt(((rgb - np.array(key)) ** 2).sum(axis=2))
        a = arr[:, :, 3]
        arr[:, :, 3] = np.where(dist < thr, 0, a)
        import io as _io
        out = _io.BytesIO()
        Image.fromarray(arr.astype("uint8"), "RGBA").save(out, format="PNG")
        return out.getvalue()
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh-public] 形象抠像失败,用原图: %r", e)
        return None


def _matte_video_cached(path: str, sim=None):
    """idle 视频形象:按首帧背景纯色 colorkey 成透明 webm(vp9 alpha),缓存(按文件名+大小+mtime+sim)。
    首次较慢,之后直接返缓存。失败返 None(用原视频)。sim(0-1)=用户设的强度;None=自适应。"""
    try:
        import cv2
        import numpy as np
        import hashlib
        import imageio_ffmpeg
        cap = cv2.VideoCapture(path)
        ok, f = cap.read()
        cap.release()
        if not ok or f is None:
            return None
        f = f[:, :, ::-1].astype(int)   # BGR→RGB
        h, w = f.shape[:2]
        m = max(2, int(min(h, w) * 0.04))
        corners = np.concatenate([f[:m, :m].reshape(-1, 3), f[:m, w - m:].reshape(-1, 3),
                                  f[h - m:, :m].reshape(-1, 3), f[h - m:, w - m:].reshape(-1, 3)])
        key = np.median(corners, axis=0)
        s = float(key.sum())
        thr = 55 if s > 620 else (80 if s > 430 else 110)
        r, g, b = int(key[0]), int(key[1]), int(key[2])
        sim = float(sim) if sim is not None else max(0.10, min(0.50, thr / 255.0))
        st = os.stat(path)
        kk = hashlib.md5(("%s|%d|%d|%.3f" % (path, st.st_size, int(st.st_mtime), sim)).encode()).hexdigest()[:16]
        cache_dir = os.path.join(tempfile.gettempdir(), "chayuan_dh_idle_matte")
        os.makedirs(cache_dir, exist_ok=True)
        out = os.path.join(cache_dir, kk + ".webm")
        if os.path.isfile(out) and os.path.getsize(out) > 1000:
            return out
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        vf = "colorkey=0x%02X%02X%02X:%.2f:0.10,format=yuva420p" % (r, g, b, sim)
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", path, "-an", "-vf", vf,
                        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
                        "-deadline", "realtime", "-cpu-used", "8", out], check=True)
        return out if (os.path.isfile(out) and os.path.getsize(out) > 1000) else None
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh-public] idle 视频抠像失败,用原视频: %r", e)
        return None


def _matte_on(rec) -> bool:
    """该在线数字人是否抠像。真源两条:① 发布后 ✂️ 开关(rec.matte);
    ② 制作时勾的抠像(preset.is_greenscreen)——任一为真即抠,让「制作时选了抠图」直接生效。"""
    if bool(getattr(rec, "matte", False)):
        return True
    try:
        pr = store.get_preset(getattr(rec, "preset_id", "") or "")
        return bool(getattr(pr, "is_greenscreen", False)) if pr else False
    except Exception:  # noqa: BLE001
        return False


def _matte_sim(rec):
    """抠图相似度(0-1,越大抠越狠)。优先发布记录;否则读 preset.matte_sim(工作台设的,改了
    不用重发布)。None=按背景自适应阈值。"""
    v = getattr(rec, "matte_sim", None)
    if v is None:
        try:
            pr = store.get_preset(getattr(rec, "preset_id", "") or "")
            v = getattr(pr, "matte_sim", None) if pr else None
        except Exception:  # noqa: BLE001
            v = None
    try:
        return max(0.02, min(0.6, float(v))) if v is not None else None
    except Exception:  # noqa: BLE001
        return None


@digital_human_public_router.get(_PUB + "/{token}/avatar")
def public_avatar(token: str, raw: int = 0):
    rec = _live(token)
    path = store.resolve_avatar_path(rec.avatar_ref)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="形象资源不存在")
    _ns = {"Cache-Control": "no-store"}   # 不缓存:开/关抠像后刷新立刻生效,不被旧图卡住
    # raw=1:强制原图(模糊背景层用,不抠);否则抠像开时 idle 也处理——图片透明 PNG / 视频透明 webm。
    if not raw and _matte_on(rec):
        _sim = _matte_sim(rec)
        if os.path.splitext(path)[1].lower() not in _VIDEO_EXT:
            png = _matte_png_bytes(path, sim=_sim)
            if png:
                return Response(content=png, media_type="image/png", headers=_ns)
        else:
            webm = _matte_video_cached(path, sim=_sim)
            if webm:
                return FileResponse(webm, media_type="video/webm", headers=_ns)
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return FileResponse(path, media_type=mime, headers=_ns)


@digital_human_public_router.websocket(_PUB + "/{token}/presence")
async def public_presence(ws: WebSocket, token: str) -> None:
    rec = published_store.get_by_token(token)
    if not rec or not rec.enabled:
        await ws.close(code=4404)
        return
    await ws.accept()
    await online_presence.join(token, ws)
    try:
        while True:
            # 不消费客户端消息,仅借 receive 感知断开;心跳由前端可选发送。
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        await online_presence.leave(token, ws)


@digital_human_public_router.get(_PUB + "/{token}/viewers")
def public_viewers(token: str) -> Dict[str, int]:
    return {"viewers": online_presence.count(token)}


@digital_human_public_router.post(_PUB + "/{token}/chat")
async def public_chat(token: str, body: Dict[str, Any], request: Request):
    rec = _live(token)
    if not rec.chat_enabled:
        raise HTTPException(status_code=403, detail="该数字人未开放对话")
    if not _rate_ok(token, _client_ip(request), rec.rate_per_min, rec.daily_cap):
        raise HTTPException(status_code=429, detail="访问过于频繁,请稍后再试")

    from chayuan.server.chat.graph import ChatRequest, run_chat_stream

    message = str(body.get("message") or "").strip()[:2000]
    history = body.get("history") or []
    if not message:
        raise HTTPException(status_code=400, detail="消息为空")

    metadata: Dict[str, Any] = {}
    if rec.persona:
        metadata["system"] = rec.persona
    uid = int(rec.owner_id) if (rec.owner_id or "").isdigit() else None

    _ku = list(rec.ku_ids or [])
    req = ChatRequest(
        query=message,
        # 设了知识库 → mode="kb" 强制走 KB 检索问答(与新建对话设了 KB 一致);
        # 否则 mode=None 由 classify 决定,普通提问不会检索 → 用户报「在线没用知识库」。
        mode="kb" if _ku else None,
        history=list(history)[-12:],     # 限制上下文长度
        stream=True,
        model=rec.model or "",
        ku_ids=_ku,
        temperature=0.3,
        user_id=uid,
        governance_enabled=True,
        metadata=metadata,
    )
    logger.info("[dh-public] chat token=%s ku_ids=%d mode=%s", token, len(_ku), "kb" if _ku else "auto")
    return EventSourceResponse(run_chat_stream(req))


@digital_human_public_router.post(_PUB + "/{token}/tts")
def public_tts(token: str, body: Dict[str, Any], request: Request) -> Response:
    rec = _live(token)
    if not rec.chat_enabled:
        raise HTTPException(status_code=403, detail="该数字人未开放对话")
    if not _rate_ok(token, _client_ip(request), rec.rate_per_min, rec.daily_cap):
        raise HTTPException(status_code=429, detail="访问过于频繁,请稍后再试")
    text = str(body.get("text") or "").strip()[:1000]
    if not text:
        raise HTTPException(status_code=400, detail="文本为空")

    voice = dh_jobs._voice_string(rec.voice_provider, rec.voice_name) or "zh-CN-XiaoxiaoNeural"
    try:
        audio = _tts_parallel(text, voice)
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh-public] tts 失败: %r", e)
        raise HTTPException(status_code=503, detail="语音合成不可用")
    return Response(content=audio, media_type="audio/mpeg")


def _split_sentences(text: str) -> list:
    """按中英文句末标点 + 换行切句(标点保留在句尾),去空白片段。"""
    parts = re.split(r"(?<=[。!?！?\n])", text or "")
    return [p.strip() for p in parts if p and p.strip()]


def _tts_parallel(text: str, voice: str) -> bytes:
    """多线程并行合成各句 → 按句序 ffmpeg 拼成一段连续音频(并行加速 + 单段播放无卡顿)。
    单句/拼接失败退回整段单次合成。"""
    from chayuan.server.modality.service import get_modality_service
    svc = get_modality_service()
    sents = _split_sentences(text)
    if len(sents) <= 1:
        return svc.tts(text, voice=voice, fmt="mp3")
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(6, len(sents)), thread_name_prefix="dh-tts") as ex:
        parts = list(ex.map(lambda s: svc.tts(s, voice=voice, fmt="mp3"), sents))  # map 保序=句序
    parts = [p for p in parts if p]
    if not parts:
        return svc.tts(text, voice=voice, fmt="mp3")
    if len(parts) == 1:
        return parts[0]
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        exe = None
    if not exe:
        return b"".join(parts)  # 无 ffmpeg 兜底:裸拼(多数播放器可放)
    with tempfile.TemporaryDirectory() as d:
        files = []
        for i, b in enumerate(parts):
            fp = os.path.join(d, f"{i:04d}.mp3")
            with open(fp, "wb") as f:
                f.write(b)
            files.append(fp)
        listf = os.path.join(d, "list.txt")
        with open(listf, "w", encoding="utf-8") as f:
            for fp in files:
                f.write("file '%s'\n" % fp.replace("'", "'\\''"))
        outf = os.path.join(d, "out.mp3")
        subprocess.run([exe, "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
                        "-i", listf, "-c:a", "libmp3lame", "-q:a", "4", outf], check=True)
        with open(outf, "rb") as f:
            return f.read()


def _apply_atempo(audio: bytes, rate: float, fmt: str) -> bytes:
    """调语速(ffmpeg atempo,保音高)。rate=1 原速;clamp 0.5-2.0。失败返原音频。"""
    try:
        if not audio or abs(rate - 1.0) < 0.02:
            return audio
        r = max(0.5, min(2.0, rate))
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        with tempfile.TemporaryDirectory() as d:
            ext = "wav" if fmt == "wav" else "mp3"
            inp = os.path.join(d, "in." + ext)
            outp = os.path.join(d, "out." + ext)
            with open(inp, "wb") as f:
                f.write(audio)
            subprocess.run([ff, "-y", "-loglevel", "error", "-i", inp,
                            "-af", "atempo=%.3f" % r, outp], check=True)
            with open(outp, "rb") as f:
                return f.read()
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh-public] 语速调整失败,用原速: %r", e)
        return audio


def _say_dims(avatar: str, cap_w: int) -> tuple:
    """该句口型片段尺寸:按形象「原生宽高比」(不拉伸)+ 封顶到 cap_w 宽(在线小窗,压低 CPU 耗时)。"""
    aw = ah = 0
    try:
        if os.path.splitext(avatar)[1].lower() in (".mp4", ".mov", ".webm", ".mkv", ".avi"):
            import cv2 as _cv2
            _c = _cv2.VideoCapture(avatar)
            aw = int(_c.get(_cv2.CAP_PROP_FRAME_WIDTH) or 0); ah = int(_c.get(_cv2.CAP_PROP_FRAME_HEIGHT) or 0)
            _c.release()
        else:
            from PIL import Image as _Img
            with _Img.open(avatar) as _im:
                aw, ah = _im.size
    except Exception:  # noqa: BLE001
        aw = ah = 0
    if aw <= 0 or ah <= 0:
        return cap_w, int(cap_w * 16 / 9)
    if aw > cap_w:
        ah = int(round(ah * cap_w / aw)); aw = cap_w
    aw -= aw % 2; ah -= ah % 2
    return max(2, aw), max(2, ah)


def _say_clip_bytes(rec, text: str, rate: float = 1.0) -> Optional[bytes]:
    """为单句即时生成「该形象对口型说这句」的短视频片段(仅形象口型,不合成商品/场景)。
    返回 mp4 字节;返 None → 调用方回退「纯音频连续播」(阶段0:语音/口型解耦,语音优先连贯)。

    口型路线(见 docs/.../2026-06-05-dh-realtime-scale-arch.md):
    - GPU:跑 wav2lip 出真口型(快)。
    - CPU:默认**不跑** wav2lip(逐句几秒→「说一句停很久」),返 None 走连续音频。
      想在 CPU 上要真口型(接受卡顿)→ 设 CHAYUAN_DH_SAY_FORCE_LIPS=1。
    清晰度/速度:CHAYUAN_DH_SAY_MAX_WIDTH。"""
    try:
        avatar = store.resolve_avatar_path(getattr(rec, "avatar_ref", "") or "")
        if not avatar:
            return None
        from chayuan.server.video_generation.compute import get_compute
        # 在线数字人默认出真口型(用户要嘴唇动);要回退纯音频(更流畅)设 CHAYUAN_DH_SAY_FORCE_LIPS=0。
        _force = os.environ.get("CHAYUAN_DH_SAY_FORCE_LIPS", "1") in ("1", "true", "True")
        if not get_compute().has_cuda:
            if not _force:
                return None   # 显式关:CPU 走连续音频(语音连贯),不逐句 wav2lip 卡顿
            # 强制口型,但若有合成任务在跑 → 让出 CPU,在线本句走纯音频保实时(生成完自动恢复口型)。
            try:
                if dh_jobs.active_generations() > 0:
                    return None
            except Exception:  # noqa: BLE001
                pass
        voice = dh_jobs._voice_string(rec.voice_provider, rec.voice_name) or "zh-CN-XiaoxiaoNeural"
        from chayuan.server.modality.service import get_modality_service
        wav = get_modality_service().tts(text, voice=voice, fmt="wav")
        if not wav:
            return None
        wav = _apply_atempo(wav, rate, "wav")   # 语速:口型跟着变速后的音频对齐
        from chayuan.server.video_generation.digital_human.engine import get_engine
        # 口型片段清晰度:模型恒输出 96x96、与帧分辨率无关,提高 cap 主要只增编码/贴帧开销、
        # 不碰 fwd 瓶颈。默认提到近原生(CPU 960 / GPU 1280),避免「说话比 idle 原图糊一截」。
        # 想更快可设 CHAYUAN_DH_SAY_MAX_WIDTH 调小。
        cap_w = int(os.environ.get("CHAYUAN_DH_SAY_MAX_WIDTH", "0") or 0) \
            or (1280 if get_compute().has_cuda else 960)
        gw, gh = _say_dims(avatar, cap_w)
        with tempfile.TemporaryDirectory() as d:
            ap = os.path.join(d, "say.wav")
            with open(ap, "wb") as f:
                f.write(wav)
            out = os.path.join(d, "say.mp4")
            with _W2L_LOCK:   # 推理串行:首句满速,多请求排队不互抢
                get_engine("wav2lip").generate(avatar_path=avatar, audio_path=ap,
                                               out_path=out, width=gw, height=gh)
            if _matte_on(rec):
                webm = _matte_clip_to_webm(out, avatar, d, sim=_matte_sim(rec))
                if webm:
                    with open(webm, "rb") as f:
                        return f.read()
            with open(out, "rb") as f:
                return f.read()
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh-public] say clip 失败,回退音频: %r", e)
        return None


def _matte_clip_to_webm(mp4: str, avatar: str, d: str, sim=None):
    """抠像:把口型片段按形象背景纯色 colorkey 成透明 webm(vp9 alpha)。失败返 None(用原 mp4)。
    sim(0-1)=用户设的抠图强度;None=自适应。"""
    try:
        kc = _bg_key_color(avatar)
        if not kc:
            return None
        (r, g, b), thr = kc
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        sim = float(sim) if sim is not None else max(0.10, min(0.50, thr / 255.0))
        webm = os.path.join(d, "say.webm")
        vf = "colorkey=0x%02X%02X%02X:%.2f:0.10,format=yuva420p" % (r, g, b, sim)
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", mp4, "-vf", vf,
                        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
                        "-deadline", "realtime", "-cpu-used", "8",  # vp9 提速(质量略降),否则编码很慢
                        "-c:a", "libopus", webm], check=True)
        return webm if os.path.isfile(webm) and os.path.getsize(webm) > 1000 else None
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh-public] 口型片段抠像失败,用原片: %r", e)
        return None


@digital_human_public_router.post(_PUB + "/{token}/say")
def public_say(token: str, body: Dict[str, Any], request: Request) -> Response:
    """实时对话:为一句话即时返回「口型片段」,边生成边播、播完即弃(不落盘成片)。
    自适应:GPU 返回该句口型 mp4(X-Talk-Kind: video);CPU/无形象 返回该句音频 mp3
    (X-Talk-Kind: audio,前端用音频振幅实时驱动口型)。"""
    rec = _live(token)
    if not rec.chat_enabled:
        raise HTTPException(status_code=403, detail="该数字人未开放对话")
    # /say 是一次对话回复按句扇出的多次调用,不能用「每条消息」的 per-min 预算卡它,否则
    # 一句一句被 429 截断、中间没声音。放宽 per-min(×30,至少 300),daily_cap 仍兜底防滥用。
    if not _rate_ok(token, _client_ip(request), max(rec.rate_per_min * 30, 300), rec.daily_cap):
        raise HTTPException(status_code=429, detail="访问过于频繁,请稍后再试")
    text = str(body.get("text") or "").strip()[:300]
    if not text:
        raise HTTPException(status_code=400, detail="文本为空")
    try:
        rate = float(body.get("rate") or 1.0)
    except (TypeError, ValueError):
        rate = 1.0
    clip = _say_clip_bytes(rec, text, rate)
    if clip:
        # 抠像开 → webm(vp9 alpha 透明);否则 mp4。两者前端 <video> 都能播。
        _mt = "video/webm" if _matte_on(rec) else "video/mp4"
        return Response(content=clip, media_type=_mt, headers={"X-Talk-Kind": "video"})
    voice = dh_jobs._voice_string(rec.voice_provider, rec.voice_name) or "zh-CN-XiaoxiaoNeural"
    try:
        audio = _tts_parallel(text, voice)
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh-public] say tts 失败: %r", e)
        raise HTTPException(status_code=503, detail="语音合成不可用")
    audio = _apply_atempo(audio, rate, "mp3")   # 语速调整(viewer 选的倍速)
    return Response(content=audio, media_type="audio/mpeg", headers={"X-Talk-Kind": "audio"})


# ---- (旧)口型一致:整段合成保存视频 —— 已被 /say 句级流式取代,保留兼容 ----
_TALK: Dict[str, list] = {}   # token -> [tid,...];仅本 token 生成的任务可查/取,防枚举


@digital_human_public_router.post(_PUB + "/{token}/talk")
def public_talk(token: str, body: Dict[str, Any], request: Request) -> Dict[str, Any]:
    rec = _live(token)
    if not rec.chat_enabled:
        raise HTTPException(status_code=403, detail="该数字人未开放对话")
    if not _rate_ok(token, _client_ip(request), rec.rate_per_min, rec.daily_cap):
        raise HTTPException(status_code=429, detail="访问过于频繁,请稍后再试")
    text = str(body.get("text") or "").strip()[:1000]
    if not text:
        raise HTTPException(status_code=400, detail="文本为空")
    if not rec.preset_id:
        raise HTTPException(status_code=404, detail="无法生成口型(发布来源缺失)")
    # 复用生成管线:用发布来源 preset 生成该形象对口型说这句的视频(含商品/位置合成)。
    tid = dh_jobs.submit(preset_id=rec.preset_id, text=text,
                         width=rec.video_width, height=rec.video_height)
    lst = _TALK.setdefault(token, [])
    lst.append(tid)
    if len(lst) > 30:
        del lst[:-30]
    return {"task_id": tid}


@digital_human_public_router.get(_PUB + "/{token}/talk/{tid}")
def public_talk_status(token: str, tid: str) -> Dict[str, Any]:
    if tid not in _TALK.get(token, []):
        raise HTTPException(status_code=404, detail="任务不存在")
    st = dh_jobs.get_status(tid)
    return {"state": st.state, "progress": st.progress}


@digital_human_public_router.get(_PUB + "/{token}/talk/{tid}/file")
def public_talk_file(token: str, tid: str) -> FileResponse:
    if tid not in _TALK.get(token, []):
        raise HTTPException(status_code=404, detail="任务不存在")
    st = dh_jobs.get_status(tid)
    if st.state != "complete" or not st.result_path or not os.path.isfile(st.result_path):
        raise HTTPException(status_code=404, detail="视频未就绪")
    return FileResponse(st.result_path, media_type="video/mp4")


# --------------------------------------------------------------------------
# 自包含公开页(原生 JS;__TOKEN__ 在 public_page 里 .replace 注入)
# --------------------------------------------------------------------------
_OFFLINE_PAGE = """<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>数字人已下线</title>
<style>html,body{height:100%;margin:0;background:#0b0d12;color:#cbd5e1;
font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
display:flex;align-items:center;justify-content:center}</style></head>
<body><div>该数字人未发布或已下线。</div></body></html>"""

_PUBLIC_PAGE = """<!doctype html>
<html lang="zh"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>在线数字人</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  html,body{height:100%;margin:0;overflow:hidden;background:#05070c;color:#fff;
    font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
  body{display:flex;align-items:center;justify-content:center}
  /* 全屏模糊背景(同源画面),衬在视频框后(抖音桌面端同款) */
  #bgfull{position:fixed;inset:0;z-index:0;background:radial-gradient(130% 90% at 50% 0%,#1b2436,#05070c);overflow:hidden}
  #bgfull .b{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(34px) brightness(.4);transform:scale(1.2)}
  /* 视频框:按形象比例居中,所有 UI 都在框内 */
  .frame{position:relative;z-index:1;overflow:hidden;background:#000;box-shadow:0 10px 50px rgba(0,0,0,.6)}
  #stage{position:absolute;inset:0;overflow:hidden}
  #stage .fill{position:absolute;display:block;z-index:50;cursor:grab;transition:width .18s,height .18s}
  #stage .fill:active{cursor:grabbing}
  #stage .prod{position:absolute;display:block;z-index:4}
  .grad-top{position:absolute;left:0;right:0;top:0;height:120px;z-index:10;pointer-events:none;background:linear-gradient(180deg,rgba(0,0,0,.55),rgba(0,0,0,0))}
  .grad-bot{position:absolute;left:0;right:0;bottom:0;height:200px;z-index:10;pointer-events:none;background:linear-gradient(0deg,rgba(0,0,0,.65),rgba(0,0,0,0))}
  .top{position:absolute;left:10px;right:10px;top:10px;z-index:30;display:flex;align-items:center;gap:8px}
  .ava{width:36px;height:36px;border-radius:50%;background:#2a3346;border:2px solid rgba(255,255,255,.55);object-fit:cover;flex-shrink:0}
  .who{flex:1;min-width:0}
  .nm{font-size:14px;font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .live{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:800;color:#fff;background:linear-gradient(90deg,#fe2c55,#ff5a5f);padding:2px 6px;border-radius:5px;margin-right:5px}
  .vw{font-size:11px;color:#dbe2ea;text-shadow:0 1px 3px rgba(0,0,0,.7);white-space:nowrap}
  .cmts{position:absolute;left:10px;bottom:66px;z-index:20;width:70%;max-width:300px;max-height:11.5em;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;overflow-y:auto;pointer-events:auto;scrollbar-width:none;-ms-overflow-style:none}
  .cmts::-webkit-scrollbar{width:0;height:0;display:none}
  .cmt{align-self:flex-start;max-width:100%;padding:6px 10px;border-radius:13px;font-size:13px;line-height:1.4;background:rgba(0,0,0,.42);backdrop-filter:blur(3px);box-shadow:0 2px 8px rgba(0,0,0,.35);word-break:break-word;animation:rise .3s ease}
  .cmt b{color:#7cc4ff;font-weight:600;margin-right:4px}
  .cmt.ai b{color:#ffd27c}
  @keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  .cap{position:absolute;left:8%;right:8%;bottom:108px;z-index:25;text-align:center;font-size:16px;font-weight:600;text-shadow:0 2px 8px rgba(0,0,0,.9);pointer-events:none;min-height:22px}
  .acts{position:absolute;right:8px;bottom:84px;z-index:30;display:flex;flex-direction:column;gap:16px;align-items:center}
  .acts button{width:44px;height:44px;border-radius:50%;border:0;background:rgba(255,255,255,.15);color:#fff;font-size:21px;cursor:pointer;backdrop-filter:blur(5px)}
  .hearts{position:absolute;right:14px;bottom:130px;z-index:29;pointer-events:none;width:50px;height:50%}
  .heart{position:absolute;bottom:0;font-size:24px;animation:floatup 2.6s ease-in forwards}
  @keyframes floatup{0%{opacity:0;transform:translateY(0) scale(.6)}15%{opacity:1}100%{opacity:0;transform:translateY(-46vh) translateX(var(--dx,0)) scale(1.1)}}
  .bar{position:absolute;left:10px;right:66px;bottom:10px;z-index:30;display:flex;flex-wrap:nowrap;gap:7px}
  .bar input{flex:1;min-width:0;height:42px;padding:0 14px;border-radius:21px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.42);backdrop-filter:blur(6px);color:#fff;font-size:14px;outline:none}
  .bar button{flex:none;height:42px;padding:0 15px;border-radius:21px;border:0;background:linear-gradient(90deg,#fe2c55,#ff5a5f);color:#fff;font-size:14px;font-weight:600;cursor:pointer}
  .bar .cc{flex:none;height:42px;padding:0 13px;border-radius:21px;border:1px solid rgba(255,255,255,.22);background:rgba(0,0,0,.42);backdrop-filter:blur(6px);color:#cdd5df;font-size:13px;font-weight:600;cursor:pointer}
  .shop{position:absolute;left:10px;right:10px;bottom:60px;z-index:35;max-height:54%;overflow-y:auto;display:none;flex-direction:column;gap:8px;padding:10px;border-radius:14px;background:rgba(12,16,24,.92);backdrop-filter:blur(10px);box-shadow:0 8px 30px rgba(0,0,0,.5);scrollbar-width:none}
  .shop::-webkit-scrollbar{display:none}
  .shop.open{display:flex}
  .shop .hd{display:flex;align-items:center;font-size:13px;font-weight:700;color:#fff}
  .shop .hd .x{margin-left:auto;cursor:pointer;color:#9aa6b2;font-size:18px;line-height:1}
  .shopitem{display:flex;gap:10px;align-items:center;padding:8px;border-radius:10px;background:rgba(255,255,255,.06);cursor:pointer}
  .shopitem:hover{background:rgba(255,255,255,.12)}
  .shopitem img,.shopitem video{width:52px;height:52px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#222}
  .shopitem .info{min-width:0;flex:1}
  .shopitem .t{font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .shopitem .p{font-size:13px;font-weight:700;color:#ff5a5f;margin-top:1px}
  .shopitem .d{font-size:11px;color:#9aa6b2;margin-top:1px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .shopitem .go{flex-shrink:0;font-size:12px;color:#fff;background:linear-gradient(90deg,#fe2c55,#ff5a5f);padding:5px 10px;border-radius:14px}
  .bar .cc.on{color:#fff;border-color:transparent;background:rgba(255,255,255,.22)}
  .bar .cc.on::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:#3ddc84;margin-right:5px;vertical-align:middle}
  .bar button:disabled{opacity:.5}
  .tip{position:fixed;left:0;right:0;top:50%;z-index:40;text-align:center;color:#94a3b8;font-size:13px}
</style></head>
<body>
  <div id="bgfull"></div>
  <div class="frame" id="frame">
    <div id="stage"></div>
    <div class="grad-top"></div><div class="grad-bot"></div>
    <div class="top">
      <img class="ava" id="ava" alt=""/>
      <div class="who"><div class="nm" id="name">在线数字人</div></div>
      <span class="live">● LIVE</span><span class="vw"><span id="viewers">0</span> 在看</span>
    </div>
    <div class="cmts" id="msgs"></div>
    <div class="cap" id="cap"></div>
    <div class="acts" id="acts" style="display:none">
      <button id="like" title="点赞">❤️</button>
      <button id="share" title="分享">↗</button>
    </div>
    <div class="hearts" id="hearts"></div>
    <div class="shop" id="shop"></div>
    <div class="bar" id="bar" style="display:none">
      <button id="shopbtn" class="cc" title="商品橱窗" style="display:none">🛍</button>
      <input id="inp" placeholder="说点什么…" autocomplete="off"/>
      <button id="cc" class="cc on" title="开/关大模型回复与对话内容(漂浮气泡)">字幕</button>
      <button id="send">发送</button>
    </div>
  </div>
  <div class="tip" id="tip"></div>
<script>
(function(){
  var token="__TOKEN__", base="/api/v1/digital-human/public/"+token;
  var frame=document.getElementById("frame"), bgfull=document.getElementById("bgfull"),
      stage=document.getElementById("stage"), msgs=document.getElementById("msgs"), cap=document.getElementById("cap"),
      nameEl=document.getElementById("name"), viewersEl=document.getElementById("viewers"), avaEl=document.getElementById("ava"),
      inp=document.getElementById("inp"), sendBtn=document.getElementById("send"), ccBtn=document.getElementById("cc"),
      bar=document.getElementById("bar"), acts=document.getElementById("acts"), hearts=document.getElementById("hearts"), tip=document.getElementById("tip"),
      shopEl=document.getElementById("shop"), shopBtn=document.getElementById("shopbtn");
  var history=[], busy=false, avatarUrl=null, avatarKind="image", ratioW=720, ratioH=1280, avatarBox=null, fsMode=false, msgsOn=true;
  // 「字幕」开关:开/关屏幕上不断输出的大模型回复 + 对话内容(漂浮气泡流),不影响讲话字幕
  ccBtn.addEventListener("click", function(){ msgsOn=!msgsOn; ccBtn.classList.toggle("on", msgsOn); msgs.style.display = msgsOn ? "flex" : "none"; });
  function showCap(t){ cap.textContent = t||""; }   // 讲话字幕始终显示

  function fitFrame(){
    var vh=window.innerHeight, vw=window.innerWidth;
    var fh=vh, fw=Math.round(fh*ratioW/ratioH);
    if(fw>vw){ fw=vw; fh=Math.round(fw*ratioH/ratioW); }
    frame.style.width=fw+"px"; frame.style.height=fh+"px";
  }
  window.addEventListener("resize", fitFrame);

  function mkAvatar(url,kind){
    var el=(kind==="video")?document.createElement("video"):document.createElement("img"); el.src=url;
    if(kind==="video"){ el.autoplay=true; el.muted=true; el.loop=true; el.playsInline=true; el.setAttribute("playsinline",""); }
    return el;
  }
  function setBg(){ if(!avatarUrl)return;
    // 模糊背景只放在视频框「外」(桌面端两侧),用原图(raw)不抠;框「内」不再铺模糊大图,
    // 避免形象看起来变成了背景。
    var b=mkAvatar(avatarUrl+"?raw=1",avatarKind); b.className="b"; bgfull.appendChild(b); }
  // 形象定位:全屏(fsMode)铺满 / 否则按制作参数 x/y/scale 小窗显示;无参数则铺满
  // 形象 = 前景小窗 PIP(恒在素材之上 z=50);全屏时铺满盖住一切(z=9999)。
  function styleAvatar(el){ var s=el.style;
    if(fsMode){ s.left="0";s.top="0";s.width="100%";s.height="100%";s.objectFit="cover";s.objectPosition="center bottom";s.zIndex="9999"; }
    else if(avatarBox){ var sc=(avatarBox.scale&&avatarBox.scale>0)?avatarBox.scale:1;
      s.left=((avatarBox.x||0)*100)+"%";s.top=((avatarBox.y||0)*100)+"%";s.width=(sc*100)+"%";s.height="auto";s.objectFit="";s.objectPosition="";s.zIndex="50"; }
    else { s.left="0";s.top="0";s.width="100%";s.height="100%";s.objectFit="cover";s.objectPosition="center bottom";s.zIndex="50"; } }
  // 形象小窗:可拖拽移动;单击(未拖动)切「全屏 <-> 原位」。拖动实时写回 avatarBox,
  // 切全屏再切回时回到拖到的新位置。
  function makeInteractive(el){
    el.style.touchAction="none";
    var sx=0, sy=0, baseX=0, baseY=0, dragging=false, moved=false;
    el.addEventListener("pointerdown", function(e){
      sx=e.clientX; sy=e.clientY; moved=false;
      if(!fsMode){ dragging=true; baseX=(avatarBox&&avatarBox.x)||0; baseY=(avatarBox&&avatarBox.y)||0;
        try{ el.setPointerCapture(e.pointerId); }catch(_){}}
      e.preventDefault();
    });
    el.addEventListener("pointermove", function(e){
      if(!dragging) return;
      var fr=frame.getBoundingClientRect(), dx=e.clientX-sx, dy=e.clientY-sy;
      if(Math.abs(dx)>4||Math.abs(dy)>4) moved=true;
      var nx=Math.max(0,Math.min(0.97, baseX+dx/fr.width)), ny=Math.max(0,Math.min(0.97, baseY+dy/fr.height));
      if(avatarBox){ avatarBox.x=nx; avatarBox.y=ny; }
      el.style.left=(nx*100)+"%"; el.style.top=(ny*100)+"%";
    });
    el.addEventListener("pointerup", function(e){
      var wasDrag=dragging; dragging=false; try{ el.releasePointerCapture(e.pointerId); }catch(_){}
      if(!moved){ fsMode=!fsMode; styleAvatar(el); }   // 单击:全屏 <-> 原位
    });
  }
  function idleAvatar(){ if(!avatarUrl)return; var el=mkAvatar(avatarUrl,avatarKind); el.className="fill"; styleAvatar(el); makeInteractive(el);
    el.onerror=function(){ el.onerror=null; el.src=avatarUrl+"?raw=1"; };   // 抠像接口失败 → 回退原图,形象不至于空白
    var old=stage.querySelector(".fill"); if(old) old.replaceWith(el); else stage.appendChild(el); }
  function addProduct(p,i){ var el=mkAvatar(p.url,p.kind); el.className="prod";
    el.style.left=((p.x||0)*100)+"%"; el.style.top=((p.y||0)*100)+"%";
    el.style.width=(((p.scale&&p.scale>0)?p.scale:0.32)*100)+"%"; el.style.zIndex=(p.z!=null?p.z:i); el.style.opacity=(p.opacity!=null?p.opacity:1);
    if(p.link){ el.style.cursor="pointer"; el.style.pointerEvents="auto"; el.title="点击查看";
      el.addEventListener("click", function(){ try{ window.open(p.link, "_blank", "noopener"); }catch(_){}}); }
    stage.appendChild(el); }

  // 橱窗:有填链接的商品才显示「🛍」按钮;点击展开清单,点条目开链接。
  function buildShop(items){
    if(!items || !items.length){ shopBtn.style.display="none"; return; }
    shopBtn.style.display="inline-flex";
    shopEl.innerHTML="";
    var hd=document.createElement("div"); hd.className="hd";
    var t=document.createElement("span"); t.textContent="商品橱窗 ("+items.length+")"; hd.appendChild(t);
    var x=document.createElement("span"); x.className="x"; x.textContent="×";
    x.addEventListener("click", function(){ shopEl.classList.remove("open"); }); hd.appendChild(x);
    shopEl.appendChild(hd);
    items.forEach(function(p){
      var it=document.createElement("div"); it.className="shopitem";
      it.appendChild(mkAvatar(p.url, p.kind==="video"?"video":"image"));
      var info=document.createElement("div"); info.className="info";
      var tt=document.createElement("div"); tt.className="t"; tt.textContent=p.title||"商品"; info.appendChild(tt);
      if(p.price){ var pr=document.createElement("div"); pr.className="p"; pr.textContent=p.price; info.appendChild(pr); }
      if(p.desc){ var dd=document.createElement("div"); dd.className="d"; dd.textContent=p.desc; info.appendChild(dd); }
      it.appendChild(info);
      var go=document.createElement("span"); go.className="go"; go.textContent="去看看"; it.appendChild(go);
      it.addEventListener("click", function(){ try{ window.open(p.link, "_blank", "noopener"); }catch(_){}});
      shopEl.appendChild(it);
    });
  }
  shopBtn.addEventListener("click", function(){ shopEl.classList.toggle("open"); });

  function addMsg(role,text){ var d=document.createElement("div"); d.className="cmt "+(role==="user"?"":"ai");
    var b=document.createElement("b"); b.textContent=(role==="user"?"我":"TA"); d.appendChild(b);
    var s=document.createElement("span"); s.textContent=text; d.appendChild(s); msgs.appendChild(d);
    while(msgs.children.length>40){ msgs.firstChild.remove(); }   // 保留较多历史供上下滚动,可视区约 10 行
    msgs.scrollTop=msgs.scrollHeight; return s; }

  fetch(base+"/config").then(function(r){ if(!r.ok) throw 0; return r.json(); }).then(function(cfg){
    nameEl.textContent=cfg.name||"在线数字人"; document.title=cfg.name||"在线数字人";
    if(cfg.ratio&&cfg.ratio.w&&cfg.ratio.h){ ratioW=cfg.ratio.w; ratioH=cfg.ratio.h; } fitFrame();
    if(cfg.avatar){ avatarUrl=cfg.avatar.url; avatarKind=cfg.avatar.kind||"image"; avatarBox=cfg.avatar; avaEl.src=avatarUrl; setBg(); idleAvatar(); }
    (cfg.products||[]).forEach(addProduct); viewersEl.textContent=cfg.viewers||0;
    buildShop((cfg.products||[]).filter(function(p){ return p.link && p.link.trim(); }));
    if(cfg.welcome && cfg.welcome.trim()){ addMsg("assistant", cfg.welcome.trim()); }   // 欢迎语开场白
    if(cfg.idle_script && cfg.idle_script.trim()){ idleSents=splitScript(cfg.idle_script); idleOn=true; feedIdle(); }   // 无人提问时循环播报
    if(cfg.chat_enabled){ bar.style.display="flex"; acts.style.display="flex"; } else { tip.textContent="该数字人当前仅供观看"; }
  }).catch(function(){ tip.textContent="该数字人未发布或已下线。"; });

  try{ var proto=location.protocol==="https:"?"wss":"ws"; var ws=new WebSocket(proto+"://"+location.host+base+"/presence");
    ws.onmessage=function(ev){ try{ var d=JSON.parse(ev.data); if(d&&d.op==="viewers") viewersEl.textContent=d.n; }catch(e){} }; }catch(e){}

  document.getElementById("like").addEventListener("click", function(){ for(var i=0;i<3;i++) spawnHeart(i*120); });
  function spawnHeart(delay){ setTimeout(function(){ var h=document.createElement("div"); h.className="heart";
    h.textContent=["❤️","💖","💕","🧡"][(Math.random()*4)|0];
    h.style.left=(6+Math.random()*26)+"px"; h.style.setProperty("--dx",((Math.random()*50-25)|0)+"px");
    hearts.appendChild(h); setTimeout(function(){ h.remove(); },2600); }, delay); }
  document.getElementById("share").addEventListener("click", function(){
    var u=location.href; if(navigator.share){ navigator.share({title:document.title,url:u}).catch(function(){}); }
    else { try{ navigator.clipboard.writeText(u); tip.textContent="链接已复制"; setTimeout(function(){tip.textContent="";},1500);}catch(e){} } });

  var sentQ=[], results={}, fetchSeq=0, playSeq=0, inflight=0, playing=false, MAXC=2;
  var genId=0, curMedia=null, clipCache={}, clipKeys=[];   // 打断 + 片段缓存(idle 循环复用,不重复合成)
  var idleSents=[], idleIdx=0, idleOn=false;
  function once(fn){ var c=false; return function(){ if(c)return; c=true; fn(); }; }
  function cacheClip(text,o){ if(clipCache[text])return; clipCache[text]=o; clipKeys.push(text);
    while(clipKeys.length>60){ delete clipCache[clipKeys.shift()]; } }
  function playAudio(blob,text,done){ var url=URL.createObjectURL(blob), a=new Audio(url); curMedia=a;
    var fin=once(function(){ try{URL.revokeObjectURL(url);}catch(e){} if(curMedia===a)curMedia=null; cap.textContent=""; done&&done(); });
    showCap(text); a.onended=fin; a.onerror=fin; a.play().catch(fin); }
  function playClip(blob,text,done){ var url=URL.createObjectURL(blob), v=document.createElement("video"); curMedia=v;
    v.src=url; v.autoplay=true; v.playsInline=true; v.setAttribute("playsinline",""); v.className="fill"; styleAvatar(v); makeInteractive(v); showCap(text);
    var fin=once(function(){ try{URL.revokeObjectURL(url);}catch(e){} if(curMedia===v)curMedia=null; cap.textContent=""; idleAvatar(); done&&done(); });
    v.onended=fin; v.onerror=fin; var old=stage.querySelector(".fill"); if(old) old.replaceWith(v); else stage.appendChild(v); v.play().catch(fin); }
  // 多路并发合成(MAXC 路);结果按句序 seq 存入 results,playPump 严格顺序播放;
  // gen 不匹配(已被提问打断)的在途结果直接丢弃,只缓存供 idle 复用。
  function synthPump(){ while(inflight<MAXC && sentQ.length){ var it=sentQ.shift(); inflight++;
    (function(seq,text,gen){
      fetch(base+"/say",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:text})})
        .then(function(r){ if(!r.ok) throw 0; var kind=(r.headers.get("X-Talk-Kind")||"audio");
          return r.blob().then(function(b){ var o={kind:kind,blob:b,text:text}; cacheClip(text,o); if(gen===genId) results[seq]=o; }); })
        .catch(function(){ if(gen===genId) results[seq]={skip:true}; })
        .then(function(){ inflight--; synthPump(); playPump(); });
    })(it.seq, it.text, it.gen);
  } }
  function playPump(){ if(playing)return; var o=results[playSeq];
    if(!o){ feedIdle(); return; }
    delete results[playSeq]; playSeq++;
    if(o.skip){ playPump(); return; }
    playing=true; var done=once(function(){ playing=false; playPump(); });
    if(o.kind==="video") playClip(o.blob,o.text,done); else playAudio(o.blob,o.text,done); }
  function enqueueSay(t){ if(!t||!t.trim())return; t=t.trim(); var seq=fetchSeq++;
    var c=clipCache[t]; if(c){ results[seq]={kind:c.kind,blob:c.blob,text:t}; playPump(); return; }  // 命中缓存:直接排播,不再合成
    sentQ.push({seq:seq, text:t, gen:genId}); synthPump(); }
  // 提问打断:停当前播放 + 清队列 + bump gen(在途合成结果作废);clipCache 保留供 idle 复用
  function interrupt(){ genId++; sentQ=[]; results={}; fetchSeq=0; playSeq=0; playing=false;
    if(curMedia){ try{ curMedia.pause(); }catch(_){} curMedia.onended=null; curMedia.onerror=null; curMedia=null; }
    cap.textContent=""; idleAvatar(); }
  // idle 循环:空闲(非回答中、队列空、无播放)时喂下一句循环脚本(到尾循环回开头)
  function feedIdle(){ if(!idleOn || busy || !idleSents.length) return;
    if(sentQ.length || inflight || playing) return;
    enqueueSay(idleSents[idleIdx % idleSents.length]); idleIdx++; }
  function splitScript(s){ return (s||"").split(/[。!?！?…\\n]/).map(function(x){ return x.trim(); }).filter(Boolean); }

  function send(){ var text=(inp.value||"").trim(); if(!text||busy)return;
    busy=true; sendBtn.disabled=true; interrupt(); inp.value=""; addMsg("user",text); history.push({role:"user",content:text});
    var aiSpan=addMsg("assistant","…"); var acc="", sayPos=0;
    // 断句:句末标点(。!?…\\n)总是断;逗号/顿号/分号在累计≥10字时也断 → 首句更快出声、又不过碎。
    function flush(final){ var rest=acc.slice(sayPos), last=0, i;
      for(i=0;i<rest.length;i++){ var ch=rest.charAt(i);
        var hard=("。!?！?…\\n".indexOf(ch)>=0), soft=(",，、;;:".indexOf(ch)>=0);
        if(hard || (soft && (i-last)>=10)){ var s=rest.slice(last,i+1).trim(); if(s) enqueueSay(s); last=i+1; } }
      sayPos+=last; if(final){ var tail=acc.slice(sayPos).trim(); if(tail){ enqueueSay(tail); sayPos=acc.length; } } }
    fetch(base+"/chat",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({message:text,history:history})}).then(function(res){
      if(res.status===429){ aiSpan.textContent="访问过于频繁,请稍后再试"; throw 0; }
      if(!res.ok||!res.body){ aiSpan.textContent="对话暂不可用"; throw 0; }
      var reader=res.body.getReader(), dec=new TextDecoder(), buf="";
      function pump(){ return reader.read().then(function(r2){ if(r2.done)return;
        buf+=dec.decode(r2.value,{stream:true}).replace(/\\r/g,""); var idx;
        while((idx=buf.indexOf("\\n\\n"))>=0){ var block=buf.slice(0,idx); buf=buf.slice(idx+2); var ev="message", data="";
          block.split("\\n").forEach(function(line){ if(line.indexOf("event:")===0) ev=line.slice(6).trim(); else if(line.indexOf("data:")===0) data+=line.slice(5).trim(); });
          if(ev==="token"){ try{ var d=JSON.parse(data); if(d&&d.delta){ acc+=d.delta; aiSpan.textContent=acc; msgs.scrollTop=msgs.scrollHeight; flush(false); } }catch(e){} } }
        return pump(); }); }
      return pump();
    }).then(function(){ if(acc){ history.push({role:"assistant",content:acc}); flush(true); } else if(aiSpan.textContent==="…"){ aiSpan.textContent="(无回复)"; }
    }).catch(function(){}).then(function(){ busy=false; sendBtn.disabled=false; inp.focus(); }); }
  sendBtn.addEventListener("click",send); inp.addEventListener("keydown",function(e){ if(e.key==="Enter") send(); });
})();
</script>
</body></html>"""
