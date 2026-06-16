"""Task A1/B1 单测:cap 分流常量 + bgm 数据目录路径。

可作为 pytest 测试,也可 `python3.11 此文件` 直接跑(无需 conftest / 重依赖)。
"""
import sys
import pathlib

# packaging/ 在 sys.path 上(build.py 用 importlib.import_module("bundle_manifest"))
_PKG = pathlib.Path(__file__).resolve().parents[4] / "packaging"
sys.path.insert(0, str(_PKG))

import bundle_manifest as bm  # noqa: E402

# 与 local_index.BUNDLED_CAPABILITY_DIRS 对齐的 9 个 cap(避免 import 重依赖,这里硬编码并在测试里断言对齐)
_ALL_CAPS = {"chat", "embedding", "rerank", "asr", "tts", "ocr", "image", "custom", "digital_human"}


def test_embed_external_caps_partition():
    assert bm.EMBED_CAPS == frozenset({"tts", "ocr", "asr", "custom"})
    assert bm.EXTERNAL_CAPS == frozenset({"chat", "embedding", "rerank", "image", "digital_human"})
    # 不相交
    assert bm.EMBED_CAPS.isdisjoint(bm.EXTERNAL_CAPS)
    # 并集覆盖全部 cap(与 local_index.BUNDLED_CAPABILITY_DIRS 对齐)
    assert (set(bm.EMBED_CAPS) | set(bm.EXTERNAL_CAPS)) == _ALL_CAPS


def test_external_caps_are_the_big_ones():
    # 大模型(GB 级)都在 EXTERNAL;小资产(tts/ocr/asr)都在 EMBED
    for big in ("chat", "embedding", "rerank", "digital_human"):
        assert big in bm.EXTERNAL_CAPS
    for small in ("tts", "ocr", "asr"):
        assert small in bm.EMBED_CAPS


if __name__ == "__main__":
    test_embed_external_caps_partition()
    test_external_caps_are_the_big_ones()
    print("OK: A1 tests passed")


def test_seed_bundled_bgm_injected_idempotent(tmp_path):
    """B2: seed_bundled_bgm 注入 source/target 拷贝 + 幂等(不拉 chayuan 包,按文件加载模块)。"""
    import importlib.util, pathlib
    mod = (pathlib.Path(__file__).resolve().parents[2]
           / "chayuan" / "server" / "model_registry" / "bundled_seed.py")
    spec = importlib.util.spec_from_file_location("bundled_seed_x", mod)
    bs = importlib.util.module_from_spec(spec)
    sys.modules["bundled_seed_x"] = bs
    spec.loader.exec_module(bs)

    src = tmp_path / "app_bgm"; dst = tmp_path / "data_bgm"
    src.mkdir(); (src / "output000.mp3").write_bytes(b"ID3xxxx")
    rep = bs.seed_bundled_bgm(source_dir=src, target_dir=dst)
    assert (dst / "output000.mp3").read_bytes() == b"ID3xxxx"
    assert len(rep.copied) == 1
    rep2 = bs.seed_bundled_bgm(source_dir=src, target_dir=dst)
    assert len(rep2.copied) == 0 and len(rep2.skipped) == 1
