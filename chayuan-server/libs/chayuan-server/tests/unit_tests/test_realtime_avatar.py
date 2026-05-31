"""RT-P2 Task 1: realtime_avatar GPU 运行时注册验证。

测试 catalog / 启动配方 / 安装配方 三个注册点。
"""
from __future__ import annotations


def test_realtime_avatar_framework_registered():
    from chayuan.server.config_panel.runtime_framework_panel import _FRAMEWORK_CATALOG
    spec = next((s for s in _FRAMEWORK_CATALOG if s.name == "realtime_avatar"), None)
    assert spec is not None and spec.needs_gpu is True and "18880" in spec.default_url


def test_realtime_avatar_launch_recipe():
    from chayuan.server.config_panel import install_task_manager as itm
    rec = itm._START_RECIPES.get("realtime_avatar")
    assert rec is not None and "realtime_avatar_server" in rec.label


def test_realtime_avatar_install_recipe():
    from chayuan.server.config_panel.install_recipes import get_recipes
    out = get_recipes("realtime_avatar")
    joined = " ".join(" ".join(r.cmd) for r in out)
    assert "aiortc" in joined
