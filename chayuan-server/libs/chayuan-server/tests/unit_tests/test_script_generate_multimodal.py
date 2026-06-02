"""DH /script/generate 多模态(商品图直用 / 视频抽帧 -> VLM 看图出文案)。

待 py312 跑 pytest(沙箱 py3.6 跑不了)。验证三条:
  ① 有图 product_ref -> 构造含 image_url 的 HumanMessage 调 invoke
  ② 视频 product_ref -> 触发抽帧并产生多个 image_url
  ③ 无 product_ref -> 走纯文本(不构造 image_url)
"""
from __future__ import annotations

import base64
import os

import pytest

from chayuan.server.video_generation.steps import script as script_mod


class _FakeMsg:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeLLM:
    """记录最后一次 invoke 收到的 messages,返回桩文案。"""

    last_invoke = None

    def invoke(self, messages):  # noqa: ANN001
        _FakeLLM.last_invoke = messages
        # messages 可能是 str(纯文本路径) 或 [HumanMessage](多模态路径)
        return _FakeMsg("桩文案")


@pytest.fixture(autouse=True)
def _patch_llm_and_dir(monkeypatch, tmp_path):
    # mock get_ChatOpenAI / get_default_llm / resolve_model
    import chayuan.server.utils as utils_mod
    monkeypatch.setattr(utils_mod, "get_ChatOpenAI", lambda **kw: _FakeLLM())
    monkeypatch.setattr(utils_mod, "get_default_llm", lambda: "fake-model")

    import chayuan.server.capability_router as cap_mod
    monkeypatch.setattr(cap_mod, "resolve_model", lambda cap: "fake-model")

    # dh_products_dir -> tmp
    import chayuan.server.video_generation._helpers as helpers_mod
    monkeypatch.setattr(
        helpers_mod, "dh_products_dir", lambda *, create=False: str(tmp_path)
    )

    _FakeLLM.last_invoke = None
    yield


def _content_of(messages):
    """从 invoke 收到的 messages 拿 content;纯文本路径是 str。"""
    if isinstance(messages, str):
        return messages
    # [HumanMessage(content=[...])]
    return messages[0].content


def _has_image_url(content) -> bool:
    return isinstance(content, list) and any(
        isinstance(b, dict) and b.get("type") == "image_url" for b in content
    )


def test_image_product_ref_builds_image_url_message(tmp_path):
    """① 图片 product_ref -> HumanMessage content 含 image_url。"""
    fid = "1700000000-abc123.png"
    (tmp_path / fid).write_bytes(b"\x89PNG\r\n\x1a\nfake")
    out = script_mod.generate_script("夏季新款连衣裙", product_ref=f"product:{fid}")
    assert out == "桩文案"
    content = _content_of(_FakeLLM.last_invoke)
    assert _has_image_url(content), "应构造含 image_url 的多模态消息"
    urls = [b["image_url"]["url"] for b in content if b.get("type") == "image_url"]
    assert len(urls) == 1
    assert urls[0].startswith("data:image/png;base64,")


def test_video_product_ref_extracts_multiple_frames(tmp_path, monkeypatch):
    """② 视频 product_ref -> 抽帧产生多个 image_url(mock ffmpeg 写帧)。"""
    fid = "1700000000-def456.mp4"
    (tmp_path / fid).write_bytes(b"fakevideo")

    def _fake_run(cmd, **kw):  # noqa: ANN001
        # cmd 末位是输出 pattern .../f_%02d.jpg;模拟 ffmpeg 写出 3 帧
        pattern = cmd[-1]
        outdir = os.path.dirname(pattern)
        for i in range(1, 4):
            with open(os.path.join(outdir, "f_%02d.jpg" % i), "wb") as fh:
                fh.write(b"\xff\xd8\xff" + bytes([i]))
        class _R:
            returncode = 0
        return _R()

    import subprocess
    monkeypatch.setattr(subprocess, "run", _fake_run)

    out = script_mod.generate_script("智能保温杯", product_ref=f"product:{fid}")
    assert out == "桩文案"
    content = _content_of(_FakeLLM.last_invoke)
    assert _has_image_url(content)
    urls = [b["image_url"]["url"] for b in content if b.get("type") == "image_url"]
    assert len(urls) >= 2, "视频应抽出多帧"
    assert all(u.startswith("data:image/jpeg;base64,") for u in urls)


def test_no_product_ref_text_only(tmp_path):
    """③ 无 product_ref -> 纯文本路径,不构造 image_url。"""
    out = script_mod.generate_script("城市夜跑")
    assert out == "桩文案"
    content = _content_of(_FakeLLM.last_invoke)
    # 纯文本路径 invoke 收到的是 str prompt
    assert isinstance(content, str)
    assert not _has_image_url(content)


