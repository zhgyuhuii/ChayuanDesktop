"""runtime/pytorch_installer 无 pip wheel 安装器测试。

覆盖 wheel 解压(``_extract_wheel``)、平台 tag 探测、幂等检查,以及一个
**可联网时才跑**的真实「下小 pure wheel + 解压」端到端验证(filelock)。

为什么单建文件
==============
test_pytorch_installer_offline_wheels.py 守的是 ``_find_offline_wheels`` /
``build_install_recipe`` 的 recipe 形态;本文件守的是真正干活的
``install_pytorch_wheels`` 链路 —— 下载 / zipfile 解压 / 校验。
"""
from __future__ import annotations

import io
import os
import urllib.request
import zipfile
from pathlib import Path

import pytest


def _make_fake_wheel(path: Path, pkg: str = "demo", ver: str = "1.0") -> None:
    """造一个最小合规 wheel(zip):含 ``<pkg>/`` + ``.dist-info/`` + ``.data/``。"""
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr(f"{pkg}/__init__.py", "VALUE = 1\n")
        zf.writestr(f"{pkg}/sub/mod.py", "X = 2\n")
        zf.writestr(f"{pkg}-{ver}.dist-info/METADATA", f"Name: {pkg}\nVersion: {ver}\n")
        zf.writestr(f"{pkg}-{ver}.dist-info/WHEEL", "Wheel-Version: 1.0\n")
        # .data/purelib 内容要被摊进 target
        zf.writestr(f"{pkg}-{ver}.data/purelib/extra_pkg/__init__.py", "Y = 3\n")
        # .data/scripts 要被忽略
        zf.writestr(f"{pkg}-{ver}.data/scripts/demo-cli", "#!/bin/sh\necho hi\n")


# ───────────────────────────── _extract_wheel ─────────────────────────────


def test_extract_wheel_layout(tmp_path):
    """解压:<pkg>/ + dist-info 直接进 target;.data/purelib 摊平;.data/scripts 丢弃。"""
    from chayuan.server.runtime import pytorch_installer as pi

    whl = tmp_path / "demo-1.0-py3-none-any.whl"
    _make_fake_wheel(whl)
    target = tmp_path / "py_packages"

    logs: list = []
    pi._extract_wheel(whl, target, log=logs.append)

    assert (target / "demo" / "__init__.py").is_file()
    assert (target / "demo" / "sub" / "mod.py").is_file()
    assert (target / "demo-1.0.dist-info" / "METADATA").is_file()
    # .data/purelib 内容摊进 target(去掉 .data/purelib 前缀)
    assert (target / "extra_pkg" / "__init__.py").is_file()
    # .data/scripts 被忽略
    assert not (target / "demo-1.0.data").exists()
    assert not (target / "demo-cli").exists()
    assert any("extract" in m for m in logs)


def test_extract_wheel_rejects_zip_slip(tmp_path):
    """含越界路径(../)的 wheel 必须被拒绝,不写到 target 外。"""
    from chayuan.server.runtime import pytorch_installer as pi

    whl = tmp_path / "evil-1.0-py3-none-any.whl"
    with zipfile.ZipFile(whl, "w") as zf:
        zf.writestr("../escaped.py", "PWNED = 1\n")
    target = tmp_path / "py_packages"

    with pytest.raises(pi.WheelInstallError):
        pi._extract_wheel(whl, target, log=lambda m: None)
    assert not (tmp_path / "escaped.py").exists()


# ──────────────────────── 平台 / py tag 探测 ────────────────────────


def test_py_tag_format():
    from chayuan.server.runtime import pytorch_installer as pi

    tag = pi._py_tag()
    assert tag.startswith("cp3")
    assert tag[2:].isdigit()


def test_host_platform_tags_nonempty_on_known_os():
    """已知 OS(linux/win/mac)上必须能给出至少一个 platform tag。"""
    import sys

    from chayuan.server.runtime import pytorch_installer as pi

    tags = pi._host_platform_tags()
    if sys.platform.startswith(("win", "linux")) or sys.platform == "darwin":
        assert tags, f"{sys.platform} 应有 platform tag"
        assert all(isinstance(t, str) and t for t in tags)


def test_torch_cdn_url_shape():
    """torch CDN URL 应是 download.pytorch.org/whl/cpu 下的 .whl。"""
    import sys

    from chayuan.server.runtime import pytorch_installer as pi

    if pi._torch_wheel_platform_tag() is None:
        pytest.skip("当前平台不在 torch wheel 映射里")
    url = pi._torch_cdn_wheel_url("torch", pi._TORCH_VERSION)
    assert url.startswith("https://download.pytorch.org/whl/cpu/")
    assert url.endswith(".whl")
    assert pi._TORCH_VERSION in url
    # 非 macOS wheel 文件名带 +cpu local 标识
    if sys.platform != "darwin":
        assert "%2Bcpu" in url or "+cpu" in url


# ──────────────────────── 幂等 / 目标目录 ────────────────────────


def test_already_installed_detection(tmp_path):
    """_torch_already_installed:torch/__init__.py + version.py 都在才算装好。"""
    from chayuan.server.runtime import pytorch_installer as pi

    target = tmp_path / "py_packages"
    assert pi._torch_already_installed(target) is False

    (target / "torch").mkdir(parents=True)
    (target / "torch" / "__init__.py").write_text("")
    assert pi._torch_already_installed(target) is False  # 还缺 version.py

    (target / "torch" / "version.py").write_text("__version__='x'")
    assert pi._torch_already_installed(target) is True


def test_install_skips_when_already_installed(tmp_path, monkeypatch):
    """install_pytorch_wheels:已装过且非 force → 直接 skipped,不下载。"""
    from chayuan.server.runtime import pytorch_installer as pi

    pkg_dir = tmp_path / "py_packages"
    (pkg_dir / "torch").mkdir(parents=True)
    (pkg_dir / "torch" / "__init__.py").write_text("")
    (pkg_dir / "torch" / "version.py").write_text("__version__='2.7.0'")
    monkeypatch.setenv("CHAYUAN_PY_PACKAGES_DIR", str(pkg_dir))

    result = pi.install_pytorch_wheels(prefer_offline=True, log=lambda m: None)
    assert result["action"] == "skipped"


# ──────────────────── 真实联网:下小 pure wheel + 解压 ────────────────────


def _has_network() -> bool:
    try:
        urllib.request.urlopen("https://pypi.org/pypi/filelock/json", timeout=8).close()
        return True
    except Exception:  # noqa: BLE001
        return False


@pytest.mark.skipif(not _has_network(), reason="无网络,跳过真实下载验证")
def test_real_download_and_extract_pure_wheel(tmp_path):
    """端到端:从 PyPI 解析 filelock 的 wheel URL → 下载 → zipfile 解压 → 校验。

    filelock 是纯 python 小包(~20 KB),用它验证「解析 URL + 下载 + 解压」整条链路
    正确,而不用拖 ~250 MB 的 torch。
    """
    from chayuan.server.runtime import pytorch_installer as pi

    logs: list = []
    url = pi._resolve_pypi_wheel_url("filelock", "3.18.0", pure=True, log=logs.append)
    assert url.endswith(".whl")
    assert "filelock" in url

    dest = tmp_path / url.rsplit("/", 1)[-1].split("#")[0]
    pi._download_file(url, dest, log=logs.append)
    assert dest.is_file() and dest.stat().st_size > 0

    target = tmp_path / "py_packages"
    pi._extract_wheel(dest, target, log=logs.append)
    # filelock 解压后应有 filelock/__init__.py
    assert (target / "filelock" / "__init__.py").is_file()
