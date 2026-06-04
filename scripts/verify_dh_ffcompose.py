"""P0 ffcompose 冒烟测试:不依赖 wav2lip / 完整 preset,几秒验证 compute 探测 + ffcompose
单趟合成(图层缩放/位置/透明度/时间窗 + 字幕 + 自适应编码器)在本机 ffmpeg 上能跑通。

用法(py312 env):
  PYTHONPATH=chayuan-server/libs/chayuan-server python scripts/verify_dh_ffcompose.py
退出码 0 = 通过。会打印 compute plan(编码器/GPU)与各场景结果。
"""
import os
import subprocess
import sys
import tempfile
import wave

from chayuan.server.video_generation import compute
from chayuan.server.video_generation.digital_human import ffcompose, subtitle_ass


def _png(path, color, w=200, h=200):
    from PIL import Image
    Image.new("RGB", (w, h), color).save(path)


def _silence(path, ms=1500, sr=16000):
    n = int(sr * ms / 1000)
    with wave.open(path, "wb") as wv:
        wv.setnchannels(1); wv.setsampwidth(2); wv.setframerate(sr)
        wv.writeframes(b"\x00\x00" * n)


def _probe(exe, path):
    """返回 (has_video, has_audio, duration_s)。"""
    out = subprocess.run([exe, "-i", path], capture_output=True, text=True).stderr or ""
    has_v = "Video:" in out
    has_a = "Audio:" in out
    return has_v, has_a


def main():
    plan = compute.get_compute()
    print(f"[compute] cuda={plan.has_cuda} gpu={plan.gpu_name!r} vram={plan.vram_mb}MB "
          f"encoder={plan.video_encoder} fp16={plan.infer_fp16} ffmpeg={plan.ffmpeg_exe}")
    exe = plan.ffmpeg_exe
    d = tempfile.mkdtemp(prefix="ffverify_")
    bg = os.path.join(d, "bg.png"); _png(bg, (20, 60, 120))
    pip = os.path.join(d, "pip.png"); _png(pip, (220, 40, 40))
    aud = os.path.join(d, "a.wav"); _silence(aud, 1500)
    ass = subtitle_ass.build_ass(
        [{"start_ms": 0, "end_ms": 1500, "text": "测试字幕 hello"}],
        {"font_size": 48, "text_fore_color": "#FFFFFF", "subtitle_position": "bottom"},
        os.path.join(d, "s.ass"), width=720, height=1280)

    cases = {
        "图层(全屏底 + 半透明 PIP)+ 字幕": {
            "width": 720, "height": 1280, "duration_ms": 1500, "audio_path": aud,
            "layers": [
                {"src": bg, "kind": "image", "x": 0, "y": 0, "scale": 1.0, "z": 0,
                 "opacity": None, "loop": False, "windows": None},
                {"src": pip, "kind": "image", "x": 0.55, "y": 0.6, "scale": 0.3, "z": 1,
                 "opacity": 0.6, "loop": False, "windows": None},
            ],
            "subtitle": {"ass_path": ass},
        },
        "时间窗(coframe 风格,段 0.5-1.0s 才显)": {
            "width": 640, "height": 640, "duration_ms": 1500, "audio_path": aud,
            "layers": [
                {"src": bg, "kind": "image", "x": 0, "y": 0, "scale": 1.0, "z": 0,
                 "opacity": None, "loop": False, "windows": None},
                {"src": pip, "kind": "image", "x": 0.2, "y": 0.2, "scale": 0.4, "z": 1,
                 "opacity": None, "loop": False,
                 "windows": [{"start_ms": 500, "end_ms": 1000}]},
            ],
            "subtitle": None,
        },
    }
    ok = True
    for name, scene in cases.items():
        out = os.path.join(d, f"out_{abs(hash(name)) % 9999}.mp4")
        try:
            ffcompose.render(scene, out)
            hv, ha = _probe(exe, out)
            good = os.path.isfile(out) and os.path.getsize(out) > 1000 and hv and ha
            print(f"[case] {name}: {'PASS' if good else 'FAIL'} "
                  f"(size={os.path.getsize(out) if os.path.isfile(out) else 0} video={hv} audio={ha})")
            ok = ok and good
        except Exception as e:  # noqa: BLE001
            print(f"[case] {name}: ERROR {e!r}")
            ok = False
    print("=== ffcompose smoke:", "PASS" if ok else "FAIL", "===")
    print("产物目录(可自行打开看画面):", d)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
