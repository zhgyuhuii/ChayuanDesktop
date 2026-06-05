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
    prods = [{
        "kind": p.kind, "x": p.x, "y": p.y, "scale": p.scale,
        "z": p.z, "opacity": p.opacity,
        "url": base + "/product?ref=" + quote(p.ref),
    } for p in (rec.products or [])]
    return {
        "name": rec.name,
        "ratio": {"w": rec.video_width, "h": rec.video_height},
        "chat_enabled": bool(rec.chat_enabled),
        "viewers": online_presence.count(token),
        "avatar": {
            "kind": rec.avatar_kind, "x": rec.avatar_x, "y": rec.avatar_y,
            "scale": rec.avatar_scale, "opacity": rec.avatar_opacity,
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


@digital_human_public_router.get(_PUB + "/{token}/avatar")
def public_avatar(token: str) -> FileResponse:
    rec = _live(token)
    path = store.resolve_avatar_path(rec.avatar_ref)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="形象资源不存在")
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return FileResponse(path, media_type=mime)


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

    req = ChatRequest(
        query=message,
        history=list(history)[-12:],     # 限制上下文长度
        stream=True,
        model=rec.model or "",
        ku_ids=list(rec.ku_ids or []),
        temperature=0.3,
        user_id=uid,
        governance_enabled=True,
        metadata=metadata,
    )
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


def _say_clip_bytes(rec, text: str, rate: float = 1.0) -> Optional[bytes]:
    """GPU 路径:为单句即时生成「该形象对口型说这句」的短视频片段(仅形象口型,不合成
    商品/场景,实时优先)。返回 mp4 字节;无 GPU / 无形象 / 失败 → None(调用方回退纯音频)。"""
    try:
        from chayuan.server.video_generation.compute import get_compute
        if not get_compute().has_cuda:
            return None  # CPU:不跑 wav2lip(逐句也太慢),走音频流式 + 前端口型动画
        avatar = store.resolve_avatar_path(getattr(rec, "avatar_ref", "") or "")
        if not avatar:
            return None
        voice = dh_jobs._voice_string(rec.voice_provider, rec.voice_name) or "zh-CN-XiaoxiaoNeural"
        from chayuan.server.modality.service import get_modality_service
        wav = get_modality_service().tts(text, voice=voice, fmt="wav")
        if not wav:
            return None
        wav = _apply_atempo(wav, rate, "wav")   # 语速:口型跟着变速后的音频对齐
        from chayuan.server.video_generation.digital_human.engine import get_engine
        with tempfile.TemporaryDirectory() as d:
            ap = os.path.join(d, "say.wav")
            with open(ap, "wb") as f:
                f.write(wav)
            out = os.path.join(d, "say.mp4")
            gw, gh = dh_jobs._gen_dims(rec.video_width, rec.video_height)
            get_engine("wav2lip").generate(avatar_path=avatar, audio_path=ap,
                                           out_path=out, width=gw, height=gh)
            with open(out, "rb") as f:
                return f.read()
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh-public] say clip 失败,回退音频: %r", e)
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
        return Response(content=clip, media_type="video/mp4", headers={"X-Talk-Kind": "video"})
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
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>在线数字人</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;background:#0b0d12;color:#e5e7eb;
    font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
  /* 直播式固定布局:整页恰好一屏(height:100%,不随消息增长撑高/滚动 → 视频不会被顶走);
     视频固定(flex-shrink:0 不被压扁),文字在下方区域内部滚屏。 */
  .wrap{max-width:520px;height:100%;margin:0 auto;display:flex;flex-direction:column;gap:10px;padding:12px;overflow:hidden}
  .head{flex-shrink:0;display:flex;align-items:center;justify-content:space-between}
  .name{font-size:18px;font-weight:600}
  .viewers{font-size:13px;color:#94a3b8;display:flex;align-items:center;gap:6px}
  .dot{width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block}
  .stage{flex-shrink:0;background:#000;border-radius:14px;overflow:hidden;
    box-shadow:0 8px 30px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center}
  .stage img,.stage video{width:100%;height:100%;object-fit:contain;display:block}
  .chat{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}
  .msgs{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px 0}
  .msg{max-width:85%;padding:8px 12px;border-radius:12px;white-space:pre-wrap;word-break:break-word}
  .me{align-self:flex-end;background:#2563eb;color:#fff;border-bottom-right-radius:4px}
  .ai{align-self:flex-start;background:#1f2937;color:#e5e7eb;border-bottom-left-radius:4px}
  .bar{display:flex;gap:8px}
  .bar input{flex:1;height:40px;padding:0 12px;border-radius:10px;border:1px solid #334155;
    background:#0f172a;color:#e5e7eb;font-size:15px;outline:none}
  .bar button{height:40px;padding:0 16px;border-radius:10px;border:0;background:#2563eb;color:#fff;
    font-size:15px;cursor:pointer}
  .bar button:disabled{opacity:.5;cursor:default}
  .tip{font-size:12px;color:#64748b;text-align:center}
</style></head>
<body>
<div class="wrap">
  <div class="head">
    <div class="name" id="name">在线数字人</div>
    <div class="viewers"><span class="dot"></span><span id="viewers">0</span> 人在看</div>
  </div>
  <div class="stage" id="stage"></div>
  <div class="chat" id="chat" style="display:none">
    <div class="msgs" id="msgs"></div>
    <div class="bar">
      <input id="inp" placeholder="跟 TA 说点什么…" autocomplete="off"/>
      <select id="speed" title="语速" style="height:40px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#e5e7eb;font-size:14px;padding:0 6px;outline:none">
        <option value="0.8">0.8x</option>
        <option value="1" selected>1.0x</option>
        <option value="1.25">1.25x</option>
        <option value="1.5">1.5x</option>
      </select>
      <button id="send">发送</button>
    </div>
  </div>
  <div class="tip" id="tip"></div>
</div>
<script>
(function(){
  var token = "__TOKEN__";
  var base = "/api/v1/digital-human/public/" + token;
  var nameEl = document.getElementById("name");
  var viewersEl = document.getElementById("viewers");
  var stage = document.getElementById("stage");
  var chat = document.getElementById("chat");
  var msgs = document.getElementById("msgs");
  var speedEl = document.getElementById("speed");
  var inp = document.getElementById("inp");
  var sendBtn = document.getElementById("send");
  var tip = document.getElementById("tip");
  var history = [];
  var busy = false;

  function fitStage(w, h){
    // 显式像素宽高(不依赖 CSS aspect-ratio —— 舞台内全是绝对定位子元素,无内容高度;
    // 若引擎不支持 aspect-ratio,舞台高度会塌成 0 → 形象/一切都看不见,这是「没有形象」根因)。
    w = w || 720; h = h || 1280;
    var maxH = Math.round(window.innerHeight * 0.5);  // 视频占上半屏,下半屏留给滚屏文字(直播感)
    var maxW = (stage.parentElement && stage.parentElement.clientWidth) || 480;
    var scale = Math.min(maxW / w, maxH / h);
    if (!(scale > 0)) scale = maxH / h;
    stage.style.width = Math.round(w * scale) + "px";
    stage.style.height = Math.round(h * scale) + "px";
    stage.style.margin = "0 auto";
  }

  function addMsg(role, text){
    var d = document.createElement("div");
    d.className = "msg " + (role === "user" ? "me" : "ai");
    d.textContent = text;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }

  function addLayer(L, i, isAvatar){
    var el = document.createElement("div");
    el.style.position = "absolute";
    el.style.zIndex = (L.z != null ? L.z : i);
    el.style.opacity = (L.opacity != null ? L.opacity : 1);
    var m;
    if (L.kind === "video") {
      m = document.createElement("video");
      m.src = L.url; m.autoplay = true; m.muted = true; m.loop = true; m.playsInline = true;
      m.setAttribute("playsinline", "");
    } else {
      m = document.createElement("img"); m.src = L.url;
    }
    m.onerror = function(){
      try{ console.error("[dh-public] 图层加载失败 kind=" + L.kind + " url=" + L.url); }catch(e){}
      if(isAvatar){
        try{
          el.style.cssText="position:absolute;inset:0;display:flex;align-items:center;justify-content:center";
          el.innerHTML="";
          var ph=document.createElement("div");
          ph.textContent="形象加载失败(/avatar 资源缺失)";
          ph.style.cssText="color:#f87171;background:#1f2937;padding:10px 14px;border-radius:10px;font-size:13px;text-align:center";
          el.appendChild(ph);
        }catch(e){}
      }
    };
    if (isAvatar) {
      // 形象铺满舞台 + object-fit:contain —— 最稳,绝不塌成 0 高(舞台已有显式像素高度)。
      // 在线 idle 优先「看得见」,不再按 x/y/scale 摆位(商品仍按位置叠在形象上)。
      el.style.inset = "0";
      m.style.width = "100%"; m.style.height = "100%"; m.style.objectFit = "contain"; m.style.display = "block";
    } else {
      el.style.left = ((L.x || 0) * 100) + "%";
      el.style.top = ((L.y || 0) * 100) + "%";
      var sc = (L.scale && L.scale > 0) ? L.scale : 0.32;
      el.style.width = (sc * 100) + "%";
      m.style.width = "100%"; m.style.height = "auto"; m.style.display = "block";
    }
    el.appendChild(m);
    stage.appendChild(el);
  }

  fetch(base + "/config").then(function(r){
    if(!r.ok) throw new Error("offline");
    return r.json();
  }).then(function(cfg){
    try{ console.log("[dh-public] config", JSON.stringify(cfg.avatar), "products=" + ((cfg.products||[]).length)); }catch(e){}
    nameEl.textContent = cfg.name || "在线数字人";
    document.title = cfg.name || "在线数字人";
    fitStage((cfg.ratio && cfg.ratio.w) || 720, (cfg.ratio && cfg.ratio.h) || 1280);
    stage.style.position = "relative";
    stage.innerHTML = "";
    if (cfg.avatar) addLayer(cfg.avatar, 0, true);     // 形象按设置的大小/位置 idle 展示
    (cfg.products || []).forEach(function(p, i){ addLayer(p, i + 1, false); });  // 商品图/视频
    viewersEl.textContent = cfg.viewers || 0;
    if (cfg.chat_enabled) { chat.style.display = "flex"; } else { tip.textContent = "该数字人当前仅供观看"; }
  }).catch(function(){
    stage.innerHTML = ""; tip.textContent = "该数字人未发布或已下线。";
  });

  // presence WebSocket
  try{
    var proto = location.protocol === "https:" ? "wss" : "ws";
    var ws = new WebSocket(proto + "://" + location.host + base + "/presence");
    ws.onmessage = function(ev){
      try{ var d = JSON.parse(ev.data); if(d && d.op === "viewers") viewersEl.textContent = d.n; }catch(e){}
    };
  }catch(e){}

  // ── 实时对话:句级流式 /say,生产者(取)/消费者(播)分离,各自严格顺序 ────────
  // 后端自适应:GPU 返回该句口型 mp4(覆盖播放,真口型);CPU 返回该句音频实时播。
  // CPU 上无人脸关键点做不出真口型,故不在脸上画假嘴(会「只剩下嘴」),改用边框辉光按
  // 音量律动提示「正在说话」,形象始终完整保留。一个 fetcher 顺序取、一个 player 顺序播,
  // 边播当前句边预取下一句(流畅且不乱序)。
  var sentQ = [], fetching = false, playQ = [], playing = false, audioCtx = null;
  function once(fn){ var c = false; return function(){ if(c) return; c = true; fn(); }; }

  function playAudio(blob, done){
    var url = URL.createObjectURL(blob), a = new Audio(url);
    var raf = 0, fin = once(function(){ if(raf) cancelAnimationFrame(raf); stage.style.boxShadow=""; try{URL.revokeObjectURL(url);}catch(e){} done&&done(); });
    try{
      audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state === "suspended") audioCtx.resume();
      var srcN = audioCtx.createMediaElementSource(a), an = audioCtx.createAnalyser();
      an.fftSize = 256; srcN.connect(an); an.connect(audioCtx.destination);
      var data = new Uint8Array(an.frequencyBinCount);
      (function tick(){
        an.getByteTimeDomainData(data);
        var sum=0; for(var i=0;i<data.length;i++){ var v=(data[i]-128)/128; sum+=v*v; }
        var rms = Math.sqrt(sum/data.length), g = Math.min(30, 6 + rms*95);
        stage.style.boxShadow = "0 0 " + g.toFixed(0) + "px rgba(56,189,248,0.55)";
        raf = requestAnimationFrame(tick);
      })();
    }catch(e){ /* WebAudio 不可用:仍播音频,只是没有辉光律动 */ }
    a.onended = fin; a.onerror = fin;
    a.play().catch(fin);
  }

  function playClip(blob, done){
    var url = URL.createObjectURL(blob), ov = document.createElement("video");
    ov.src = url; ov.autoplay = true; ov.playsInline = true; ov.setAttribute("playsinline","");
    var s = ov.style; s.position="absolute"; s.inset="0"; s.width="100%"; s.height="100%";
    s.objectFit="contain"; s.background="#000"; s.zIndex="999";
    var fin = once(function(){ try{ov.remove();}catch(e){} try{URL.revokeObjectURL(url);}catch(e){} done&&done(); });
    ov.onended = fin; ov.onerror = fin;
    stage.appendChild(ov);
    ov.play().catch(fin);
  }

  // 生产者:顺序取下一句的口型片段/音频,就绪后放入 playQ(保持句序),并触发播放。
  function fetchNext(){
    if (fetching || !sentQ.length) return;
    fetching = true;
    var text = sentQ.shift();
    var done = once(function(){ fetching = false; fetchNext(); });
    fetch(base + "/say", {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({text: text, rate: parseFloat((speedEl && speedEl.value) || "1") || 1})}).then(function(r){
      if(!r.ok) throw new Error("say");
      var kind = (r.headers.get("X-Talk-Kind") || "audio");
      return r.blob().then(function(b){ playQ.push({kind:kind, blob:b}); });
    }).then(function(){ done(); playNext(); }).catch(done);
  }

  // 消费者:顺序播放 playQ;一次只播一段,播完(幂等)再播下一段。
  function playNext(){
    if (playing || !playQ.length) return;
    playing = true;
    var o = playQ.shift();
    var done = once(function(){ playing = false; playNext(); });
    if (o.kind === "video") playClip(o.blob, done); else playAudio(o.blob, done);
  }

  function enqueueSay(text){
    if(!text || !text.trim()) return;
    sentQ.push(text.trim());
    fetchNext();
  }

  function send(){
    var text = (inp.value || "").trim();
    if(!text || busy) return;
    busy = true; sendBtn.disabled = true; inp.value = "";
    addMsg("user", text);
    history.push({role:"user", content:text});
    var aiEl = addMsg("assistant", "…");
    var acc = "", sayPos = 0;
    // 边流式边按句切:出完一句立即入队即时说(流畅、口型跟声)。final=收尾把剩余整体当一句。
    function flushSentences(final){
      var rest = acc.slice(sayPos), re = /[。!?！?\\n]/g, m, last = 0;
      while((m = re.exec(rest))){
        var s = rest.slice(last, m.index + 1).trim();
        if(s) enqueueSay(s);
        last = m.index + 1;
      }
      sayPos += last;
      if(final){ var tail = acc.slice(sayPos).trim(); if(tail){ enqueueSay(tail); sayPos = acc.length; } }
    }
    fetch(base + "/chat", {method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({message:text, history:history})}).then(function(res){
      if(res.status === 429){ aiEl.textContent = "访问过于频繁,请稍后再试"; throw new Error("rate"); }
      if(!res.ok || !res.body){ aiEl.textContent = "对话暂不可用"; throw new Error("err"); }
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = "";
      function pump(){
        return reader.read().then(function(res2){
          if(res2.done){ return; }
          buf += dec.decode(res2.value, {stream:true}).replace(/\\r/g, "");
          var idx;
          while((idx = buf.indexOf("\\n\\n")) >= 0){
            var block = buf.slice(0, idx); buf = buf.slice(idx + 2);
            var ev = "message", data = "";
            block.split("\\n").forEach(function(line){
              if(line.indexOf("event:") === 0) ev = line.slice(6).trim();
              else if(line.indexOf("data:") === 0) data += line.slice(5).trim();
            });
            if(ev === "token"){
              try{ var d = JSON.parse(data); if(d && d.delta){ acc += d.delta; aiEl.textContent = acc; msgs.scrollTop = msgs.scrollHeight; flushSentences(false); } }catch(e){}
            }
          }
          return pump();
        });
      }
      return pump();
    }).then(function(){
      if(acc){ history.push({role:"assistant", content:acc}); flushSentences(true); }
      else if(aiEl.textContent === "…"){ aiEl.textContent = "(无回复)"; }
    }).catch(function(){}).then(function(){
      busy = false; sendBtn.disabled = false; inp.focus();
    });
  }
  sendBtn.addEventListener("click", send);
  inp.addEventListener("keydown", function(e){ if(e.key === "Enter") send(); });
})();
</script>
</body></html>"""
