"""runtime/pytorch_installer._find_offline_wheels 回归测试。

PyInstaller spec(chayuan-server.spec)把 wheel 打到子目录布局
``vendor/torch_wheels/<platform>_py<ver>_<variant>/torch-*.whl``,顶层是空的。
早期 _find_offline_wheels 用 ``d.glob("*.whl")`` 非递归扫,装机后永远扫不到,
默默回退在线下载。这套测试守住"必须 rglob"的修法。
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest


@pytest.fixture
def offline_wheels_layout(tmp_path, monkeypatch):
    """模拟 PyInstaller 装机后的 vendor/torch_wheels/ 子目录布局。"""
    root = tmp_path / "vendor" / "torch_wheels"
    sub = root / "win_amd64_py312_cpu"
    sub.mkdir(parents=True)
    torch_whl = sub / "torch-2.6.0+cpu-cp312-cp312-win_amd64.whl"
    tv_whl = sub / "torchvision-0.21.0+cpu-cp312-cp312-win_amd64.whl"
    torch_whl.write_bytes(b"PK\x03\x04fake-torch")
    tv_whl.write_bytes(b"PK\x03\x04fake-tv")
    # 通过 env 让 _offline_wheels_dir 直接命中 root(优先级最高)
    monkeypatch.setenv("CHAYUAN_OFFLINE_WHEELS_DIR", str(root))
    return {"root": root, "sub": sub, "torch": torch_whl, "tv": tv_whl}


def test_find_offline_wheels_cpu_in_subdir(offline_wheels_layout):
    """rglob 必须能从子目录找到 torch + torchvision 配对。"""
    from chayuan.server.runtime import pytorch_installer as pi

    # _offline_wheels_dir 默认不读 CHAYUAN_OFFLINE_WHEELS_DIR env(看现行实现),
    # 直接 monkey patch 它指向 fixture 的 root
    pi_local = pi
    orig = pi._offline_wheels_dir
    try:
        pi._offline_wheels_dir = lambda: offline_wheels_layout["root"]  # type: ignore[attr-defined]
        wheels = pi._find_offline_wheels("cpu")
    finally:
        pi._offline_wheels_dir = orig  # type: ignore[attr-defined]

    assert len(wheels) == 2, f"应该返 [torch, torchvision] 两个,实际 {wheels}"
    names = sorted(w.name for w in wheels)
    assert any(n.startswith("torch-") for n in names)
    assert any(n.startswith("torchvision-") for n in names)


def test_find_offline_wheels_cuda_variant_filter(tmp_path, monkeypatch):
    """同根下 cpu + cu124 两个子目录同时存在时,variant 过滤要把跨 variant 的剔掉。"""
    from chayuan.server.runtime import pytorch_installer as pi

    root = tmp_path / "vendor" / "torch_wheels"
    cpu_dir = root / "win_amd64_py312_cpu"
    cu_dir = root / "win_amd64_py312_cu124"
    cpu_dir.mkdir(parents=True)
    cu_dir.mkdir(parents=True)
    (cpu_dir / "torch-2.6.0+cpu-cp312-cp312-win_amd64.whl").write_bytes(b"x")
    (cpu_dir / "torchvision-0.21.0+cpu-cp312-cp312-win_amd64.whl").write_bytes(b"x")
    (cu_dir / "torch-2.6.0+cu124-cp312-cp312-win_amd64.whl").write_bytes(b"x")
    (cu_dir / "torchvision-0.21.0+cu124-cp312-cp312-win_amd64.whl").write_bytes(b"x")

    orig = pi._offline_wheels_dir
    try:
        pi._offline_wheels_dir = lambda: root  # type: ignore[attr-defined]
        cpu_wheels = pi._find_offline_wheels("cpu")
        cu_wheels = pi._find_offline_wheels("cu124")
    finally:
        pi._offline_wheels_dir = orig  # type: ignore[attr-defined]

    assert len(cpu_wheels) == 2
    assert all("+cpu" in w.name and "+cu124" not in w.name for w in cpu_wheels)
    assert len(cu_wheels) == 2
    assert all("+cu124" in w.name for w in cu_wheels)


def test_find_offline_wheels_returns_empty_when_dir_missing(monkeypatch):
    """offline dir 不存在(None)时返空列表,不抛。"""
    from chayuan.server.runtime import pytorch_installer as pi

    orig = pi._offline_wheels_dir
    try:
        pi._offline_wheels_dir = lambda: None  # type: ignore[attr-defined]
        assert pi._find_offline_wheels("cpu") == []
    finally:
        pi._offline_wheels_dir = orig  # type: ignore[attr-defined]


def test_find_offline_wheels_returns_empty_when_pair_incomplete(tmp_path):
    """只有 torch 没 torchvision(或反之)— 返空,让 caller 走在线 fallback。"""
    from chayuan.server.runtime import pytorch_installer as pi

    root = tmp_path / "wheels"
    sub = root / "win_amd64_py312_cpu"
    sub.mkdir(parents=True)
    (sub / "torch-2.6.0+cpu-cp312-cp312-win_amd64.whl").write_bytes(b"x")
    # 没 torchvision

    orig = pi._offline_wheels_dir
    try:
        pi._offline_wheels_dir = lambda: root  # type: ignore[attr-defined]
        result = pi._find_offline_wheels("cpu")
    finally:
        pi._offline_wheels_dir = orig  # type: ignore[attr-defined]

    assert result == []
