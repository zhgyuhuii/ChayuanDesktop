#!/usr/bin/env python3
"""本地语音合成后端 HTTP 自检(对**正在运行**的 sidecar,免重建)。

逐档打 /preview-audio,靠响应头 ``X-Tts-Provider`` 看真实出声引擎 —— 因为单档失败时
后端会**静默回退 piper**(仍 200),所以"有声音"不代表该音色 OK。请求 piper 却回
piper=正常;请求 sherpa 却回 piper=sherpa 坏了。

用法:
    python3 scripts/diagnose-tts-http.py [API_BASE]
    # 默认 http://127.0.0.1:62581;也可 CHAYUAN_API 环境变量覆盖

只用标准库,macOS/Windows/Linux 任意 python3 可跑。要看每档失败的**根因**(import/
模型/torch/worker),用安装包内的 `chayuan diagnose-tts`(在 frozen 环境里逐档隔离测)。
"""
import json
import os
import sys
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("CHAYUAN_API", "http://127.0.0.1:62581")).rstrip("/")
TEXT = "你好,这是语音合成测试。"
ENGINES = [
    ("piper", None),
    ("edge", "zh-CN-XiaoxiaoNeural"),
    ("sherpa", None),
    ("clone", None),  # 克隆需 torch + 参考音频,无参考会回退/报错
]


def probe(provider, voice_name):
    body = json.dumps({
        "video_script": TEXT,
        "voice_provider": provider,
        "voice_name": voice_name,
        "voice_rate": 1.0,
        "voice_volume": 1.0,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}/api/v1/video-generation/preview-audio",
        data=body, headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            used = r.headers.get("X-Tts-Provider", "?")
            dur = r.headers.get("X-Audio-Duration-Ms", "?")
            n = len(r.read())
            if used == provider:
                return f"[OK]   出声引擎={used} dur={dur}ms wav={n // 1024}KB"
            return (f"[FAIL] 请求 {provider} 却由 **{used}** 出声 —— {provider} 坏了、静默回退了。"
                    f"(在安装包内跑 `chayuan diagnose-tts` 看 {provider} 的根因)")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:600]
        if e.code == 401:
            return "[AUTH] 401 需要鉴权 —— 单机版应为 anonymous;确认是单机 profile"
        return f"[FAIL] HTTP {e.code}: {detail}"
    except Exception as e:  # noqa: BLE001
        return f"[FAIL] 连不上/超时: {type(e).__name__}: {e}"


def main():
    print(f"\n===== 本地语音合成 HTTP 自检 @ {BASE} =====")
    try:
        with urllib.request.urlopen(f"{BASE}/healthz", timeout=5) as r:
            print(f"/healthz: {r.status}")
    except Exception as e:  # noqa: BLE001
        print(f"/healthz 不通: {e!r}  —— 服务没起?先确认 sidecar 在跑")
        return
    for provider, vn in ENGINES:
        print(f"\n-- {provider} --")
        print("  " + probe(provider, vn))
    print("\n说明:'请求 X 却由 piper 出声' = X 坏了被静默回退。根因看 `chayuan diagnose-tts`。")
    print("=" * 50)


if __name__ == "__main__":
    main()
