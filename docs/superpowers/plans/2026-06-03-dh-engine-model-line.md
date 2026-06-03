# 数字人引擎接入模型线② 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 或 superpowers:executing-plans。Steps 用 checkbox。

**Goal:** 让 SadTalker/MuseTalk 完全复用既有「模型线②(bundled_models → seed → 数据目录跑)」,不新建路径;统一目录解析器;修 UI 死按钮 + 「未安装」语义。

**Architecture:** 在 `engine.py` 抽单一 `_bundled_engine_dir(subdir)` 解析器,wav2lip/sadtalker/musetalk 的目录解析 + 「已安装」判定全走它;MuseTalk 仓+权重纳入 MANIFEST(同 SadTalker);`musetalk_server` 读数据目录而非写死 `~/MuseTalk`;前端死按钮改为模型线语义。

**Tech Stack:** Python + pytest;React + TS + pnpm typecheck。

**环境前提:** 仓库 root 所有(写文件/git 走 `sudo`);后端验证 `PYTHONPATH=".../libs/chayuan-server" pytest -q`;前端 `pnpm -w typecheck`;沙箱无 node/py312 → `ast.parse` 静态校验 + 用户机器跑。后端改动需 pull+重启 sidecar。固定分支 main,**仅用户要求时** commit。

**复用事实(已探索):** 模型线② = `install-bundled-models.py`(MANIFEST,交互多选)→ `vendor/bundled_models/<cap>/` →(打包)→ `bundled_seed.seed_bundled_models()`(`first_launch.py:230` 触发)→ `<CHAYUAN_ROOT>/models/bundled/` → 运行时 `_resolve_*_dir()` 读数据目录。`digital_human` 已在 `BUNDLED_CAPABILITY_DIRS`(`local_index.py:108`),SadTalker 权重已接(commit b06b16b)。`engine._engine_installed`(`engine.py:202-216`)现为纯端口探活。

---

## File Structure

| 文件 | 动作 |
|---|---|
| `chayuan-server/.../digital_human/engine.py` | 加 `_bundled_engine_dir` 单一解析器 + 重构 wav2lip 解析 + `_engine_installed` 加模型在场判定 |
| `chayuan-server/.../modality/sadtalker_server.py` | `_resolve_sadtalker_dir` 改用 `engine._bundled_engine_dir` |
| `chayuan-server/.../modality/musetalk_server.py` | repo_dir 读 `engine._bundled_engine_dir("musetalk")`,不写死 ~/MuseTalk |
| `scripts/install-bundled-models.py` | MANIFEST digital_human 加 musetalk 子模型(**权重 repo 需先 verify**) |
| `chayuan-client/.../digital-human/GeneratePanel.tsx` | 死按钮 /marketplace 改模型线语义 |
| `chayuan-server/.../tests/unit_tests/test_digital_human_bundled.py` | 追加测试 |

---

## Task 1: engine.py 单一解析器 + 「已安装」加模型在场

**Files:** Modify `engine.py`;Test `test_digital_human_bundled.py`

- [ ] **Step 1: 追加失败测试**

```python
def test_bundled_engine_dir_and_installed(tmp_path, monkeypatch):
    from chayuan.server.video_generation.digital_human import engine
    base = tmp_path / "digital_human"
    (base / "sadtalker").mkdir(parents=True)
    (base / "sadtalker" / "x.pth").write_bytes(b"x")
    monkeypatch.setattr(engine, "_bundled_dir_bases", lambda: [base])
    assert engine._bundled_engine_dir("sadtalker") == str(base / "sadtalker")
    assert engine._bundled_engine_dir("musetalk") is None  # 空/不存在
    # 模型在场 → installed True(即使端口不通)
    monkeypatch.setattr(engine, "_port_listening", lambda *a, **k: False)
    assert engine._engine_installed("sadtalker") is True
    assert engine._engine_installed("musetalk") is False
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_bundled.py -k bundled_engine_dir -v`
Expected: FAIL(无 `_bundled_dir_bases`/`_bundled_engine_dir`)

- [ ] **Step 3: 加单一解析器 + 重构 wav2lip + 改 _engine_installed**

在 `engine.py` 的 `_pick_weights_dir` 之后、`_resolve_wav2lip_dir` 之前加:

