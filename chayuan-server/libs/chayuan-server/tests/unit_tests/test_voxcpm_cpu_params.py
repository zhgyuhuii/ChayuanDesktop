from chayuan.server.modality.audio import AudioPipeline


def test_cpu_caps_inference_timesteps():
    out = AudioPipeline._cap_clone_params_for_cpu(
        {"inference_timesteps": 15, "cfg_value": 2.0}, cuda_available=False)
    assert out["inference_timesteps"] == 10   # 压回 voxcpm 默认上限
    assert out["cfg_value"] == 2.0            # 只压步数,不动 cfg


def test_gpu_keeps_inference_timesteps():
    out = AudioPipeline._cap_clone_params_for_cpu(
        {"inference_timesteps": 15}, cuda_available=True)
    assert out["inference_timesteps"] == 15


def test_cpu_below_cap_unchanged():
    out = AudioPipeline._cap_clone_params_for_cpu(
        {"inference_timesteps": 8}, cuda_available=False)
    assert out["inference_timesteps"] == 8


def test_does_not_mutate_input():
    src = {"inference_timesteps": 15}
    AudioPipeline._cap_clone_params_for_cpu(src, cuda_available=False)
    assert src["inference_timesteps"] == 15   # 不就地改入参
