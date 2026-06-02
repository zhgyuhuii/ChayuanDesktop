# 数字人引擎纳入 bundled_models 自包含 + 模型脚本交互式多选 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 full 安装包自包含 Wav2Lip + SadTalker 数字人权重(零下载),并给 `install-bundled-models.py` 加控制台交互式多选。

**Architecture:** 单 `digital_human` cap,下挂 `wav2lip/` + `sadtalker/` 两个子目录,在 4 处 cap 白名单注册一次;SadTalker 运行时从本地 bundled 目录加载(modelscope `pipeline(model=<本地>)`),未 seed 回退联网;模型脚本用纯 stdlib 跨平台 TUI 选择,非 TTY 沿用 flag。

**Tech Stack:** Python(打包脚本 + FastAPI sidecar)、pytest、modelscope、PyInstaller、Tauri。

**环境前提(执行者必读):**
- 本仓 `/work/chayuan-desktop` 为 **root 所有**,普通用户写文件/`git add`/`commit` 需 `sudo`(见 memory `commit-procedure-chayuan-desktop`)。编辑工具失败报 EACCES 时,改用 `sudo`。
- 测试:`PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q <file>`。本机可用 root conda py312(`/root/miniconda3/envs/py312/bin/python`);若环境缺失先重建。
- 固定分支 `main → origin/main`;**仅在用户明确要求时** commit/push(计划内的 commit 步骤照写,执行时遵守该门禁)。
- 标 `[GPU-VERIFY]` / `[BUILD-VERIFY]` 的项沙箱无法验,需用户机器实测。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `chayuan-server/packaging/bundle_manifest.py` | LITE/FULL caps + canonical 子目录真源 | 改 |
| `chayuan-server/packaging/pyinstaller/build.py` | `_KNOWN_CAP_DIRS` vendor cap 白名单 | 改 |
| `chayuan-server/libs/chayuan-server/chayuan/server/model_registry/local_index.py` | 运行时 `BUNDLED_CAPABILITY_DIRS` | 改 |
| `chayuan-server/libs/.../video_generation/digital_human/engine.py` | Wav2Lip 权重目录解析 | 改 |
| `chayuan-server/libs/.../modality/sadtalker_server.py` | SadTalker 运行时本地加载 | 改 |
| `scripts/install-bundled-models.py` | 模型下载器:多模型 cap + 交互式多选 | 改 |
| `chayuan-server/libs/.../tests/unit_tests/test_digital_human_bundled.py` | 本特性单测 | 建 |
| `README.md` / `chayuan-server/vendor/bundled_models/README.md` | 文档 | 改 |

---

## Task 1: 注册 `digital_human` cap(4 处白名单)

**Files:**
- Modify: `chayuan-server/packaging/bundle_manifest.py:41-44`(FULL_CAPS)、`:64-74`(CANONICAL)
- Modify: `chayuan-server/packaging/pyinstaller/build.py:318-320`(_KNOWN_CAP_DIRS)
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/model_registry/local_index.py:108`(BUNDLED_CAPABILITY_DIRS)
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_bundled.py`

- [ ] **Step 1: 写失败测试**

新建 `test_digital_human_bundled.py`:

```python
import os, re, importlib.util


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m


_HERE = os.path.dirname(__file__)
_PKG = os.path.join(_HERE, "../../../../packaging")


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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_bundled.py -k "full_not_lite or capability_dirs or known_cap" -v`
Expected: 3 个测试 FAIL(digital_human 尚未加入)

- [ ] **Step 3: 改 bundle_manifest.py**

`FULL_CAPS`(41-44 行)改为:

```python
FULL_CAPS: tuple[str, ...] = LITE_CAPS + (
    "chat",
    "image",          # 图像嵌入(image-embedding 的短名,跟 install-bundled-models MANIFEST 一致)
    "digital_human",  # 数字人引擎权重(Wav2Lip CPU + SadTalker GPU);只进 full,LITE 不打 torch
)
```