```python
def _bundled_dir_bases():
    """数字人 bundled 根目录候选:CHAYUAN_ROOT/models/bundled/digital_human → vendor。
    wav2lip/sadtalker/musetalk 的解析与「已安装」判定共用唯一来源。"""
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
    return bases


def _bundled_engine_dir(subdir: str) -> Optional[str]:
    """某引擎在数据目录/vendor 的 bundled 子目录(非空才算就绪)。"""
    for base in _bundled_dir_bases():
        d = Path(base) / subdir
        if d.is_dir() and any(d.iterdir()):
            return str(d)
    return None
```

把 `_resolve_wav2lip_dir` 重构为复用 bases(替换其 body):

```python
def _resolve_wav2lip_dir() -> Optional[str]:
    """含 wav2lip_gan.pth + s3fd 的本地权重目录(平铺或 wav2lip/ 子目录均兼容)。"""
    return _pick_weights_dir(_bundled_dir_bases())
```

把 `_engine_installed` 里 sadtalker/musetalk 两行改为「端口在 或 模型在场即可自启」:

```python
    if engine_id == "sadtalker":
        return _port_listening(_SADTALKER_PORT) or _bundled_engine_dir("sadtalker") is not None
    if engine_id == "musetalk":
        return _port_listening(_MUSETALK_PORT) or _bundled_engine_dir("musetalk") is not None
```

- [ ] **Step 4: 跑测试 + 现有 DH 测试不回归**

Run: `PYTHONPATH="/work/chayuan-desktop/chayuan-server/libs/chayuan-server" pytest -q chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_bundled.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_sadtalker.py -v`
Expected: PASS

- [ ] **Step 5: commit**

```bash
cd /work/chayuan-desktop
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/engine.py \
  chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_bundled.py
sudo git commit -m "refactor(dh): 单一 _bundled_engine_dir 解析器 + 引擎已安装判定加模型在场"
```

---

## Task 2: sadtalker/musetalk server 复用单一解析器 + MuseTalk 读数据目录

**Files:** Modify `modality/sadtalker_server.py`、`modality/musetalk_server.py`

- [ ] **Step 1: sadtalker_server 复用 engine 解析器**

把 `sadtalker_server.py` 的 `_resolve_sadtalker_dir()`(我之前加的、含重复 base 逻辑)替换为复用:

```python
def _resolve_sadtalker_dir() -> Optional[str]:
    from chayuan.server.video_generation.digital_human.engine import _bundled_engine_dir
    return _bundled_engine_dir("sadtalker")
```
(`_pick_sadtalker_dir` 可删;若被测试引用则保留。)

- [ ] **Step 2: musetalk_server 读数据目录(不写死 ~/MuseTalk)**

`musetalk_server.py` `_DEFAULT_CONFIG` 后加:

```python
def _resolve_musetalk_repo() -> str:
    """MuseTalk 仓目录:优先 bundled(CHAYUAN_ROOT/models/bundled/digital_human/musetalk
    → vendor),未命中回退 ~/MuseTalk(老行为)。"""
    try:
        from chayuan.server.video_generation.digital_human.engine import _bundled_engine_dir
        d = _bundled_engine_dir("musetalk")
        if d:
            return d
    except Exception:  # noqa: BLE001
        pass
    return os.path.expanduser("~/MuseTalk")
```

把 `infer` 里 `repo = cfg.get("repo_dir") or os.path.expanduser("~/MuseTalk")` 改为:
```python
        repo = cfg.get("repo_dir") or _resolve_musetalk_repo()
```
并把 `_DEFAULT_CONFIG["repo_dir"]` 由 `os.path.expanduser("~/MuseTalk")` 改为 `""`(空=运行时解析,避免写死)。

- [ ] **Step 3: ast 校验 + 现有 sadtalker/musetalk 测试**

Run: `python -m py_compile .../sadtalker_server.py .../musetalk_server.py` 或 `ast.parse`;`pytest -q .../test_digital_human_sadtalker.py .../test_digital_human_musetalk.py`
Expected: 通过(若 test 引用了 `_pick_sadtalker_dir`,Step 1 保留之)

- [ ] **Step 4: commit**

```bash
sudo git add chayuan-server/libs/chayuan-server/chayuan/server/modality/sadtalker_server.py \
  chayuan-server/libs/chayuan-server/chayuan/server/modality/musetalk_server.py
sudo git commit -m "refactor(dh): sadtalker/musetalk server 复用 _bundled_engine_dir,MuseTalk 读数据目录"
```

---

## Task 3: GeneratePanel 死按钮改模型线语义

**Files:** Modify `chayuan-client/.../digital-human/GeneratePanel.tsx:535-543`

- [ ] **Step 1: 改文案 + 去死链**

