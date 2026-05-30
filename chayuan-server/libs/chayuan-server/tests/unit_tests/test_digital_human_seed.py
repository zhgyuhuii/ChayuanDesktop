import importlib.util, os


def test_seed_module_has_check():
    spec = importlib.util.spec_from_file_location(
        "seed_dh", os.path.join(os.path.dirname(__file__),
        "../../../../scripts/seed_digital_human.py"))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    assert hasattr(m, "_is_ready") and hasattr(m, "MODELSCOPE_ID")
    assert m.MODELSCOPE_ID == "silveroxides/ComfyUI_wav2lip-models"