`CANONICAL_MODEL_SUBDIRS`(64-74 行 dict)末尾加一项:

```python
    "image":     ("clip-vit-base-patch32",),
    # 数字人:一个 cap 两个引擎子目录共存(wav2lip CPU / sadtalker GPU)
    "digital_human": ("wav2lip", "sadtalker"),
}
```

- [ ] **Step 4: 改 build.py `_KNOWN_CAP_DIRS`(318-320 行)**

```python
_KNOWN_CAP_DIRS = frozenset(
    ("chat", "embedding", "rerank", "asr", "tts", "ocr", "image", "custom", "digital_human")
)
```

- [ ] **Step 5: 改 local_index.py `BUNDLED_CAPABILITY_DIRS`(108 行)**

```python
BUNDLED_CAPABILITY_DIRS = ("chat", "embedding", "rerank", "asr", "tts", "ocr", "image", "custom", "digital_human")
```

- [ ] **Step 6: 跑测试确认通过**

Run: 同 Step 2
Expected: 3 个全部 PASS

- [ ] **Step 7: commit(遵守用户提交门禁)**

```bash
cd /work/chayuan-desktop
sudo git add chayuan-server/packaging/bundle_manifest.py chayuan-server/packaging/pyinstaller/build.py \
  chayuan-server/libs/chayuan-server/chayuan/server/model_registry/local_index.py \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_bundled.py
sudo git commit -m "feat(dh): 注册 digital_human cap 到 4 处 bundled 白名单"
```

---

## Task 2: engine.py Wav2Lip 解析兼容 `wav2lip/` 子目录

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/engine.py:25-43`
- Test: `test_digital_human_bundled.py`(追加)

- [ ] **Step 1: 追加失败测试**

```python
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_bundled.py -k pick_weights -v`
Expected: FAIL with "module 'engine' has no attribute '_pick_weights_dir'"

- [ ] **Step 3: 重构 `_resolve_wav2lip_dir`,抽出 `_pick_weights_dir`**

把 `engine.py:25-43` 替换为:

```python
def _pick_weights_dir(bases) -> Optional[str]:
    """在每个 base 及其 ``wav2lip/`` 子目录里找 wav2lip_gan.pth,返回首个命中目录。
    兼容两种布局:旧平铺 ``digital_human/`` 与新 ``digital_human/wav2lip/``。"""
    for base in bases:
        for cand in (Path(base), Path(base) / "wav2lip"):
            if (cand / "wav2lip_gan.pth").is_file():
                return str(cand)
    return None


def _resolve_wav2lip_dir() -> Optional[str]:
    """含 wav2lip_gan.pth + s3fd 的本地权重目录。
    顺序:CHAYUAN_ROOT/models/bundled/digital_human → vendor/bundled_models/digital_human。
    每个根都同时探平铺与 wav2lip/ 子目录。
    """
    bases = []
    try:
        from chayuan.settings import CHAYUAN_ROOT
        bases.append(Path(CHAYUAN_ROOT) / "models" / "bundled" / "digital_human")
    except Exception:  # noqa: BLE001
        pass
    here = Path(__file__).resolve()
    for parent in here.parents:
        vd = parent / "vendor" / "bundled_models" / "digital_human"
        if vd.is_dir():
            bases.append(vd); break
    return _pick_weights_dir(bases)
```

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2 + 现有 `pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_seed.py`
Expected: PASS,且不破坏现有 seed 测试

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/engine.py \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_bundled.py
sudo git commit -m "feat(dh): Wav2Lip 权重解析兼容 wav2lip/ 子目录布局"
```

---

