import textwrap
from pathlib import Path
from chayuan_packaging.manifest import load_layout
from chayuan_packaging.installer_manifest import build_installer_manifest, resolve_asset_url

_LAYOUT = textwrap.dedent('''
runtimes:
  - name: python312
    dest: vendor/runtimes/python
    source: https://example.com/py-{platform_tag}.{ext}
    matrix:
      linux-x86_64: { platform_tag: linux-x64, ext: tar.gz }
      win-x86_64:   { platform_tag: win-x64,   ext: zip }
models:
  - name: qwen
    dest: models/chat/qwen
    source: hf-mirror://org/qwen
    repo: org/qwen
    file: qwen.gguf
    unpack: none
    release: [lite, standard, pro]
    matrix:
      linux-x86_64: org/qwen
      mac-arm64: org/qwen
releases:
  lite:     { models: [qwen] }
  standard: { runtimes: [python312], models: [qwen] }
  pro:      { runtimes: [python312], models: [qwen] }
''')


def _layout(tmp_path: Path):
    p = tmp_path / "layout.yaml"
    p.write_text(_LAYOUT, encoding="utf-8")
    return load_layout(p)


def test_resolve_asset_url_http_interpolates(tmp_path):
    layout = _layout(tmp_path)
    py = layout.get("python312")
    url = resolve_asset_url(py, "linux-x86_64")
    assert url == "https://example.com/py-linux-x64.tar.gz"


def test_resolve_asset_url_hf_mirror_model(tmp_path):
    layout = _layout(tmp_path)
    qwen = layout.get("qwen")
    url = resolve_asset_url(qwen, "linux-x86_64")
    # hf-mirror://org/qwen + file qwen.gguf → hf-mirror 下载直链
    assert "hf-mirror.com" in url and "org/qwen" in url and "qwen.gguf" in url


def test_build_manifest_shape_and_tiers(tmp_path):
    layout = _layout(tmp_path)
    man = build_installer_manifest(layout, version="3.0.0")
    assert man["version"] == "3.0.0"
    comp = {c["name"]: c for c in man["components"]}
    # qwen 三档都含
    assert comp["qwen"]["tiers"] == ["lite", "standard", "pro"]
    # 仅 matrix 有的平台进 platforms
    assert set(comp["qwen"]["platforms"].keys()) == {"linux-x86_64", "mac-arm64"}
    assert comp["qwen"]["platforms"]["linux-x86_64"]["unpack"] == "none"
    # python312 无 release_tags → 不带 tiers(归到所有引用它的 release)
    assert "python312" in comp
    assert set(comp["python312"]["platforms"].keys()) == {"linux-x86_64", "win-x86_64"}