# ──────────────────────────────────────────────────────────────
# P1: ffmpeg 抽帧 timeout — 损坏/超长视频不挂死请求线程
# ──────────────────────────────────────────────────────────────


def test_video_frames_timeout(monkeypatch, tmp_path):
    """ffmpeg 抽帧超时 -> _video_frames_data_urls 返 [] 不抛(回退纯文本)。"""
    import subprocess

    def _raise_timeout(cmd, **kw):  # noqa: ANN001
        # 断言确实传了 timeout(防止回归删掉 timeout 参数)
        assert kw.get("timeout"), "subprocess.run 必须带 timeout 兜底"
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=kw.get("timeout"))

    monkeypatch.setattr(subprocess, "run", _raise_timeout)

    fid = "1700000000-broken.mp4"
    (tmp_path / fid).write_bytes(b"corrupt")
    urls = script_mod._video_frames_data_urls(str(tmp_path / fid))
    assert urls == []


def test_video_timeout_falls_back_to_text(monkeypatch, tmp_path):
    """端到端:视频抽帧超时 -> generate_script 回退纯文本路径。"""
    import subprocess

    def _raise_timeout(cmd, **kw):  # noqa: ANN001
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=kw.get("timeout", 60))

    monkeypatch.setattr(subprocess, "run", _raise_timeout)

    fid = "1700000000-broken2.mp4"
    (tmp_path / fid).write_bytes(b"corrupt")
    out = script_mod.generate_script("商品介绍", product_ref=f"product:{fid}")
    assert out == "桩文案"
    content = _content_of(_FakeLLM.last_invoke)
    assert isinstance(content, str)
    assert not _has_image_url(content)


# ──────────────────────────────────────────────────────────────
# P2: 多模态 VLM 能力校验 — 本地索引判定非视觉模型 -> 明确报错
# ──────────────────────────────────────────────────────────────


def test_multimodal_rejects_non_vl_model(tmp_path, monkeypatch):
    """本地索引把所选模型判成 chat(纯文本) + 挂图 -> 抛 VlmCapabilityError。"""

    class _FakeEntry:
        capability = "chat"

    class _FakeIndex:
        def get(self, model_id):  # noqa: ANN001
            return _FakeEntry()

    import chayuan.server.model_registry.local_index as li_mod
    monkeypatch.setattr(li_mod, "LocalModelIndex", _FakeIndex)

    fid = "1700000000-prod.png"
    (tmp_path / fid).write_bytes(b"\x89PNG\r\n\x1a\nfake")

    with pytest.raises(script_mod.VlmCapabilityError):
        script_mod.generate_script(
            "连衣裙", product_ref=f"product:{fid}", model="some-text-only-llm"
        )


def test_multimodal_allows_vl_model(tmp_path, monkeypatch):
    """本地索引判成 image-to-text(VL) -> 不拦截,正常构造 image_url。"""

    class _FakeEntry:
        capability = "image-to-text"

    class _FakeIndex:
        def get(self, model_id):  # noqa: ANN001
            return _FakeEntry()

    import chayuan.server.model_registry.local_index as li_mod
    monkeypatch.setattr(li_mod, "LocalModelIndex", _FakeIndex)

    fid = "1700000000-prod2.png"
    (tmp_path / fid).write_bytes(b"\x89PNG\r\n\x1a\nfake")
    out = script_mod.generate_script(
        "连衣裙", product_ref=f"product:{fid}", model="qwen2-vl-local"
    )
    assert out == "桩文案"
    content = _content_of(_FakeLLM.last_invoke)
    assert _has_image_url(content)


def test_multimodal_unknown_model_not_blocked(tmp_path, monkeypatch):
    """模型不在本地索引(远程 API 模型) -> 不前置拦截,照常 invoke。"""

    class _FakeIndex:
        def get(self, model_id):  # noqa: ANN001
            return None

    import chayuan.server.model_registry.local_index as li_mod
    monkeypatch.setattr(li_mod, "LocalModelIndex", _FakeIndex)

    fid = "1700000000-prod3.png"
    (tmp_path / fid).write_bytes(b"\x89PNG\r\n\x1a\nfake")
    out = script_mod.generate_script(
        "连衣裙", product_ref=f"product:{fid}", model="claude-vision-remote"
    )
    assert out == "桩文案"
    content = _content_of(_FakeLLM.last_invoke)
    assert _has_image_url(content)