## Task 3: sadtalker_server.py 本地加载

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/modality/sadtalker_server.py`
- Test: `test_digital_human_bundled.py`(追加)

- [ ] **Step 1: 追加失败测试**

```python
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_bundled.py -k sadtalker_dir -v`
Expected: FAIL("no attribute '_pick_sadtalker_dir'")

- [ ] **Step 3: 加本地解析 + 在 pipeline 用本地路径**

在 `sadtalker_server.py` 顶部 import 区加 `from pathlib import Path` 和 `from typing import Optional`(若未导入),并在 `_DEFAULT_CONFIG` 后加:

```python
def _pick_sadtalker_dir(bases) -> Optional[str]:
    """在每个 base 的 ``sadtalker/`` 子目录里找非空权重目录,返回首个命中。"""
    for base in bases:
        cand = Path(base) / "sadtalker"
        if cand.is_dir() and any(
            p.is_file() and p.suffix.lower() in (".pth", ".safetensors", ".bin", ".tar")
            for p in cand.rglob("*")
        ):
            return str(cand)
    return None


def _resolve_sadtalker_dir() -> Optional[str]:
    """本地 SadTalker 权重目录:CHAYUAN_ROOT/models/bundled/digital_human/sadtalker
    → vendor/bundled_models/digital_human/sadtalker。未命中返回 None(回退联网)。"""
    bases = []
    try:
        from chayuan.settings import CHAYUAN_ROOT
        bases.append(Path(CHAYUAN_ROOT) / "models" / "bundled" / "digital_human")
    except Exception:  # noqa: BLE001
        pass
    here = Path(__file__).resolve()
    for parent in here.parents:
        vd = parent / "vendor" / "bundled_models" / "digital_human"
        if vd.is_dir():
            bases.append(vd); break
    return _pick_sadtalker_dir(bases)
```

在 `_ensure_loaded()` 里把 `pipeline(...)` 调用(sadtalker_server.py:39-43)改为优先本地路径:

```python
        local_dir = _resolve_sadtalker_dir()
        model_arg = local_dir or cfg.get("model_id", "wwd123/sadtalker")
        try:
            handle = pipeline(
                task=cfg.get("task", "talking-head"),
                model=model_arg,
                model_revision=None if local_dir else cfg.get("model_revision", "v1.0.0"),
            )
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_bundled.py -k sadtalker_dir chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_sadtalker.py -v`
Expected: 新测试 PASS,现有 sadtalker 测试不回归

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/modality/sadtalker_server.py \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_bundled.py
sudo git commit -m "feat(dh): SadTalker 运行时优先从本地 bundled 目录加载"
```

> [GPU-VERIFY] `pipeline(model=<本地目录>)` 对 wwd123/sadtalker 的本地布局需 GPU 环境实测对齐;错了按 traceback 调 model_arg 指向的子层级。

---

## Task 4: install-bundled-models.py 多模型 cap + digital_human + ms revision

**Files:**
- Modify: `scripts/install-bundled-models.py`(MANIFEST、`_download_via_ms`、main 循环)
- Test: `test_digital_human_bundled.py`(追加)

- [ ] **Step 1: 追加失败测试**

```python
def test_install_script_has_digital_human_models():
    import importlib.util, os
    p = os.path.join(os.path.dirname(__file__), "../../../../../scripts/install-bundled-models.py")
    spec = importlib.util.spec_from_file_location("ibm", os.path.abspath(p))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    dh = m.MANIFEST["digital_human"]
    subs = {x["dest_subdir"]: x for x in dh["models"]}
    assert set(subs) == {"wav2lip", "sadtalker"}
    assert subs["wav2lip"]["ms"][0]["repo"] == "silveroxides/ComfyUI_wav2lip-models"
    assert subs["sadtalker"]["ms"][0]["repo"] == "wwd123/sadtalker"
    assert subs["sadtalker"]["ms"][0]["revision"] == "v1.0.0"
    units = m._enumerate_units(["digital_human"])
    labels = {u["label"] for u in units}
    assert labels == {"digital_human/wav2lip", "digital_human/sadtalker"}
```