把 `:535-543` 的「未安装」块(`navigate({to:'/marketplace'})`「去模型厂商配置」)改为模型线语义提示,去掉死链:

```tsx
        {!engineInstalled && (
          <div className="mt-1 text-sm text-[var(--cy-text-secondary)]">
            该 GPU 引擎随完整版自带、装好即用;若显示未就绪,请运行
            <code className="mx-1 rounded bg-[var(--cy-surface-2)] px-1 text-xs">python scripts/install-bundled-models.py</code>
            勾选「数字人」安装后重启。
          </div>
        )}
```
(若该块的 `navigate`/import 仅此处用,顺手清理未用 import,以过 typecheck。)

- [ ] **Step 2: typecheck**

Run: `cd /work/chayuan-desktop/chayuan-client && pnpm -w typecheck`
Expected: PASS

- [ ] **Step 3: commit**

```bash
sudo git add chayuan-client/packages/app/src/features/digital-human/GeneratePanel.tsx
sudo git commit -m "fix(dh): 引擎未安装提示改模型线语义,去掉死链 /marketplace"
```

---

## Task 4: MuseTalk 仓+权重纳入 MANIFEST(模型线②)

> ⚠️ **前置研究(必须先做,不可硬编码)**:MuseTalk = GitHub 代码仓(`TMElyralab/MuseTalk`)+ 多个权重(SD-VAE / whisper / dwpose / GFPGAN / musetalk ckpt,原 `download_weights` 从 HF 拉)。`install-bundled-models.py` 走 HF/MS snapshot,**只能下模型仓,不能 git clone 代码仓**。
>
> 因此本 Task 第一步是 **research + verify**(遵循「模型下载链接写前必须实测」纪律):
> 1. 在 **ModelScope** 找:① MuseTalk 推理代码的可下载形态(是否有 MS 模型仓含完整代码,或需把代码随仓 vendor 进 `vendor/bundled_models/digital_human/musetalk/`);② 各权重的 MS repo id。逐个 `snapshot_download` 实测可达 + 文件头。
> 2. 确认 MuseTalk 仓**期望的目录布局**(models/ 下各权重子目录名),让 bundled 落地后 `scripts.inference` 能直接跑(`musetalk_server` 的 `repo_dir` 指过去即可)。

- [ ] **Step 1: 研究并实测 MuseTalk 代码+权重的 ModelScope 来源**(产出:repo id 清单 + 落地布局),记录到本 Task。无法在沙箱实测时,交用户国内环境验证后回填。

- [ ] **Step 2: MANIFEST 加 musetalk 子模型**

在 `install-bundled-models.py` MANIFEST 的 `digital_human.models` 列表里,`sadtalker` 之后追加(repo/allow_patterns **用 Step 1 实测结果**):

```python
            {
                "dest_subdir": "musetalk",
                "approx_mb": 0,   # Step 1 实测后回填
                "note": "MuseTalk 高清口型:代码 + 权重(SD-VAE/whisper/dwpose/GFPGAN/musetalk)",
                "hf": [],
                "ms": [
                    # {"repo": "<Step1 实测>", "allow_patterns": [...]},
                ],
            },
```

- [ ] **Step 3: bundle_manifest CANONICAL 加 musetalk 子目录**

`bundle_manifest.py` `CANONICAL_MODEL_SUBDIRS["digital_human"]` 由 `("wav2lip","sadtalker")` 改为 `("wav2lip","sadtalker","musetalk")`。

- [ ] **Step 4: 验证**

Run: `python -m py_compile scripts/install-bundled-models.py`;`pytest -q .../test_digital_human_bundled.py`;`[VERIFY]` 用户国内环境 `python scripts/install-bundled-models.py --only digital_human` 真下 musetalk + GPU 实测跑通。

- [ ] **Step 5: commit**

```bash
sudo git add scripts/install-bundled-models.py chayuan-server/packaging/bundle_manifest.py
sudo git commit -m "feat(dh): MuseTalk 仓+权重纳入 bundled_models(模型线②自包含)"
```

---

## 收尾验证

- [ ] `pytest -q .../test_digital_human_bundled.py .../test_digital_human_sadtalker.py .../test_digital_human_musetalk.py` 全绿
- [ ] `pnpm -w typecheck` 全绿
- [ ] `[GPU-VERIFY]` 用户机器:full 自带 → SadTalker/MuseTalk 引擎选择不再「未安装」、生成自动起 sidecar 跑通;lite 跑 install-bundled-models 选数字人 → seed → 可用
- [ ] `git status` 只动计划内文件
