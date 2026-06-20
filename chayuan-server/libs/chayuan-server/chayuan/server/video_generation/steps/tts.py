"""TTS 步骤 — 离线优先(piper)+ 在线备选(edge-tts)。

重构自 chayuan-video-generation/app/services/voice.py(1700+ 行,14 种
TTS 路径),按本项目"全链路离线可用 + 复用现有 modality.audio"原则精简:

主路径(M1):
    voice_provider="piper"   走 chayuan.server.modality.audio.AudioPipeline
                              .synthesize → 拿 wav/mp3 bytes,写盘 + 等分
                              文本产 cues。无网可用。

在线备选(M1):
    voice_provider="edge"    edge-tts(微软,免 API Key 但需联网):流式落盘
                              并由 SubMaker 自带 cue timestamps 产 cues。
                              中文音色多、节奏自然,质量上限比 piper 高。

未来扩展(M4):
    voice_provider="sherpa"  sherpa-onnx-tts sidecar(高品质中文 CosyVoice/
                              VITS,纯离线)。当前 stub 报错引导用户回退 piper。

精准节奏模式(SRT cue 时长匹配):
    synthesize_to_cues(text, target_duration_ms=...) — 当用户上传 SRT
    时,按 cue 时长调 speed/length_scale 让单 cue 音频时长贴近用户期望。
    实现暂支持 piper(length_scale 1.0±15%),其它 provider 回退默认速度。

删除的上游能力(明确不再支持):
- Azure Cognitive Services SDK(原生 .NET 绑定,跨平台一致性差)
- DashScope(阿里通义语音,云服务,跟 OpenAI 兼容网关重叠)
- Google Generative AI(Gemini TTS,GenAI SDK 重)
- SiliconFlow(国内云 TTS,可通过 edge_tts 兼容协议覆盖)
- g4f / azure_v2 等 — 维护成本高、用户量小
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import re
import wave
from typing import List, Optional

from ..schemas import SrtCue

logger = logging.getLogger("chayuan.video_generation.tts")

# 句末标点 — 等分切句用,跟 subtitle._split_string_by_punctuations 同口径
_PUNCT_PATTERN = re.compile(r"[?,.、;:!…？，。；：！]+|\.\.\.")

# 切块用的句/子句边界(含逗号、换行)。在这些标点之后断开,保留标点。
_CHUNK_SPLIT_PATTERN = re.compile(r"(?<=[。!?！?…,，;；\n])")


def _chunk_text_for_tts(text: str, max_chars: int = 120) -> List[str]:
    """把长文本按句/子句边界切成 <= max_chars 的小块。

    动机:sherpa 等本地 TTS 一次合成整段长脚本会很慢,父进程 _TtsWorker 等
    180s 还没出 → 判超时杀 worker → 回退 piper(每个任务白等 180s)。改成逐块
    合成,每块文本短、单次合成几秒出,不会触发超时;块间 PCM 直接拼接,旁白连续。
    """
    if not text:
        return []
    parts = [p for p in _CHUNK_SPLIT_PATTERN.split(text) if p and p.strip()]
    chunks: List[str] = []
    cur = ""
    for p in parts:
        # 单个子句本身就超长(无标点的长串)→ 先冲掉累积,再按字符硬切
        if len(p) > max_chars:
            if cur:
                chunks.append(cur)
                cur = ""
            for i in range(0, len(p), max_chars):
                chunks.append(p[i:i + max_chars])
            continue
        if len(cur) + len(p) > max_chars and cur:
            chunks.append(cur)
            cur = p
        else:
            cur += p
    if cur.strip():
        chunks.append(cur)
    return [c for c in chunks if c.strip()]


def _synthesize_sherpa_chunked(am, text: str, voice_arg: str) -> Optional[bytes]:  # noqa: ANN001
    """逐块调 sherpa(wav)再拼接成一个 wav 字节串。任一块失败返 None 由 caller 回退。

    各块都取 wav(runner 的音频文件本就是 audio.wav),拼 PCM 帧后重写 wav 头,
    无需二次转码。每块短文本单次合成快,绕开整段长合成的 180s worker 超时。
    """
    chunks = _chunk_text_for_tts(text)
    if not chunks:
        return None
    params = None
    frames: List[bytes] = []
    for idx, ch in enumerate(chunks):
        b = am.synthesize(ch, voice=voice_arg, fmt="wav")
        if not b:
            logger.warning("[tts:sherpa] 第 %d/%d 块合成失败,放弃 sherpa", idx + 1, len(chunks))
            return None
        try:
            with wave.open(io.BytesIO(b), "rb") as wf:
                if params is None:
                    params = wf.getparams()
                frames.append(wf.readframes(wf.getnframes()))
        except Exception as e:  # noqa: BLE001
            logger.warning("[tts:sherpa] 第 %d 块 wav 解析失败: %r", idx + 1, e)
            return None
    if params is None or not frames:
        return None
    out = io.BytesIO()
    with wave.open(out, "wb") as wf:
        wf.setnchannels(params.nchannels)
        wf.setsampwidth(params.sampwidth)
        wf.setframerate(params.framerate)
        wf.writeframes(b"".join(frames))
    return out.getvalue()


# ─────────────────────────────────────────────────────────────────────
# 对外接口
# ─────────────────────────────────────────────────────────────────────


class TtsResult:
    """tts.synthesize 的返回值。

    audio_file:    最终落盘的音频路径
    duration_ms:   音频时长(毫秒)
    cues:          字幕 cue 列表(可直接喂 subtitle.write_srt)
    provider:      实际使用的后端(piper / edge / openai_tts 等)
    """

    __slots__ = ("audio_file", "duration_ms", "cues", "provider")

    def __init__(
        self,
        audio_file: str,
        duration_ms: int,
        cues: List[SrtCue],
        provider: str,
    ) -> None:
        self.audio_file = audio_file
        self.duration_ms = duration_ms
        self.cues = cues
        self.provider = provider


def synthesize(
    text: str,
    voice_file: str,
    *,
    voice_provider: str = "piper",
    voice_name: Optional[str] = None,
    voice_rate: float = 1.0,
    voice_volume: float = 1.0,
) -> Optional[TtsResult]:
    """文本 → 音频文件 + cues。失败返 None。

    voice_provider 三档:
      piper(默认离线,~60 MB 模型,质量足以日常)
      edge(联网备选,微软声纹,中文音色多)
      sherpa(M4 加,高质量 VITS ~125 MB 模型,中文 prosody 更自然)

    voice_name 可不传 — 各 provider 自带默认中文女声。
    """

    if not text or not text.strip():
        logger.warning("[tts] empty text, skip")
        return None
    os.makedirs(os.path.dirname(voice_file) or ".", exist_ok=True)

    provider = (voice_provider or "piper").lower()

    if provider == "edge":
        result = _synthesize_via_edge(
            text, voice_file, voice_name=voice_name,
            voice_rate=voice_rate, voice_volume=voice_volume,
        )
        if result is not None:
            return result
        logger.warning("[tts] edge 路径失败,fallback piper")
        provider = "piper"

    if provider == "clone":
        # 音色克隆(VoxCPM):voice_name = "clone:<id>",参考样本在 voice_clones_dir。
        result = _synthesize_via_clone(
            text, voice_file, voice_name=voice_name,
        )
        if result is not None:
            return result
        logger.warning("[tts] clone 路径失败,fallback piper")
        provider = "piper"

    if provider == "sherpa":
        # M4 加:sherpa-onnx VITS 高质量本地 TTS。
        result = _synthesize_via_sherpa(
            text, voice_file, voice_name=voice_name,
            voice_rate=voice_rate, voice_volume=voice_volume,
        )
        if result is not None:
            return result
        logger.warning("[tts] sherpa 路径失败,fallback piper")
        provider = "piper"

    # 主路径 piper(默认)
    return _synthesize_via_piper(
        text, voice_file, voice_name=voice_name,
        voice_rate=voice_rate, voice_volume=voice_volume,
    )


# ─────────────────────────────────────────────────────────────────────
# sherpa-onnx 路径(高质量本地 VITS,M4 加)
# ─────────────────────────────────────────────────────────────────────


def _synthesize_via_sherpa(
    text: str,
    voice_file: str,
    *,
    voice_name: Optional[str],
    voice_rate: float,
    voice_volume: float,
) -> Optional[TtsResult]:
    """走 modality.audio AudioPipeline.synthesize 接 "sherpa:" 前缀走第 -1 档。"""

    try:
        from chayuan.server.modality.audio import AudioPipeline
    except Exception as e:  # noqa: BLE001
        logger.warning("[tts:sherpa] AudioPipeline import 失败: %r", e)
        return None
    # sherpa 真不可用(.pyd 与 .py 版本错配 / 没装,如 ImportError OfflineDiacritization)时,
    # modality 会**静默回退 piper 并返回 piper 音频**;若这里仍标 provider="sherpa",就让
    # X-Tts-Provider=sherpa 实为 piper(用户实测"四档音色都成 piper",header 说谎)。
    # 先探一次 sherpa_onnx 是否真能 import;不能就返回 None,让 caller 回退并**如实标 piper**。
    try:
        import sherpa_onnx  # noqa: F401
    except Exception as e:  # noqa: BLE001
        logger.warning("[tts:sherpa] sherpa_onnx 不可用,放弃 sherpa(将如实回退 piper): %r", e)
        return None
    am = AudioPipeline()
    # 逐块合成固定取 wav(runner 的音频文件本就是 audio.wav),无需按 voice_file 扩展名转码。
    voice_id = voice_name or ""
    # 拼 "sherpa:" 前缀让 modality 走 sherpa 分支(否则会走 piper)
    voice_arg = voice_id if voice_id.startswith("sherpa:") else f"sherpa:{voice_id}"
    try:
        # 逐块合成:整段长脚本一次合成会拖到 180s worker 超时(实测每个任务白等
        # 180s 再回退 piper)。短块逐合再拼 PCM,绕开超时。fmt 固定 wav(audio.wav)。
        data = _synthesize_sherpa_chunked(am, text, voice_arg)
    except Exception as e:  # noqa: BLE001
        logger.warning("[tts:sherpa] synthesize 异常: %r", e)
        return None
    if not data:
        return None
    with open(voice_file, "wb") as f:
        f.write(data)
    duration_ms = _probe_audio_duration_ms(voice_file) or _estimate_duration_ms(text)
    # sherpa 无 cue timestamps,跟 piper 同处理:按句号等分文本
    cues = _equal_split_cues(text, duration_ms)
    logger.info(
        "[tts:sherpa] wrote %s duration_ms=%d cues=%d",
        voice_file, duration_ms, len(cues),
    )
    # voice_rate / voice_volume 在 sherpa 路径上当前未生效(sherpa.generate
    # 接 speed 参数但 modality.audio 没透传)— M4 后续再扩 modality 接口
    # 让 speed 通到 sherpa.generate。
    return TtsResult(
        audio_file=voice_file, duration_ms=duration_ms,
        cues=cues, provider="sherpa",
    )


# ─────────────────────────────────────────────────────────────────────
# 音色克隆路径(VoxCPM,P1)
# ─────────────────────────────────────────────────────────────────────


def _synthesize_via_clone(
    text: str,
    voice_file: str,
    *,
    voice_name: Optional[str],
) -> Optional[TtsResult]:
    """音色克隆:voice_name="clone:<id>" → 取 voice_clones_dir/<id>.wav 作参考人声,
    走 AudioPipeline 的 voxcpm 分支(经 _TTS_WORKER 子进程隔离,非 in-process)。
    失败返 None 由 caller fallback piper。"""
    import os as _os
    from chayuan.server.video_generation._helpers import voice_clones_dir

    cid = (voice_name or "").strip()
    if cid.startswith("clone:"):
        cid = cid[len("clone:"):]
    wav = _os.path.join(voice_clones_dir(), f"{cid}.wav") if cid else ""
    if cid and not _os.path.isfile(wav):
        logger.warning("[tts:clone] 克隆样本不存在: %s", wav)
        return None
    try:
        from chayuan.server.modality.audio import AudioPipeline
    except Exception as e:  # noqa: BLE001
        logger.warning("[tts:clone] AudioPipeline import 失败: %r", e)
        return None
    am = AudioPipeline()
    fmt = _ext(voice_file) or "wav"
    try:
        data = am.synthesize(text, voice=f"voxcpm:{wav}", fmt=fmt)
    except Exception as e:  # noqa: BLE001
        logger.warning("[tts:clone] synthesize 异常: %r", e)
        return None
    if not data:
        return None
    with open(voice_file, "wb") as f:
        f.write(data)
    duration_ms = _probe_audio_duration_ms(voice_file) or _estimate_duration_ms(text)
    cues = _equal_split_cues(text, duration_ms)
    logger.info("[tts:clone] wrote %s dur_ms=%d cues=%d (ref=%s)", voice_file, duration_ms, len(cues), cid or "默认")
    return TtsResult(audio_file=voice_file, duration_ms=duration_ms, cues=cues, provider="clone")


# ─────────────────────────────────────────────────────────────────────
# piper 路径(离线,主)
# ─────────────────────────────────────────────────────────────────────


def _synthesize_via_piper(
    text: str,
    voice_file: str,
    *,
    voice_name: Optional[str],
    voice_rate: float,
    voice_volume: float,
) -> Optional[TtsResult]:
    """复用 chayuan.server.modality.audio.AudioPipeline 已有 piper-tts 实现。"""

    try:
        from chayuan.server.modality.audio import AudioPipeline
    except Exception as e:  # noqa: BLE001
        logger.warning("[tts:piper] AudioPipeline import 失败: %r", e)
        return None
    am = AudioPipeline()
    fmt = _ext(voice_file) or "wav"
    try:
        data = am.synthesize(text, voice=voice_name or "", fmt=fmt)
    except Exception as e:  # noqa: BLE001
        logger.warning("[tts:piper] synthesize 异常: %r", e)
        return None
    if not data:
        logger.warning("[tts:piper] synthesize 返回空 bytes")
        return None
    with open(voice_file, "wb") as f:
        f.write(data)

    duration_ms = _probe_audio_duration_ms(voice_file) or _estimate_duration_ms(text)
    # piper 不带 cue 时间戳:按句号等分。等分误差 ~5-10%,字幕编辑器会让用户
    # 校对(M5 SubtitleStep 直接展示并允许调整 ms)。
    cues = _equal_split_cues(text, duration_ms)
    logger.info(
        "[tts:piper] wrote %s duration_ms=%d cues=%d",
        voice_file, duration_ms, len(cues),
    )
    return TtsResult(
        audio_file=voice_file, duration_ms=duration_ms,
        cues=cues, provider="piper",
    )


# ─────────────────────────────────────────────────────────────────────
# edge-tts 路径(联网备选)
# ─────────────────────────────────────────────────────────────────────


def _synthesize_via_edge(
    text: str,
    voice_file: str,
    *,
    voice_name: Optional[str],
    voice_rate: float,
    voice_volume: float,
) -> Optional[TtsResult]:
    """edge-tts 流式落盘 + SubMaker 自带 cue 时间戳。"""

    try:
        import edge_tts  # type: ignore
    except Exception as e:  # noqa: BLE001
        logger.warning("[tts:edge] edge-tts 未装: %r", e)
        return None

    voice = voice_name or "zh-CN-XiaoxiaoNeural"
    rate_str = _rate_to_percent(voice_rate)
    volume_str = _volume_to_percent(voice_volume)
    timeout = _edge_timeout_seconds()

    async def _run() -> Optional[edge_tts.SubMaker]:
        communicate = edge_tts.Communicate(
            text=text, voice=voice, rate=rate_str, volume=volume_str,
        )
        sub_maker = edge_tts.SubMaker()
        try:
            with open(voice_file, "wb") as f:
                async for chunk in communicate.stream():
                    if chunk.get("type") == "audio":
                        f.write(chunk["data"])
                    elif chunk.get("type") == "WordBoundary":
                        try:
                            sub_maker.feed(chunk)
                        except AttributeError:
                            # edge_tts 旧 API
                            try:
                                sub_maker.create_sub(
                                    (chunk["offset"], chunk["duration"]), chunk["text"]
                                )
                            except Exception:  # noqa: BLE001
                                pass
        except Exception as e:  # noqa: BLE001
            logger.warning("[tts:edge] stream 异常: %r", e)
            return None
        return sub_maker

    try:
        sub_maker = _run_async(_run(), timeout=timeout)
    except Exception as e:  # noqa: BLE001
        logger.warning("[tts:edge] async run 失败: %r", e)
        return None

    if sub_maker is None or not os.path.exists(voice_file):
        return None
    if os.path.getsize(voice_file) == 0:
        logger.warning("[tts:edge] 落盘文件 0 字节,删除")
        try:
            os.unlink(voice_file)
        except OSError:
            pass
        return None

    duration_ms = _probe_audio_duration_ms(voice_file) or _estimate_duration_ms(text)
    # 从 SubMaker 抽 cues
    from .subtitle import cues_from_sub_maker
    cues = cues_from_sub_maker(sub_maker)
    if not cues:
        cues = _equal_split_cues(text, duration_ms)
    logger.info(
        "[tts:edge] wrote %s duration_ms=%d cues=%d",
        voice_file, duration_ms, len(cues),
    )
    return TtsResult(
        audio_file=voice_file, duration_ms=duration_ms,
        cues=cues, provider="edge",
    )


# ─────────────────────────────────────────────────────────────────────
# 工具函数
# ─────────────────────────────────────────────────────────────────────


def _ext(path: str) -> Optional[str]:
    e = os.path.splitext(path)[1].lstrip(".").lower()
    return e or None


def _rate_to_percent(rate: float) -> str:
    """edge-tts rate 参数 — ``+30%`` 表示 1.3x。"""

    if rate == 1.0:
        return "+0%"
    pct = round((rate - 1.0) * 100)
    return f"+{pct}%" if pct > 0 else f"{pct}%"


def _volume_to_percent(volume: float) -> str:
    """edge-tts volume 参数 — 同 rate 格式。"""

    if volume == 1.0:
        return "+0%"
    pct = round((volume - 1.0) * 100)
    return f"+{pct}%" if pct > 0 else f"{pct}%"


def _edge_timeout_seconds() -> Optional[float]:
    """edge-tts 单次请求超时,默认 30s。``_config_shim`` 读 ENV。"""

    try:
        from .._config_shim import vg_config
        v = vg_config.app.get("edge_tts_timeout", 30)
        return float(v) if v and float(v) > 0 else None
    except Exception:  # noqa: BLE001
        return 30.0


def _run_async(coro, *, timeout: Optional[float] = None):
    """跨 loop 同步等待协程结果 — 既能在路由内(loop running)也能脚本里跑。"""

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            fut = asyncio.run_coroutine_threadsafe(coro, loop)
            return fut.result(timeout=timeout)
        return asyncio.run(coro)
    except RuntimeError:
        return asyncio.run(coro)


def _probe_audio_duration_ms(audio_file: str) -> Optional[int]:
    """音频时长(ms)。优先 wave(纯 stdlib,wav 准);失败回退 moviepy。"""

    try:
        with wave.open(audio_file, "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            if rate > 0:
                return int(frames * 1000 / rate)
    except Exception:  # noqa: BLE001
        pass
    try:
        from moviepy import AudioFileClip
        clip = AudioFileClip(audio_file)
        try:
            return int(clip.duration * 1000)
        finally:
            try:
                clip.close()
            except Exception:  # noqa: BLE001
                pass
    except Exception as e:  # noqa: BLE001
        logger.debug("[tts] _probe_audio_duration_ms failed: %r", e)
        return None


def _estimate_duration_ms(text: str) -> int:
    """无法测出真实音频时长时的兜底估算:中文 ~3.5 字/s,英文 ~3 词/s。"""

    if not text:
        return 0
    cn_chars = sum(1 for c in text if "一" <= c <= "鿿")
    en_words = len(re.findall(r"[A-Za-z]+", text))
    cn_ms = int(cn_chars * 1000 / 3.5)
    en_ms = int(en_words * 1000 / 3.0)
    return max(cn_ms + en_ms, 500)


def _equal_split_cues(text: str, duration_ms: int) -> List[SrtCue]:
    """按句号/逗号等切句,按字数比例分配时间戳。

    用于 piper 路径(无 cue 时间戳)或 edge-tts SubMaker 失效时的 fallback。
    """

    if not text or duration_ms <= 0:
        return []
    parts = [p for p in _PUNCT_PATTERN.split(text) if p.strip()]
    if not parts:
        return []
    total_chars = sum(len(p) for p in parts) or 1
    cues: List[SrtCue] = []
    cursor_ms = 0
    for i, p in enumerate(parts, start=1):
        share = int(duration_ms * len(p) / total_chars)
        if i == len(parts):
            end_ms = duration_ms  # 最后一段对齐到总时长,避免累积误差
        else:
            end_ms = cursor_ms + share
        cues.append(
            SrtCue(index=i, start_ms=cursor_ms, end_ms=end_ms, text=p.strip())
        )
        cursor_ms = end_ms
    return cues


# ─────────────────────────────────────────────────────────────────────
# 精准节奏 — 给"粘贴 SRT"模式用(M1 简版)
# ─────────────────────────────────────────────────────────────────────


def synthesize_per_cue(
    cues: List[SrtCue],
    voice_file: str,
    *,
    voice_provider: str = "piper",
    voice_name: Optional[str] = None,
    voice_volume: float = 1.0,
) -> Optional[TtsResult]:
    """逐 cue 合成 + 拼接 — Wizard"粘贴 SRT"模式的 TTS 实现。

    M1 简版:每个 cue 用默认语速合成,落盘后调用 moviepy 按 cue.duration
    拉伸/压缩(音频 ``time_stretch`` 副作用是音高变化,但视频生成场景
    可接受)。M4 升级 piper length_scale + sherpa speed control 后用原
    生倍速避免变调。

    暂留接口签名;实现等 M5 UI 接入时补,因为需要先确认前端 SRT 编辑
    的 cue 调整范围 + 音频片段拼接误差容忍度。
    """

    raise NotImplementedError(
        "synthesize_per_cue 留待 M5 接入 SRT 编辑器后实现 — 当前 wizard "
        "粘贴 SRT 模式可先用 synthesize() + 后期对齐"
    )
