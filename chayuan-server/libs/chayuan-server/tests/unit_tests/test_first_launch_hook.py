"""``model_registry.first_launch.run_first_launch_hooks`` 测试。"""
from __future__ import annotations

import sys
from unittest import mock

import pytest

from chayuan.server.model_registry.first_launch import (
    FirstLaunchReport,
    run_first_launch_hooks,
)


@pytest.fixture
def chayuan_root_tmp(tmp_path, monkeypatch):
    monkeypatch.setattr("chayuan.settings.CHAYUAN_ROOT", tmp_path)
    # local_index 单例可能在其它测试里建过,这里重置以走新根目录
    import chayuan.server.model_registry.local_index as li
    monkeypatch.setattr(li, "_SINGLETON", None)
    # 默认 mock 掉 bundled_models_dir,避免本仓库 vendor/bundled_models 被默认扫到污染断言;
    # 显式需要 seed 路径的用例自行 monkey.setenv 即可恢复真实解析(env 优先于 mock 不成立,
    # 这里用 monkey.setattr 直接覆盖函数)。
    monkeypatch.setattr(li, "bundled_models_dir", lambda: None)
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    return tmp_path


def test_hook_runs_four_steps_and_reports(chayuan_root_tmp):
    r = run_first_launch_hooks()
    assert isinstance(r, FirstLaunchReport)
    # bundled 源被 mock 成 None -> seed 步骤跑过但 copied/skipped 为空
    assert r.seeded_source is None
    assert r.seeded_copied == []
    # 即使没有本地模型,scan 也应该跑过(空 delta)
    assert r.scanned is True
    # 手册总能部署成功(包内资源 + 临时 root 可写)
    assert r.manuals_md, f"errors={r.errors}"


def test_hook_runs_seed_then_scan_when_bundled_present(tmp_path, monkeypatch):
    """提供真实 bundled 源时,seed 应把文件拷到 CHAYUAN_ROOT/models/bundled,
    随后 scan_once 能扫到 'bundled/' 前缀的 relpath。"""
    monkeypatch.setattr("chayuan.settings.CHAYUAN_ROOT", tmp_path)
    import chayuan.server.model_registry.local_index as li
    monkeypatch.setattr(li, "_SINGLETON", None)
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)

    src = tmp_path / "src_bundled"
    (src / "chat").mkdir(parents=True)
    (src / "chat" / "tiny-chat.gguf").write_bytes(b"chat-bytes")
    monkeypatch.setenv("CHAYUAN_BUNDLED_MODELS_DIR", str(src))

    r = run_first_launch_hooks()
    assert r.seeded_source == str(src)
    assert r.seeded_target == str(tmp_path / "models" / "bundled")
    assert "bundled/chat/tiny-chat.gguf" in r.seeded_copied
    # scan 也应该跑过,且把它纳入索引
    assert r.scanned is True
    idx = li.get_local_index()
    relpaths = {e.relpath for e in idx.list_entries()}
    assert any(r2.startswith("bundled/chat/tiny-chat.gguf") for r2 in relpaths), relpaths


def test_hook_swallows_seed_failure(chayuan_root_tmp):
    with mock.patch(
        "chayuan.server.model_registry.bundled_seed.seed_bundled_models",
        side_effect=RuntimeError("seed boom"),
    ):
        r = run_first_launch_hooks()
    assert r.seeded_copied == []
    assert any("seed_bundled_models" in e for e in r.errors)
    # 后续步骤继续
    assert r.scanned is True


def test_hook_swallows_scan_failure(chayuan_root_tmp):
    with mock.patch(
        "chayuan.server.model_registry.local_index.scan_once",
        side_effect=RuntimeError("disk error"),
    ):
        r = run_first_launch_hooks()
    # scan 失败被吞,后续步骤继续
    assert r.scanned is False
    assert any("scan_once" in e for e in r.errors)
    # 但手册部署不受影响
    assert r.manuals_md or r.manuals_skipped


def test_hook_swallows_promote_failure(chayuan_root_tmp):
    with mock.patch(
        "chayuan.server.model_registry.auto_assign.promote_defaults_from_local",
        side_effect=RuntimeError("yaml error"),
    ):
        r = run_first_launch_hooks()
    assert r.promoted == {}
    assert any("promote_defaults" in e for e in r.errors)


def test_hook_swallows_manuals_failure(chayuan_root_tmp):
    with mock.patch(
        "chayuan.server.manuals.deploy.deploy_user_manuals",
        side_effect=RuntimeError("io error"),
    ):
        r = run_first_launch_hooks()
    assert r.manuals_md == []
    assert any("deploy_user_manuals" in e for e in r.errors)


def test_hook_to_dict_is_json_safe(chayuan_root_tmp):
    import json
    r = run_first_launch_hooks()
    s = json.dumps(r.to_dict())
    d = json.loads(s)
    assert "scanned" in d
    assert "promoted" in d
    assert "manuals_md" in d
    assert "errors" in d
    assert "seeded_source" in d
    assert "seeded_copied" in d
    assert "seeded_skipped" in d
