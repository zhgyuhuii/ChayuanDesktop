import os, re, importlib.util


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


_HERE = os.path.dirname(__file__)
_PKG = os.path.join(_HERE, "../../../../packaging")
# install-bundled-models.py 在仓库根 scripts/(不是 chayuan-server/scripts/),需上溯 5 层
_INSTALL_SCRIPT = os.path.abspath(
    os.path.join(_HERE, "../../../../../scripts/install-bundled-models.py"))


# ---- Task 1: cap 注册 ----
def test_digital_human_in_full_not_lite():
    bm = _load(os.path.join(_PKG, "bundle_manifest.py"), "bundle_manifest")
    assert "digital_human" in bm.FULL_CAPS
    assert "digital_human" not in bm.LITE_CAPS
    assert bm.CANONICAL_MODEL_SUBDIRS["digital_human"] == ("wav2lip", "sadtalker")


def test_runtime_capability_dirs_has_digital_human():
    from chayuan.server.model_registry import local_index
    assert "digital_human" in local_index.BUNDLED_CAPABILITY_DIRS


def test_build_known_cap_dirs_has_digital_human():
    # build.py 顶层 import PyInstaller,直接 import 太重 — 源码级断言 frozenset 行
    src = open(os.path.join(_PKG, "pyinstaller/build.py"), encoding="utf-8").read()
    block = re.search(r"_KNOWN_CAP_DIRS\s*=\s*frozenset\((.*?)\)", src, re.S).group(1)
    assert "digital_human" in block


# ---- Task 2: engine Wav2Lip 解析兼容子目录 ----
def test_pick_weights_dir_finds_wav2lip_subdir(tmp_path):
    from chayuan.server.video_generation.digital_human import engine
    sub = tmp_path / "digital_human" / "wav2lip"
    sub.mkdir(parents=True)
    (sub / "wav2lip_gan.pth").write_bytes(b"x")
    got = engine._pick_weights_dir([tmp_path / "digital_human"])
    assert got == str(sub)


def test_pick_weights_dir_finds_flat_legacy(tmp_path):
    from chayuan.server.video_generation.digital_human import engine
    base = tmp_path / "digital_human"
    base.mkdir(parents=True)
    (base / "wav2lip_gan.pth").write_bytes(b"x")
    assert engine._pick_weights_dir([base]) == str(base)


# ---- Task 3: sadtalker 本地解析 ----
def test_pick_sadtalker_dir(tmp_path):
    from chayuan.server.modality import sadtalker_server as ss
    sub = tmp_path / "digital_human" / "sadtalker"
    sub.mkdir(parents=True)
    (sub / "epoch_00190_iteration_000400000.pth").write_bytes(b"x")
    assert ss._pick_sadtalker_dir([tmp_path / "digital_human"]) == str(sub)


def test_pick_sadtalker_dir_empty_returns_none(tmp_path):
    from chayuan.server.modality import sadtalker_server as ss
    (tmp_path / "digital_human" / "sadtalker").mkdir(parents=True)  # 空目录不算就绪
    assert ss._pick_sadtalker_dir([tmp_path / "digital_human"]) is None


# ---- Task 4: install-bundled-models 多模型 cap ----
def test_install_script_has_digital_human_models():
    m = _load(_INSTALL_SCRIPT, "ibm")
    dh = m.MANIFEST["digital_human"]
    subs = {x["dest_subdir"]: x for x in dh["models"]}
    assert set(subs) == {"wav2lip", "sadtalker"}
    assert subs["wav2lip"]["ms"][0]["repo"] == "silveroxides/ComfyUI_wav2lip-models"
    assert subs["sadtalker"]["ms"][0]["repo"] == "wwd123/sadtalker"
    assert subs["sadtalker"]["ms"][0]["revision"] == "v1.0.0"
    units = m._enumerate_units(["digital_human"])
    labels = {u["label"] for u in units}
    assert labels == {"digital_human/wav2lip", "digital_human/sadtalker"}


# ---- Task 5: 交互式多选状态机 ----
def test_selector_state_machine():
    m = _load(_INSTALL_SCRIPT, "ibm2")
    s = m._SelectState(["a", "b", "c"], preselected={0})
    assert s.selected == {0}
    s.move(1); s.toggle()          # 光标到 b,选中
    assert s.selected == {0, 1}
    s.toggle()                     # 取消 b
    assert s.selected == {0}
    s.select_all()                 # 还有未全选 → 全选
    assert s.selected == {0, 1, 2}
    s.select_all()                 # 已全选 → 全清
    assert s.selected == set()
    s.move(-1)                     # 在顶部上移不越界
    assert s.cursor == 0


def test_voice_string_edge_gets_prefix():
    """edge 音色必须带 edge: 前缀,否则 synthesize 先试 piper,piper 见 *Neural
    名字会替换成默认音色并返回,edge 永远走不到 → 选 edge 音色不生效。"""
    from chayuan.server.video_generation.digital_human.jobs import _voice_string
    assert _voice_string("edge", "zh-CN-YunxiNeural") == "edge:zh-CN-YunxiNeural"
    assert _voice_string("edge", "edge:zh-CN-YunxiNeural") == "edge:zh-CN-YunxiNeural"  # 幂等
    assert _voice_string("sherpa", "vits-zh-aishell3") == "sherpa:vits-zh-aishell3"
    assert _voice_string("piper", "zh_CN-huayan-medium") == "zh_CN-huayan-medium"
