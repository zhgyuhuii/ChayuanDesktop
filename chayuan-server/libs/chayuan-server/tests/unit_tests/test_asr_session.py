"""LocalAgreement-2 + AsrSession 单测。"""
from __future__ import annotations

import pytest


def test_common_prefix_len():
    from chayuan.server.modality.local_agreement import common_prefix_len
    assert common_prefix_len("", "") == 0
    assert common_prefix_len("abc", "") == 0
    assert common_prefix_len("abc", "abd") == 2
    assert common_prefix_len("abc", "abc") == 3
    assert common_prefix_len("你好今天", "你好昨天") == 2  # 中文按字符
    assert common_prefix_len("你好今天", "你好今天天气") == 4


def test_local_agreement_2():
    from chayuan.server.modality.local_agreement import local_agreement_2
    # 第一次 hypothesis,没 prev → 全 volatile
    assert local_agreement_2("", "你好") == ("", "你好")
    # 完全一致 → 全 stable
    assert local_agreement_2("你好", "你好") == ("你好", "")
    # 前缀一致,curr 多出来 → stable 前缀 + volatile suffix
    assert local_agreement_2("你好今天", "你好今天天气真好") == ("你好今天", "天气真好")
    # 中间分叉
    assert local_agreement_2("你好今天", "你好昨天") == ("你好", "昨天")


def test_compute_increment():
    from chayuan.server.modality.local_agreement import compute_increment
    # 正常:new 是 prev 的扩展
    assert compute_increment("你好", "你好今天") == ("今天", False)
    # 第一次 commit
    assert compute_increment("", "你好") == ("你好", False)
    # new 比 prev 短(whisper 这次没那么自信),不撤回也不新增
    assert compute_increment("你好今天", "你好") == ("", False)
    # 完全相同
    assert compute_increment("你好", "你好") == ("", False)
    # 真分叉 → retroactive_change=True,不 increment
    assert compute_increment("你好今天", "你好昨天") == ("", True)


def test_asr_session_first_chunk_no_commit():
    """第一次 chunk:无 prev_hyp,LocalAgreement-2 不 commit,全部 volatile。"""
    from chayuan.server.modality.asr_session import AsrSession
    sess = AsrSession(session_id="t-first")

    def fake_transcribe(wav_bytes):
        # 不关心 wav 内容,假设 whisper 返"你好"
        return "你好", []

    pcm = b"\x00" * (16000 * 2)  # 1 秒静音
    result = sess.append_chunk(pcm, fake_transcribe)
    assert result["stable_increment"] == ""
    assert result["volatile_suffix"] == "你好"
    assert result["hypothesis"] == "你好"
    assert result["committed_text"] == ""
    assert result["chunk_count"] == 1
    assert not result["is_full"]
    assert result["audio_seconds"] == 1.0


def test_asr_session_second_chunk_commits_common_prefix():
    """第二次 chunk:LocalAgreement-2 confirm 上一次的 hypothesis 部分。"""
    from chayuan.server.modality.asr_session import AsrSession
    sess = AsrSession(session_id="t-2")
    pcm = b"\x00" * (16000 * 2)

    hyps = iter(["你好今天", "你好今天天气"])
    def fake(wav): return next(hyps), []

    r1 = sess.append_chunk(pcm, fake)
    assert r1["stable_increment"] == ""
    r2 = sess.append_chunk(pcm, fake)
    # 上次 hyp="你好今天",这次 hyp="你好今天天气",common = "你好今天" → 全部 commit
    assert r2["stable_increment"] == "你好今天"
    assert r2["committed_text"] == "你好今天"
    assert r2["volatile_suffix"] == "天气"
    assert r2["hypothesis"] == "你好今天天气"


def test_asr_session_third_chunk_incremental_commit():
    """第三次 chunk:增量 commit 进一步确认的字符。"""
    from chayuan.server.modality.asr_session import AsrSession
    sess = AsrSession(session_id="t-3")
    pcm = b"\x00" * (16000 * 2)

    hyps = iter([
        "你好今天",
        "你好今天天气",
        "你好今天天气真不错",
    ])
    def fake(wav): return next(hyps), []

    sess.append_chunk(pcm, fake)            # commit ""
    r2 = sess.append_chunk(pcm, fake)       # commit "你好今天"
    r3 = sess.append_chunk(pcm, fake)       # commit 增加 "天气"
    assert r2["stable_increment"] == "你好今天"
    assert r3["stable_increment"] == "天气"
    assert r3["committed_text"] == "你好今天天气"
    assert r3["volatile_suffix"] == "真不错"


def test_asr_session_is_full():
    """累积 audio 达 30s 上限 → is_full=True。"""
    from chayuan.server.modality.asr_session import (
        AsrSession, MAX_SESSION_BYTES,
    )
    sess = AsrSession(session_id="t-full")
    big_pcm = b"\x00" * MAX_SESSION_BYTES
    r = sess.append_chunk(big_pcm, lambda w: ("x", []))
    assert r["is_full"] is True
    assert r["audio_seconds"] >= 30


def test_make_wav_bytes_header():
    """make_wav_bytes 生成 44 字节标准 WAV header。"""
    from chayuan.server.modality.asr_session import make_wav_bytes
    pcm = b"\x00\x01" * 100  # 200 bytes PCM
    wav = make_wav_bytes(pcm)
    assert wav[:4] == b"RIFF"
    assert wav[8:12] == b"WAVE"
    assert wav[12:16] == b"fmt "
    assert wav[36:40] == b"data"
    assert len(wav) == 44 + len(pcm)


def test_registry_evict_idle(monkeypatch):
    """SESSION_TTL_SEC 内不 evict,超出 evict。"""
    import time as _time
    from chayuan.server.modality import asr_session as mod
    reg = mod.AsrSessionRegistry()
    reg.get_or_create("a")
    reg.get_or_create("b")
    assert reg.size() == 2

    # 模拟 a 老了
    reg._sessions["a"].last_active_at = _time.time() - mod.SESSION_TTL_SEC - 1
    reg.get_or_create("c")  # 这调会触发 _evict_idle
    assert "a" not in reg._sessions
    assert "b" in reg._sessions
    assert "c" in reg._sessions
