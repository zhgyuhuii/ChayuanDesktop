from chayuan.server.video_generation import compute


def test_plan_cpu_fallback(monkeypatch):
    monkeypatch.setattr(compute, "_has_cuda", lambda: False)
    monkeypatch.setattr(compute, "_nvenc_available", lambda exe: False)
    compute.get_compute.cache_clear()
    p = compute.get_compute()
    assert p.video_encoder == "libx264"
    assert "-c:v" in p.encoder_opts and "libx264" in p.encoder_opts
    assert p.infer_fp16 is False


def test_plan_gpu(monkeypatch):
    monkeypatch.setattr(compute, "_has_cuda", lambda: True)
    monkeypatch.setattr(compute, "_nvenc_available", lambda exe: True)
    monkeypatch.setattr(compute, "_gpu_info", lambda: ("RTX", 24000))
    compute.get_compute.cache_clear()
    p = compute.get_compute()
    assert p.video_encoder == "h264_nvenc"
    assert p.infer_fp16 is True
    compute.get_compute.cache_clear()
