"""Unit tests for MuseTalk GPU runtime framework registration (GPU-P3 T1)."""


def test_musetalk_framework_registered():
    from chayuan.server.config_panel.runtime_framework_panel import _FRAMEWORK_CATALOG
    spec = next((s for s in _FRAMEWORK_CATALOG if s.name == "musetalk"), None)
    assert spec is not None and spec.needs_gpu is True and "18780" in spec.default_url


def test_musetalk_launch_recipe_present():
    from chayuan.server.config_panel import install_task_manager as itm
    rec = itm._START_RECIPES.get("musetalk")
    assert rec is not None and "musetalk_server" in rec.label


def test_musetalk_install_recipe_present():
    from chayuan.server.config_panel.install_recipes import get_recipes
    out = get_recipes("musetalk")
    joined = " ".join(" ".join(r.cmd) for r in out)
    assert "MuseTalk" in joined or "musetalk" in joined
