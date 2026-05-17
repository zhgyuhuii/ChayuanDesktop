"""流式 ASR session — 累积音频 PCM、跑 whisper 全段、用 LocalAgreement-2 找
稳定前缀,前端拿到 stable_increment 直接 commit 到笔记。

调用流程:
    1. 前端 start 录音 → 客户端生成 session_id (uuid)
    2. 每个 chunk(webm 2.5s)POST /modality/transcribe + session_id
    3. 后端 ffmpeg 转 webm → wav PCM 16k mono
    4. AsrSession.append_chunk(pcm) → 累积到 audio_pcm buffer
    5. 把 buffer 包成完整 WAV,送 whisper.cpp sidecar
    6. 拿到 new_hyp,LocalAgreement-2 比对 last_hyp,算出 stable_prefix
    7. stable_prefix 比 committed_text 多的部分 = stable_increment(本次新 commit)
    8. 返回 {stable_increment, volatile_suffix, hypothesis, is_full}
    9. 前端 onPartial(stable_increment) — 只 commit 这次确认增量
    10. 前端可选 onVolatile(volatile_suffix) — 展示灰色未确认

资源:
    - 每个 session 最多 30s PCM(16k mono = 960 KB)
    - registry 维护 dict,inactive >5min 自动 evict
    - audio_pcm > 30s 时 is_full=True,前端 should restart session
"""
from __future__ import annotations

import struct
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, Optional, Tuple

from .local_agreement import compute_increment, local_agreement_2

# 单声道 16k 16bit PCM:每秒 32000 字节
PCM_SAMPLE_RATE = 16000
PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * 2  # mono, 16-bit
MAX_SESSION_SECONDS = 30  # 单 session 最多累积 30s,超了客户端 restart
MAX_SESSION_BYTES = MAX_SESSION_SECONDS * PCM_BYTES_PER_SECOND

SESSION_TTL_SEC = 300  # 5 分钟 idle 自动 evict


def make_wav_bytes(pcm_data: bytes, sample_rate: int = PCM_SAMPLE_RATE) -> bytes:
    """把裸 PCM 16-bit mono 拼上 WAV header,whisper 可解码。"""
    n = len(pcm_data)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + n, b"WAVE",
        b"fmt ", 16, 1, 1,  # PCM format, 1 channel
        sample_rate,
        sample_rate * 2,  # byte rate (1 channel * 16bit / 8)
        2, 16,            # block align (1*16/8), bits per sample
        b"data", n,
    )
    return header + pcm_data


# transcribe 回调签名:接 WAV bytes,返 (text, diagnostics_list)
TranscribeFn = Callable[[bytes], Tuple[str, list]]


@dataclass
class AsrSession:
    session_id: str
    language: Optional[str] = None
    audio_pcm: bytearray = field(default_factory=bytearray)
    last_hyp: str = ""
    committed_text: str = ""
    last_active_at: float = field(default_factory=time.time)
    chunk_count: int = 0

    def append_chunk(
        self, pcm_chunk: bytes, transcribe_fn: TranscribeFn,
    ) -> Dict:
        """累积新 PCM + 跑 whisper 全段 + LocalAgreement-2 → 返 commit 决策。"""
        self.audio_pcm.extend(pcm_chunk)
        self.chunk_count += 1
        self.last_active_at = time.time()

        is_full = len(self.audio_pcm) >= MAX_SESSION_BYTES
        # 跑 whisper:整段 PCM 包成 WAV
        wav_bytes = make_wav_bytes(bytes(self.audio_pcm))
        new_hyp, diag = transcribe_fn(wav_bytes)

        # LocalAgreement-2:这次 confirm 的稳定前缀
        stable_prefix, volatile = local_agreement_2(self.last_hyp, new_hyp)
        stable_increment, retroactive = compute_increment(
            self.committed_text, stable_prefix,
        )

        # 更新 session 状态
        if not retroactive:
            self.committed_text = stable_prefix or self.committed_text
        self.last_hyp = new_hyp

        return {
            "stable_increment": stable_increment,
            "volatile_suffix": volatile,
            "hypothesis": new_hyp,
            "committed_text": self.committed_text,
            "retroactive_change": retroactive,
            "is_full": is_full,
            "chunk_count": self.chunk_count,
            "audio_seconds": len(self.audio_pcm) / PCM_BYTES_PER_SECOND,
            "diagnostics": diag,
        }


class AsrSessionRegistry:
    """进程内 session registry,thread-safe,自动 evict 闲置 session。"""

    def __init__(self) -> None:
        self._sessions: Dict[str, AsrSession] = {}
        self._lock = threading.Lock()

    def get_or_create(self, session_id: str, language: Optional[str] = None) -> AsrSession:
        with self._lock:
            self._evict_idle()
            sess = self._sessions.get(session_id)
            if sess is None:
                sess = AsrSession(session_id=session_id, language=language)
                self._sessions[session_id] = sess
            return sess

    def drop(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)

    def _evict_idle(self) -> None:
        now = time.time()
        stale = [
            sid for sid, s in self._sessions.items()
            if now - s.last_active_at > SESSION_TTL_SEC
        ]
        for sid in stale:
            self._sessions.pop(sid, None)

    def size(self) -> int:
        with self._lock:
            return len(self._sessions)


_REGISTRY: Optional[AsrSessionRegistry] = None


def get_registry() -> AsrSessionRegistry:
    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = AsrSessionRegistry()
    return _REGISTRY
