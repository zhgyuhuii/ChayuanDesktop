"""字幕生成 + 矫正 + SRT IO。

迁移并重构自 chayuan-video-generation/app/services/subtitle.py。主要变更:

- **删 faster-whisper 依赖**:上游用 ``faster_whisper.WhisperModel`` 跑
  in-process ASR;本项目走已有的 whisper-server sidecar(whisper.cpp,
  GGUF,跨平台 prebuilt),通过 ``chayuan.server.modality.audio.transcribe``
  统一接口调用,避免再装一份 Python 转录运行时(~500MB ctranslate2 + numpy)。
- **新增 SubMaker → SRT 主路径**:TTS 步骤(edge-tts / piper 经 SubMaker)
  自带 cue timestamps,绝大多数 wizard 流程不需要再跑 ASR,直接 cues
  落盘成 SRT 即可,合成更快也更精确。ASR 反推仅作为"用户自带音频(无
  script)"场景的兜底。
- **新增 cues_from_srt_text**:Wizard "粘贴 SRT" 模式用,把用户输入的
  SRT/VTT 文本解析成 SrtCue 列表,经 schemas 校验后入 vg_tasks.

保留:
- file_to_subtitles  解析现成 SRT 文件 → (idx, "HH:MM:SS,xxx --> ...", text) 三元组
- levenshtein_distance / similarity  字幕矫正辅助
- correct  用 video_script 文本矫正 ASR/TTS 字幕(处理朗读跳词、补漏)
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Iterable, List, Optional, Tuple

from ..schemas import SrtCue

logger = logging.getLogger("chayuan.video_generation.subtitle")


# ─────────────────────────────────────────────────────────────────────
# SRT IO
# ─────────────────────────────────────────────────────────────────────


def _ms_to_srt_timestamp(ms: int) -> str:
    """毫秒整数 → SRT 时间戳 ``HH:MM:SS,mmm``。"""

    if ms < 0:
        ms = 0
    s, ms_part = divmod(ms, 1000)
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    return f"{h:02d}:{m:02d}:{s:02d},{ms_part:03d}"


def _srt_timestamp_to_ms(ts: str) -> int:
    """SRT 时间戳 ``HH:MM:SS,mmm`` → 毫秒整数。容错逗号/句号毫秒分隔符。"""

    ts = ts.strip().replace(".", ",")
    m = re.match(r"^(\d+):(\d+):(\d+)[,](\d+)$", ts)
    if not m:
        return 0
    h, mi, s, ms = (int(x) for x in m.groups())
    return ((h * 60 + mi) * 60 + s) * 1000 + ms


def write_srt(cues: Iterable[SrtCue], subtitle_file: str) -> str:
    """把 cue 列表写成 SRT 文件,返回最终路径。"""

    lines: List[str] = []
    for cue in cues:
        if not cue.text.strip():
            continue
        lines.append(str(cue.index))
        lines.append(
            f"{_ms_to_srt_timestamp(cue.start_ms)} --> {_ms_to_srt_timestamp(cue.end_ms)}"
        )
        lines.append(cue.text.strip())
        lines.append("")
    content = "\n".join(lines) + "\n"
    os.makedirs(os.path.dirname(subtitle_file) or ".", exist_ok=True)
    with open(subtitle_file, "w", encoding="utf-8") as f:
        f.write(content)
    logger.info("[subtitle] write_srt -> %s (cues=%d)", subtitle_file, len(lines) // 4)
    return subtitle_file


def cues_from_srt_text(srt_text: str) -> List[SrtCue]:
    """用户粘贴的 SRT/VTT 文本 → SrtCue 列表。

    宽松解析:容错 BOM、\\r\\n、空行多寡、毫秒分隔符 ``,`` 或 ``.``、
    VTT 的 ``WEBVTT`` 头与 ``00:00:00.000 --> ...`` 格式。
    """

    if not srt_text:
        return []
    txt = srt_text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    # VTT 头去掉
    txt = re.sub(r"^WEBVTT[^\n]*\n+", "", txt, count=1)
    blocks = re.split(r"\n\s*\n", txt.strip())
    cues: List[SrtCue] = []
    next_index = 1
    for block in blocks:
        lines = [ln for ln in block.split("\n") if ln.strip()]
        if not lines:
            continue
        # 首行可能是 index(纯数字)或直接是时间戳行
        idx_line: Optional[str] = None
        time_line: Optional[str] = None
        text_lines: List[str] = []
        if re.match(r"^\d+$", lines[0].strip()):
            idx_line = lines[0]
            if len(lines) >= 2:
                time_line = lines[1]
                text_lines = lines[2:]
        else:
            time_line = lines[0]
            text_lines = lines[1:]

        if not time_line or "-->" not in time_line:
            continue
        try:
            left, right = (s.strip() for s in time_line.split("-->", 1))
        except ValueError:
            continue
        start_ms = _srt_timestamp_to_ms(left)
        end_ms = _srt_timestamp_to_ms(right)
        if end_ms < start_ms:
            continue
        try:
            idx_val = int(idx_line.strip()) if idx_line else next_index
        except (TypeError, ValueError):
            idx_val = next_index
        next_index = max(next_index, idx_val) + 1
        cues.append(
            SrtCue(
                index=idx_val,
                start_ms=start_ms,
                end_ms=end_ms,
                text="\n".join(text_lines).strip(),
            )
        )
    logger.info("[subtitle] cues_from_srt_text parsed %d cues", len(cues))
    return cues


def file_to_subtitles(filename: str) -> List[Tuple[int, str, str]]:
    """读取 SRT 文件返回 (index, "HH:MM:SS,mmm --> HH:MM:SS,mmm", text) 三元组。

    保留上游签名给 ``correct()`` 用;新代码优先用 ``cues_from_srt_text``。
    """

    if not filename or not os.path.isfile(filename):
        return []
    with open(filename, "r", encoding="utf-8") as f:
        return _parse_to_triples(f.read())


def _parse_to_triples(txt: str) -> List[Tuple[int, str, str]]:
    times_texts: List[Tuple[int, str, str]] = []
    current_times: Optional[str] = None
    current_text = ""
    index = 0
    for line in txt.splitlines(keepends=True):
        times = re.findall(r"([0-9]+:[0-9]+:[0-9]+,[0-9]+)", line)
        if times:
            current_times = line
        elif line.strip() == "" and current_times:
            index += 1
            times_texts.append((index, current_times.strip(), current_text.strip()))
            current_times, current_text = None, ""
        elif current_times:
            current_text += line
    return times_texts


# ─────────────────────────────────────────────────────────────────────
# SubMaker → SRT(M1 主路径)
# ─────────────────────────────────────────────────────────────────────


def cues_from_sub_maker(sub_maker: Any) -> List[SrtCue]:
    """edge-tts SubMaker(或兼容结构)→ SrtCue 列表。

    edge-tts 7.x 的 SubMaker 有 ``cues`` 属性(每个 cue 暴露 ``.start`` /
    ``.end`` ``.text``,时间是 timedelta);也兼容旧版的 ``.subs`` 列表。
    piper-tts 没有 SubMaker,需要 caller 自己包装一层(M1.C8 tts.py 里会
    做这件事 - 按 audio_duration / len(text) 等分时间)。
    """

    cues_attr = getattr(sub_maker, "cues", None)
    if cues_attr:
        return _from_edge_cues(cues_attr)
    subs_attr = getattr(sub_maker, "subs", None)
    if subs_attr:
        return _from_edge_cues(subs_attr)
    logger.warning("[subtitle] sub_maker has no .cues/.subs attribute; returning []")
    return []


def _from_edge_cues(cues_iter: Iterable[Any]) -> List[SrtCue]:
    out: List[SrtCue] = []
    for i, c in enumerate(cues_iter, start=1):
        text = (getattr(c, "text", "") or "").strip()
        if not text:
            continue
        start = getattr(c, "start", None)
        end = getattr(c, "end", None)
        start_ms = _to_ms(start)
        end_ms = _to_ms(end)
        if end_ms <= start_ms:
            continue
        out.append(SrtCue(index=i, start_ms=start_ms, end_ms=end_ms, text=text))
    return out


def _to_ms(v: Any) -> int:
    """timedelta / float seconds / int ms 统一转 int ms。"""

    if v is None:
        return 0
    if hasattr(v, "total_seconds"):
        return int(v.total_seconds() * 1000)
    if isinstance(v, float):
        return int(v * 1000)
    if isinstance(v, int):
        return v
    try:
        return int(float(v) * 1000)
    except (TypeError, ValueError):
        return 0


# ─────────────────────────────────────────────────────────────────────
# ASR 反推字幕(用户自带音频且没 script 时的兜底)
# ─────────────────────────────────────────────────────────────────────


def cues_from_audio_via_asr(audio_file: str, *, language: Optional[str] = None) -> List[SrtCue]:
    """调 chayuan-server 已有的 whisper-server sidecar 抽字幕。

    M1 简化版:只返一个全长 cue(完整音频时长 + 转录文本)。M4 升级
    扩展 modality.audio.transcribe 支持 word_timestamps=true,拿到 segments
    后按标点分句产出精细 cue。
    """

    try:
        from chayuan.server.modality.audio import AudioModality
    except Exception as e:  # noqa: BLE001
        logger.warning("[subtitle] AudioModality import 失败: %r", e)
        return []
    try:
        am = AudioModality()
        text = am.transcribe(audio_file, language=language)
    except Exception as e:  # noqa: BLE001
        logger.warning("[subtitle] transcribe 调用失败: %r", e)
        return []
    if not text:
        return []
    # 拿不到 audio_duration_ms 时取一个合理上限(用户后续编辑会调)
    audio_duration_ms = _probe_audio_duration_ms(audio_file) or 10_000
    return [SrtCue(index=1, start_ms=0, end_ms=audio_duration_ms, text=text.strip())]


def _probe_audio_duration_ms(audio_file: str) -> Optional[int]:
    """用 moviepy/imageio-ffmpeg 探音频时长(秒) → 毫秒;失败返 None。"""

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
        logger.debug("[subtitle] _probe_audio_duration_ms failed: %r", e)
        return None


# ─────────────────────────────────────────────────────────────────────
# 字幕矫正 — levenshtein + script 比对(原样保留)
# ─────────────────────────────────────────────────────────────────────


def levenshtein_distance(s1: str, s2: str) -> int:
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)
    previous_row = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
    return previous_row[-1]


def similarity(a: str, b: str) -> float:
    if not a and not b:
        return 1.0
    distance = levenshtein_distance(a.lower(), b.lower())
    max_length = max(len(a), len(b))
    if max_length == 0:
        return 1.0
    return 1 - (distance / max_length)


def _split_string_by_punctuations(text: str) -> List[str]:
    """按中英文标点切句,返回非空 trim 后的列表。"""

    if not text:
        return []
    pattern = r"[?,.、;:!…？，。；：！]+|\.\.\."
    parts = re.split(pattern, text)
    return [p.strip() for p in parts if p.strip()]


def correct(subtitle_file: str, video_script: str) -> bool:
    """用 video_script 文本矫正字幕中的朗读偏差(连读 / 漏词 / 跳行)。

    实现思路同上游:逐行比对脚本句 vs SRT cue 文本,相似度高直接采用,
    相似度低时尝试合并相邻 cue 看是否能贴近脚本。被改动写回原 SRT 文件。
    返回是否做了任何修改。
    """

    subtitle_items = file_to_subtitles(subtitle_file)
    if not subtitle_items:
        return False
    script_lines = _split_string_by_punctuations(video_script)
    if not script_lines:
        return False

    corrected = False
    new_items: List[Tuple[int, str, str]] = []
    si = 0
    sub_i = 0

    while si < len(script_lines) and sub_i < len(subtitle_items):
        script_line = script_lines[si]
        sub_line = subtitle_items[sub_i][2].strip()
        if script_line == sub_line:
            new_items.append(subtitle_items[sub_i])
            si += 1
            sub_i += 1
            continue

        combined = sub_line
        start_time = subtitle_items[sub_i][1].split(" --> ")[0]
        end_time = subtitle_items[sub_i][1].split(" --> ")[1]
        next_i = sub_i + 1
        while next_i < len(subtitle_items):
            nxt = subtitle_items[next_i][2].strip()
            if similarity(script_line, combined + " " + nxt) > similarity(
                script_line, combined
            ):
                combined = combined + " " + nxt
                end_time = subtitle_items[next_i][1].split(" --> ")[1]
                next_i += 1
            else:
                break

        if similarity(script_line, combined) > 0.6:
            new_items.append((si + 1, f"{start_time} --> {end_time}", script_line))
            corrected = True
            sub_i = next_i
        else:
            new_items.append(subtitle_items[sub_i])
            sub_i += 1
        si += 1

    while sub_i < len(subtitle_items):
        new_items.append(subtitle_items[sub_i])
        sub_i += 1

    if corrected:
        with open(subtitle_file, "w", encoding="utf-8") as f:
            for idx, (i, tm, tx) in enumerate(new_items, start=1):
                f.write(f"{idx}\n{tm}\n{tx}\n\n")
        logger.info("[subtitle] corrected %s using script", subtitle_file)
    return corrected
