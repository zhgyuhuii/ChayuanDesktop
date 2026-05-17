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

# ⚠ 关键:必须用**固定窗口**,不能让 audio 无限累积。
# 若每次 chunk 来都跑整段累积音频,whisper latency 随长度 O(n) 增长 — 8 个
# chunk(20s)时 latency ~5s > sliceMs(2.5s),后端 semaphore 立刻堆爆,
# 前端 httpx 全部 ReadTimeout → 用户体感"20s 后卡死"。
#
# 窗口设计:
#   WINDOW_SECONDS=12  → whisper 每次跑 ≤ 12s 音频,latency 恒定 ~2-3s,稳。
#   超过窗口:把当前 last_hyp 整段 hard-commit,清空 buffer 开新段。
#   trade-off:段切换那一刻没有跨次 LocalAgreement 确认,可能漏掉 hallucination,
#   但比线性增长爆炸好太多。
#
# 单 session 不再有"is_full / 客户端必须 rotate"概念 — 滑窗内置兜底了。
WINDOW_SECONDS = 12
WINDOW_BYTES = WINDOW_SECONDS * PCM_BYTES_PER_SECOND

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
    """流式 ASR session — 固定 12 秒滑窗,每段内 LocalAgreement-2 双重确认。

    数据流:
        audio_pcm: 当前段累积音频(≤ WINDOW_BYTES)
        last_hyp: 上次跑出的 hypothesis(对当前段)
        segment_committed_prefix: 当前段内已 commit 的部分(== last_hyp 的某个前缀)
        committed_text: 跨段累计的全部已 commit 文本(返给客户端 commit 到笔记)

    chunk 来:
        1. 累积超 WINDOW_BYTES → 切段:
             - last_hyp 减去段内已 commit 的部分 = 段尾未 commit 文字 → 加到
               committed_text(段切换 hard-commit,不再做 LocalAgreement)
             - 清空 audio_pcm / last_hyp / segment_committed_prefix
        2. append 新 pcm
        3. 跑 whisper(audio_pcm)→ new_hyp
        4. LocalAgreement-2(last_hyp ↔ new_hyp)→ stable_prefix + volatile
        5. increment = stable_prefix - segment_committed_prefix
           committed_text += increment;segment_committed_prefix = stable_prefix
        6. last_hyp = new_hyp

    返 stable_increment(本次新 commit 的字符,前端直接 insert)+ volatile_suffix
    (灰色未确认,前端可选展示)+ committed_text(全局校对,前端兜底用)。
    """
    session_id: str
    language: Optional[str] = None
    audio_pcm: bytearray = field(default_factory=bytearray)
    last_hyp: str = ""
    committed_text: str = ""
    # 当前段内已 commit 部分;== last_hyp 的某个前缀,所以总能用它算 increment
    segment_committed_prefix: str = ""
    last_active_at: float = field(default_factory=time.time)
    chunk_count: int = 0

    def append_chunk(
        self, pcm_chunk: bytes, transcribe_fn: TranscribeFn,
    ) -> Dict:
        """滑窗 + LocalAgreement-2 → 返 commit 决策。latency 恒定。"""
        # ── 滑窗:超出窗口前先切段 ──
        # 注意是 "前缀" 检查,即如果 append 后会超出 → 先 hard-commit 段尾再开新段。
        # hard_commit_increment 这一刻"段切 hard-commit 的字符",会和后面段内
        # LocalAgreement 的 increment 合并返回给客户端,确保客户端不漏 commit。
        hard_commit_increment = ""
        will_exceed = len(self.audio_pcm) + len(pcm_chunk) > WINDOW_BYTES
        if will_exceed and self.last_hyp:
            hard_commit_increment = self.last_hyp[len(self.segment_committed_prefix):]
            self.committed_text += hard_commit_increment
            self.audio_pcm = bytearray()
            self.last_hyp = ""
            self.segment_committed_prefix = ""

        # ── 累积当前 chunk ──
        self.audio_pcm.extend(pcm_chunk)
        self.chunk_count += 1
        self.last_active_at = time.time()

        # ── 跑 whisper(整段 ≤ WINDOW_BYTES,latency 恒定)──
        wav_bytes = make_wav_bytes(bytes(self.audio_pcm))
        new_hyp, diag = transcribe_fn(wav_bytes)

        # ── LocalAgreement-2 在当前段内 ──
        stable_prefix, volatile = local_agreement_2(self.last_hyp, new_hyp)
        stable_increment, retroactive = compute_increment(
            self.segment_committed_prefix, stable_prefix,
        )

        if not retroactive:
            self.committed_text += stable_increment
            self.segment_committed_prefix = stable_prefix or self.segment_committed_prefix
        self.last_hyp = new_hyp

        # 合并段切 hard-commit + 段内 LocalAgreement increment,客户端一次性 commit
        total_increment = hard_commit_increment + stable_increment

        return {
            "stable_increment": total_increment,
            "volatile_suffix": volatile,
            "hypothesis": new_hyp,
            "committed_text": self.committed_text,
            "retroactive_change": retroactive,
            # 滑窗内置兜底,无 "is_full" 概念了 — 始终 False 让客户端持续录
            "is_full": False,
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
