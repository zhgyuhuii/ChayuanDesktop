"""本地语音合成后端逐档自检:piper / edge / sherpa / 克隆(voxcpm)各自**隔离**测一遍,
报精确根因(import / 模型路径 / worker spawn / torch / 参考音频)。

为什么要在安装包内跑
--------------------
试听走的 ``synthesize`` 在单档失败时**静默回退 piper**(返回 200、X-Tts-Provider=piper),
所以"试听有声音"不代表你选的音色 OK。这里直接调 tts.py 的单档
``_synthesize_via_<engine>``,不走外层 fallback,逐档看真实成败 + 根因。

在**安装包(frozen)自身的 python** 里跑最准 —— import 路径 / PyInstaller rthook /
bundled 模型都跟真实运行一致,直接看出"dev 能、打包不能":

    # macOS 安装版(用与 sidecar 相同的 CHAYUAN_ROOT,模型/参考音频路径才对得上)
    CHAYUAN_ROOT=/Users/<you>/work/xxx \
      /Applications/Chayuan.app/Contents/Resources/chayuan-server/chayuan-server diagnose-tts

    # dev 源码
    CHAYUAN_ROOT=<data dir> poetry run chayuan diagnose-tts

不绑端口、不杀实例,可与正在运行的 sidecar 并存(只是自己会另起 worker / 载模型)。
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
from typing import Any, Dict, Tuple

_TEXT = "你好,这是语音合成自检。"


def _try_import(modname: str) -> str:
    try:
        __import__(modname)
        return "[OK]"
    except BaseException as e:  # noqa: BLE001
        return f"[FAIL] {type(e).__name__}: {e}"


def _isolated_synth(engine: str, voice_name: str | None = None) -> Tuple[bool, str]:
    """直接调 tts.py 单档 ``_synthesize_via_<engine>``,不走外层 fallback。"""
    try:
        from chayuan.server.video_generation.steps import tts as _t
    except BaseException as e:  # noqa: BLE001
        return False, f"[FAIL] import tts 模块失败: {type(e).__name__}: {e}"
    fn = getattr(_t, f"_synthesize_via_{engine}", None)
    if fn is None:
        return False, f"[FAIL] tts._synthesize_via_{engine} 不存在"
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    try:
        kw: Dict[str, Any] = {"voice_name": voice_name}
        if engine in ("piper", "edge", "sherpa"):
            kw.update(voice_rate=1.0, voice_volume=1.0)
        t0 = time.time()
        res = fn(_TEXT, tmp.name, **kw)
        dt = int((time.time() - t0) * 1000)
        if res is None:
            return False, (
                f"[FAIL] 返回 None(该档失败;server log 搜 [tts:{engine}] 看 warning 细节)"
            )
        sz = os.path.getsize(tmp.name) if os.path.exists(tmp.name) else 0
        return True, f"[OK] dur={getattr(res, 'duration_ms', 0)}ms wav={sz // 1024}KB 耗时{dt}ms"
    except BaseException as e:  # noqa: BLE001
        return False, f"[FAIL] 异常 {type(e).__name__}: {e}"
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def diagnose() -> Dict[str, Dict[str, Any]]:
    """返回 {engine: {check: result, ..., "_ok": bool}}。"""
    out: Dict[str, Dict[str, Any]] = {}

    # ── piper(纯离线 ONNX,主力)──────────────────────────────
    p: Dict[str, Any] = {"import piper.voice": _try_import("piper.voice")}
    try:
        from chayuan.server.modality.audio import AudioPipeline
        p["voice 解析(.onnx)"] = AudioPipeline()._resolve_piper_voice_path("") or "[WARN] 未解析到 .onnx"
    except BaseException as e:  # noqa: BLE001
        p["voice 解析(.onnx)"] = f"[FAIL] resolver 异常 {type(e).__name__}: {e}"
    ok, info = _isolated_synth("piper")
    p["隔离合成"] = info
    p["_ok"] = ok
    out["piper"] = p

    # ── edge(微软云,需联网,国内常被墙)────────────────────
    e_: Dict[str, Any] = {"import edge_tts": _try_import("edge_tts")}
    ok, info = _isolated_synth("edge", voice_name="zh-CN-XiaoxiaoNeural")
    e_["隔离合成(需联网)"] = info
    e_["_ok"] = ok
    out["edge"] = e_

    # ── sherpa(子进程隔离 worker)──────────────────────────
    s: Dict[str, Any] = {"import sherpa_onnx": _try_import("sherpa_onnx")}
    try:
        from chayuan.server.modality.audio import probe_tts_worker
        s["worker spawn(ping)"] = "[OK]" if probe_tts_worker(timeout=60) else "[FAIL] 见上方大字报"
    except BaseException as e:  # noqa: BLE001
        s["worker spawn(ping)"] = f"[FAIL] 异常 {type(e).__name__}: {e}"
    ok, info = _isolated_synth("sherpa")
    s["隔离合成"] = info
    s["_ok"] = ok
    out["sherpa"] = s

    # ── clone / voxcpm(零样本克隆,依赖 torch + 参考音频)──────
    c: Dict[str, Any] = {
        "import torch": _try_import("torch"),
        "import voxcpm": _try_import("voxcpm"),
    }
    try:
        from chayuan.server.video_generation._helpers import voice_clones_dir
        d = voice_clones_dir()
        wavs = [f for f in os.listdir(d) if f.endswith(".wav")] if os.path.isdir(d) else []
        c["参考音频目录"] = f"{d} ({len(wavs)} 个 .wav)"
    except BaseException as e:  # noqa: BLE001
        c["参考音频目录"] = f"[FAIL] 异常 {type(e).__name__}: {e}"
    ok, info = _isolated_synth("clone")
    c["隔离合成(默认音色)"] = info
    c["_ok"] = ok
    out["clone"] = c

    return out


def print_report(out: Dict[str, Dict[str, Any]] | None = None) -> bool:
    """打印逐档报告;返回 True=四档全部隔离合成成功。"""
    out = out if out is not None else diagnose()
    w = sys.stdout.write
    w("\n=========== 本地语音合成后端自检(安装包内 frozen 环境) ===========\n")
    w(f"CHAYUAN_ROOT = {os.environ.get('CHAYUAN_ROOT', '(未设,按默认解析)')}\n")
    all_ok = True
    for eng in ("piper", "edge", "sherpa", "clone"):
        d = out.get(eng, {})
        ok = bool(d.get("_ok"))
        all_ok = all_ok and ok
        w(f"\n{'[OK]  ' if ok else '[FAIL]'} {eng}\n")
        for k, v in d.items():
            if k == "_ok":
                continue
            w(f"    {k:20}: {v}\n")
    w("\n说明:[FAIL] 的档在试听时会**静默回退 piper**(返回 200 但音色不对),所以\n")
    w("     '试听出声' 不代表该音色 OK —— 以上面每档的『隔离合成』为准。\n")
    w("  piper  缺 .onnx -> 放 zh_CN-huayan-medium 或开 CHAYUAN_PIPER_AUTO_DOWNLOAD=1\n")
    w("  edge   需联网,国内常被墙 -> 用离线 piper/sherpa\n")
    w("  sherpa worker[FAIL]=frozen spawn 没起来(看 [mp-freeze]);import[FAIL]=spec 漏 sherpa_onnx\n")
    w("  clone  torch[FAIL]=没装 PyTorch(UI『安装 PyTorch』);或缺参考音频\n")
    w("==================================================================\n")
    sys.stdout.flush()
    return all_ok