> 注意:`install-bundled-models.py` 在 `scripts/`(仓库根),从测试目录上溯 5 层(`tests/unit_tests/` → `libs/chayuan-server` → `libs` → `chayuan-server` → 仓库根 → `scripts/`)。执行时确认相对层数,必要时调 `../`。

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_bundled.py -k digital_human_models -v`
Expected: FAIL(KeyError digital_human / 无 _enumerate_units)

- [ ] **Step 3: `_download_via_ms` 加 revision(405-411 行)**

```python
def _download_via_ms(spec: dict, dest_dir: Path) -> None:
    from modelscope import snapshot_download as ms_snapshot_download
    kwargs = dict(model_id=spec["repo"], allow_patterns=spec.get("allow_patterns"),
                  local_dir=str(dest_dir))
    if spec.get("revision"):
        kwargs["revision"] = spec["revision"]
    ms_snapshot_download(**kwargs)
```

- [ ] **Step 4: MANIFEST 末尾(282 行 `}` 前)加 digital_human**

```python
    "digital_human": {
        "approx_mb": 2500,
        "note": "数字人引擎权重(仅 full):Wav2Lip(CPU)+ SadTalker(GPU)",
        "dest_subdir": ".",   # 占位;多模型 cap 实际用 models 列表
        "hf": [], "ms": [],
        "models": [
            {
                "dest_subdir": "wav2lip",
                "approx_mb": 510,
                "note": "Wav2Lip 推理权重 wav2lip_gan.pth(~416MB)+ s3fd 人脸检测(~86MB)",
                "hf": [],
                "ms": [
                    {"repo": "silveroxides/ComfyUI_wav2lip-models",
                     "allow_patterns": ["wav2lip_gan.pth", "s3fd-619a316812.pth"]},
                ],
            },
            {
                "dest_subdir": "sadtalker",
                "approx_mb": 2000,   # [GPU-VERIFY] 实测体积后回填
                "note": "SadTalker talking-head checkpoints(wwd123/sadtalker@v1.0.0)",
                "hf": [],
                "ms": [
                    {"repo": "wwd123/sadtalker", "revision": "v1.0.0"},
                ],
            },
        ],
    },
```

- [ ] **Step 5: 加 `_enumerate_units` 并改 main 下载循环**

在 `main()` 之前加:

```python
def _enumerate_units(caps):
    """把 cap 列表展开成可下载单元。多模型 cap(有 models 键)展开成每个子模型一个单元。
    返回 [{"cap":str, "label":str, "spec":dict, "ready":bool}, ...]。"""
    units = []
    for cap in caps:
        spec = MANIFEST[cap]
        models = spec.get("models")
        if models:
            for m in models:
                units.append({"cap": cap, "label": f"{cap}/{m['dest_subdir']}", "spec": m})
        else:
            units.append({"cap": cap, "label": cap, "spec": spec})
    return units
```

把 main 里 882-903 行的下载循环改为按 unit 下载:

```python
    units = _enumerate_units(plan)
    for u in units:
        cap, spec = u["cap"], u["spec"]
        if args.clean_stale:
            canonical = _load_canonical_subdirs(cap)
            if canonical:
                pruned_total += _prune_stale_subdirs(cap, vendor_root / cap, canonical)
        try:
            _download_one(cap, spec, vendor_root=vendor_root,
                          clean=args.clean, clean_cap=args.clean_cap, source=args.source)
        except KeyboardInterrupt:
            _print("[install] 用户中断,退出。已下载的部分文件保留(下次跑会续传)。")
            return 130
        except Exception as e:  # noqa: BLE001
            failures.append((u["label"], str(e)))
        _print("")
