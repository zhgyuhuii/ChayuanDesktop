"""install_model revision 透传回归测试。

行为合同
--------
1. ``start(revision='x')`` → job.revision == 'x';空串/None → None(保持源默认分支)。
2. ``to_dict()`` 序列化带上 revision。
3. ``_download_huggingface`` / ``_download_modelscope`` 在 job.revision 非空时,
   把 ``revision=`` 透传进 HF ``snapshot_download`` / ``hf_hub_download`` 和
   ModelScope ``snapshot_download`` / ``model_file_download``;空时**不**传该参数
   (保持 SDK 默认分支行为)。

背景:模型广场 HubFilePickerDialog 能选 revision 并影响文件清单展示,但安装时
revision 此前被丢弃,后端只下默认分支。本测试锁死透传链路最后一段(job→下载器)。
"""
import sys
import types
from unittest.mock import patch

import pytest

from chayuan.server.model_registry.install_model import (
    InstallModelJob,
    InstallModelJobManager,
    ModelJobStatus,
)


def _quiet_run(self, job):  # noqa: ANN001, ARG001
    return None


def _make_job(revision):
    return InstallModelJob(
        id="t",
        source="huggingface",
        model_id="BAAI/bge-m3",
        capability="text-embedding",
        requested_file=None,
        revision=revision,
        status=ModelJobStatus.RUNNING,
        started_at=0.0,
    )


def test_start_keeps_revision():
    mgr = InstallModelJobManager()
    with patch.object(InstallModelJobManager, "_run", _quiet_run):
        job = mgr.start(
            source="huggingface",
            model_id="BAAI/bge-m3",
            capability="text-embedding",
            revision="v1.5",
        )
    assert job.revision == "v1.5"
    assert job.to_dict()["revision"] == "v1.5"


@pytest.mark.parametrize("rev", [None, "", "   "])
def test_start_blank_revision_normalizes_to_none(rev):
    mgr = InstallModelJobManager()
    with patch.object(InstallModelJobManager, "_run", _quiet_run):
        job = mgr.start(
            source="huggingface",
            model_id="BAAI/bge-m3",
            capability="text-embedding",
            revision=rev,
        )
    assert job.revision is None
    assert job.to_dict()["revision"] is None


def _install_fake_hf(calls):
    mod = types.ModuleType("huggingface_hub")

    def snapshot_download(**kwargs):
        calls["snapshot"] = kwargs
        return "/tmp/x"

    def hf_hub_download(**kwargs):
        calls["file"] = kwargs
        return "/tmp/x/f"

    mod.snapshot_download = snapshot_download
    mod.hf_hub_download = hf_hub_download
    return mod


def test_hf_snapshot_passes_revision(tmp_path):
    calls = {}
    fake_hf = _install_fake_hf(calls)
    fake_mirror = types.ModuleType("chayuan.server.model_registry.hf_mirror")
    fake_mirror.force_hf_mirror_endpoint = lambda: "https://hf-mirror.com"
    import os
    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    mgr = InstallModelJobManager()
    job = _make_job("refs/pr/3")
    with patch.dict(sys.modules, {
        "huggingface_hub": fake_hf,
        "chayuan.server.model_registry.hf_mirror": fake_mirror,
    }):
        mgr._download_huggingface(job, tmp_path)
    assert calls["snapshot"]["revision"] == "refs/pr/3"


def test_hf_snapshot_omits_revision_when_blank(tmp_path):
    calls = {}
    fake_hf = _install_fake_hf(calls)
    fake_mirror = types.ModuleType("chayuan.server.model_registry.hf_mirror")
    fake_mirror.force_hf_mirror_endpoint = lambda: "https://hf-mirror.com"
    import os
    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    mgr = InstallModelJobManager()
    job = _make_job(None)
    with patch.dict(sys.modules, {
        "huggingface_hub": fake_hf,
        "chayuan.server.model_registry.hf_mirror": fake_mirror,
    }):
        mgr._download_huggingface(job, tmp_path)
    assert "revision" not in calls["snapshot"]


def test_modelscope_snapshot_passes_revision(tmp_path):
    calls = {}
    snap_mod = types.ModuleType("modelscope.hub.snapshot_download")
    file_mod = types.ModuleType("modelscope.hub.file_download")

    def ms_snapshot(**kwargs):
        calls["snapshot"] = kwargs

    def ms_file(**kwargs):
        calls["file"] = kwargs

    snap_mod.snapshot_download = ms_snapshot
    file_mod.model_file_download = ms_file
    mgr = InstallModelJobManager()
    job = _make_job("master-2024")
    with patch.dict(sys.modules, {
        "modelscope.hub.snapshot_download": snap_mod,
        "modelscope.hub.file_download": file_mod,
    }):
        mgr._download_modelscope(job, tmp_path)
    assert calls["snapshot"]["revision"] == "master-2024"


def test_modelscope_snapshot_omits_revision_when_blank(tmp_path):
    calls = {}
    snap_mod = types.ModuleType("modelscope.hub.snapshot_download")
    file_mod = types.ModuleType("modelscope.hub.file_download")
    snap_mod.snapshot_download = lambda **kwargs: calls.__setitem__("snapshot", kwargs)
    file_mod.model_file_download = lambda **kwargs: calls.__setitem__("file", kwargs)
    mgr = InstallModelJobManager()
    job = _make_job(None)
    with patch.dict(sys.modules, {
        "modelscope.hub.snapshot_download": snap_mod,
        "modelscope.hub.file_download": file_mod,
    }):
        mgr._download_modelscope(job, tmp_path)
    assert "revision" not in calls["snapshot"]
