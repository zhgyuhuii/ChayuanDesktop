"""Unit tests for SadTalker GPU runtime framework registration.

DH-GPU2-T1: 注册 SadTalker 运行时框架 (catalog + 启动 + 安装配方)
"""
from __future__ import annotations


def test_sadtalker_framework_registered():
    from chayuan.server.config_panel.runtime_framework_panel import _FRAMEWORK_CATALOG
    spec = next((s for s in _FRAMEWORK_CATALOG if s.name == "sadtalker"), None)
    assert spec is not None
    assert spec.needs_gpu is True
    assert "18680" in spec.default_url


def test_sadtalker_launch_recipe_present():
    from chayuan.server.config_panel import install_task_manager as itm
    rec = itm._START_RECIPES.get("sadtalker")
    assert rec is not None and "sadtalker_server" in rec.label


def test_sadtalker_install_recipe_present():
    from chayuan.server.config_panel.install_recipes import get_recipes
    out = get_recipes("sadtalker")
    assert any("modelscope" in " ".join(r.cmd) for r in out)