```

(failures 元组首项由 cap 改成 u["label"],打印更精确;其余不变。)

- [ ] **Step 6: 跑测试确认通过**

Run: 同 Step 2,并 `python -m py_compile scripts/install-bundled-models.py`
Expected: PASS;py_compile 无错

- [ ] **Step 7: commit**

```bash
cd /work/chayuan-desktop
sudo git add scripts/install-bundled-models.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_bundled.py
sudo git commit -m "feat(dh): install-bundled-models 支持多模型 cap + digital_human(wav2lip+sadtalker)"
```

---

## Task 5: install-bundled-models.py 控制台交互式多选

**Files:**
- Modify: `scripts/install-bundled-models.py`(加选择器 + main 接线)
- Test: `test_digital_human_bundled.py`(追加,只测纯状态机)

- [ ] **Step 1: 追加失败测试(状态机)**

```python
def test_selector_state_machine():
    import importlib.util, os
    p = os.path.abspath(os.path.join(os.path.dirname(__file__),
        "../../../../../scripts/install-bundled-models.py"))
    spec = importlib.util.spec_from_file_location("ibm2", p)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_bundled.py -k selector_state -v`
Expected: FAIL("no attribute '_SelectState'")

- [ ] **Step 3: 加状态机 + 跨平台读键 + 渲染 + select_units**

在 `main()` 之前加:

```python
class _SelectState:
    def __init__(self, labels, preselected=None):
        self.labels = list(labels)
        self.cursor = 0
        self.selected = set(preselected or set())

    def move(self, delta):
        self.cursor = max(0, min(len(self.labels) - 1, self.cursor + delta))

    def toggle(self):
        if self.cursor in self.selected:
            self.selected.discard(self.cursor)
        else:
            self.selected.add(self.cursor)

    def select_all(self):
        if len(self.selected) == len(self.labels):
            self.selected = set()
        else:
            self.selected = set(range(len(self.labels)))


def _read_key():  # pragma: no cover — 终端原始 IO,手动验
    """返回 'up'/'down'/'space'/'enter'/'all'/'quit'/None。Unix termios / Windows msvcrt。"""
    if os.name == "nt":
        import msvcrt
        ch = msvcrt.getwch()
        if ch in ("\r", "\n"): return "enter"
        if ch == " ": return "space"
        if ch in ("\x03", "q", "Q"): return "quit"
        if ch in ("a", "A"): return "all"
        if ch == "\xe0":  # 方向键前缀
            ch2 = msvcrt.getwch()
            return {"H": "up", "P": "down"}.get(ch2)
        if ch in ("k", "K"): return "up"
        if ch in ("j", "J"): return "down"
        return None
    import termios, tty
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        ch = sys.stdin.read(1)
        if ch in ("\r", "\n"): return "enter"
        if ch == " ": return "space"
        if ch in ("\x03", "q", "Q"): return "quit"
        if ch in ("a", "A"): return "all"
        if ch in ("k", "K"): return "up"
        if ch in ("j", "J"): return "down"
        if ch == "\x1b":
            seq = sys.stdin.read(2)
            return {"[A": "up", "[B": "down"}.get(seq)
        return None
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


def _render(state, sizes, ready):  # pragma: no cover — 终端绘制,手动验
    lines = ["请选择要下载的模型(↑/↓ 移动,空格选/取消,a 全选,回车确认,q 取消):", ""]
    for i, label in enumerate(state.labels):
        box = "[x]" if i in state.selected else "[ ]"
        arrow = ">" if i == state.cursor else " "
        tag = " ✓已就绪" if ready[i] else ""
        lines.append(f" {arrow} {box} {label}  (~{sizes[i]} MB){tag}")
    sys.stdout.write("\r" + "\n".join(lines) + "\n")
    sys.stdout.flush()
    return len(lines)


def _interactive_select(units):  # pragma: no cover — 整合 IO,手动验
    labels = [u["label"] for u in units]
    sizes = [u["spec"].get("approx_mb", 0) for u in units]
    ready = [False] * len(units)  # 就绪检测在下载时由 skip-if-exists 处理
    preselected = {i for i, r in enumerate(ready) if not r}
    state = _SelectState(labels, preselected)
    n = 0
    while True:
        if n:
            sys.stdout.write(f"\x1b[{n}A")  # 光标上移 n 行重绘
        n = _render(state, sizes, ready)
        key = _read_key()
        if key == "up": state.move(-1)
        elif key == "down": state.move(1)
        elif key == "space": state.toggle()
        elif key == "all": state.select_all()
        elif key == "enter": break
        elif key == "quit": return []
    return [units[i] for i in sorted(state.selected)]
