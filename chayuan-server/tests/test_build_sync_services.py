"""``sync_services`` 行为测试。

集成版打包时,vendor/services/llama-server/* 应整树拷到
src-tauri/services/llama-server/*;轻量版应清空 src-tauri/services/。
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


@pytest.fixture
def build_module(tmp_path, monkeypatch):
    """动态导入 build.py,把 ROOT/DESKTOP_SRC_TAURI 替换成 tmp_path"""
    build_py = Path(__file__).resolve().parent.parent / "packaging" / "pyinstaller" / "build.py"
    spec = importlib.util.spec_from_file_location("build_mod", build_py)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    # 重写 ROOT/DESKTOP_SRC_TAURI 指向 tmp_path 镜像
    monkeypatch.setattr(mod, "ROOT", tmp_path)
    monkeypatch.setattr(mod, "DESKTOP_SRC_TAURI", tmp_path / "desktop_src_tauri")
    monkeypatch.setattr(mod, "SERVICES_SRC", tmp_path / "vendor" / "services")
    monkeypatch.setattr(mod, "DESKTOP_SERVICES_DIR", tmp_path / "desktop_src_tauri" / "services")
    return mod


def test_sync_services_integrated_copies_tree(build_module, tmp_path):
    """集成版应整树拷 vendor/services/ → src-tauri/services/"""
    svc_src = tmp_path / "vendor" / "services" / "llama-server"
    svc_src.mkdir(parents=True)
    (svc_src / "llama-server.exe").write_bytes(b"x" * 1024)
    (svc_src / "ggml-cpu.dll").write_bytes(b"y" * 512)
    (svc_src / "VERSION").write_text("b4404\n2026-05-15\n")

    build_module.sync_services(lite=False)

    dst = tmp_path / "desktop_src_tauri" / "services" / "llama-server"
    assert (dst / "llama-server.exe").is_file()
    assert (dst / "llama-server.exe").read_bytes() == b"x" * 1024
    assert (dst / "ggml-cpu.dll").is_file()
    assert (dst / "VERSION").read_text().startswith("b4404")


def test_sync_services_lite_clears_dir(build_module, tmp_path):
    """轻量版应清空 src-tauri/services/,只留 .gitkeep"""
    svc_src = tmp_path / "vendor" / "services" / "llama-server"
    svc_src.mkdir(parents=True)
    (svc_src / "llama-server.exe").write_bytes(b"x" * 1024)

    # 先模拟上次集成版残留
    dst_dir = tmp_path / "desktop_src_tauri" / "services" / "llama-server"
    dst_dir.mkdir(parents=True)
    (dst_dir / "stale.exe").write_bytes(b"old")

    build_module.sync_services(lite=True)

    dst = tmp_path / "desktop_src_tauri" / "services"
    assert dst.is_dir()
    assert (dst / ".gitkeep").is_file()
    assert not (dst / "llama-server").exists()  # 残留干净


def test_sync_services_missing_src_does_not_crash(build_module, tmp_path):
    """vendor/services/ 不存在时(开发机没跑过 install-llama-server)应 graceful 退化"""
    # 不创建 SERVICES_SRC
    build_module.sync_services(lite=False)

    dst = tmp_path / "desktop_src_tauri" / "services"
    assert dst.is_dir()
    assert (dst / ".gitkeep").is_file()


def test_sync_services_size_guard_rejects_2gb(build_module, tmp_path):
    """单文件 ≥ 2 GB 应 abort (Windows installer 硬限制)"""
    svc_src = tmp_path / "vendor" / "services" / "huge"
    svc_src.mkdir(parents=True)
    huge = svc_src / "huge.bin"
    # 不能真造 2 GB 文件,mock stat().st_size 行为不好;
    # 改用 sparse file (truncate) 在大多数 fs 上支持
    with open(huge, "wb") as f:
        f.truncate(build_module._WIN_INSTALLER_FILE_LIMIT + 1)

    with pytest.raises(SystemExit) as exc:
        build_module.sync_services(lite=False)
    assert exc.value.code == 2