```

- [ ] **Step 4: 在 main 接线(替换 Step 4-T4 的 units 行)**

把 Task 4 Step 5 里 `units = _enumerate_units(plan)` 改为:

```python
    units = _enumerate_units(plan)
    # 交互式多选:仅当 TTY 且未显式给 --only/--lite(plan 是默认全集)时弹菜单。
    interactive = (sys.stdin.isatty() and sys.stdout.isatty()
                   and not args.only and not args.lite)
    if interactive:
        chosen = _interactive_select(units)
        if not chosen:
            _print("[install] 未选择任何模型,退出。")
            return 0
        units = chosen
```

- [ ] **Step 5: 跑测试确认通过 + 手动验**

Run: 同 Step 2 + `python -m py_compile scripts/install-bundled-models.py`
Expected: 状态机测试 PASS。
[手动验] 在真终端 `python scripts/install-bundled-models.py`,验证 ↑/↓/空格/a/回车/q;再 `echo "" | python scripts/install-bundled-models.py --lite` 验证非 TTY 不弹菜单、走 flag。

- [ ] **Step 6: commit**

```bash
cd /work/chayuan-desktop
sudo git add scripts/install-bundled-models.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_bundled.py
sudo git commit -m "feat(dh): install-bundled-models 控制台交互式多选(非TTY回退flag)"
```

---

## Task 6: 文档

**Files:**
- Modify: `README.md`(install-vendor 段落,989-1006 行附近)
- Modify: `chayuan-server/vendor/bundled_models/README.md`

- [ ] **Step 1: README.md install-vendor 资源表加 digital_human**

在「下三类资源到 vendor/」表(1004-1006 行)的模型行下补一句说明:

```markdown
| 模型 | `vendor/bundled_models/<cap>/` | 平台无关,一次全平台通用 |
```
下方加:
```markdown
> 数字人引擎(仅 full):`vendor/bundled_models/digital_human/wav2lip/`(CPU)+ `digital_human/sadtalker/`(GPU)。
> 直接跑 `python scripts/install-bundled-models.py`(无 flag)会进控制台多选菜单;`--lite` / `--only` / 非 TTY 时按 flag 下载。
```

- [ ] **Step 2: vendor/bundled_models/README.md 补 digital_human 布局**

加一节:

```markdown
## digital_human(数字人引擎,仅 full)

    digital_human/
      wav2lip/    { wav2lip_gan.pth, s3fd-619a316812.pth }   # CPU,engine.py 直读
      sadtalker/  { wwd123/sadtalker@v1.0.0 快照 }            # GPU,sadtalker_server 本地加载

运行时镜像:`<CHAYUAN_ROOT>/models/bundled/digital_human/{wav2lip,sadtalker}/`。
LITE 不打(无 torch);只随 full 包发。
```

- [ ] **Step 3: commit**

```bash
cd /work/chayuan-desktop
sudo git add README.md chayuan-server/vendor/bundled_models/README.md
sudo git commit -m "docs(dh): 补 digital_human bundled 布局与 install-vendor 说明"
```

---

## 收尾验证(全部任务后)

- [ ] `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_bundled.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_seed.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_sadtalker.py` 全绿
- [ ] `python -m py_compile scripts/install-bundled-models.py chayuan-server/libs/chayuan-server/chayuan/server/modality/sadtalker_server.py chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/engine.py`
- [ ] [BUILD-VERIFY] 用户机器:`bash scripts/install-vendor.sh --flavor full`(或交互选 digital_human)→ `vendor/bundled_models/digital_human/{wav2lip,sadtalker}/` 就位 → full 打包 → 装机后引擎选择器不再「未安装」、生成成功
- [ ] `git status` 确认只动了计划内文件
