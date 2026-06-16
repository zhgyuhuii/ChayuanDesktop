# 可携带数据目录 + 外置 seed + 小资产随包 + 系统字体 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 GB 级模型只经外置 seed 介质落到数据目录一份(消除双份),小资产随每个安装包,数据目录成为可整目录迁移的跨平台真源,字体改用系统字体。

**Architecture:** 按 cap 把 `bundled_models` 分成「随包嵌入(tts/ocr/asr/custom)」与「外置 seed(chat/embedding/rerank/image/digital_human)」两类;bgm 随包;字体删除改系统字体枚举。运行时跨平台数据统一从 `CHAYUAN_ROOT` 读,平台二进制留安装包就地用。首启动按 manifest 把缺的资产从 app 资源或外置介质 seed 进数据目录;数据目录已齐则全 skip(迁移免介质)。

**Tech Stack:** Python 3.12 / FastAPI / pytest(chayuan-server),PyInstaller + Tauri 2 打包,Node `release.mjs`,React + TypeScript(chayuan-client)。

测试环境(本机可跑,见记忆 reference_py312_test_env):
```bash
PYTHONPATH=/work/chayuan-desktop/chayuan-server/libs/chayuan-server  # 跑 server 单测
```

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `chayuan-server/packaging/bundle_manifest.py` | cap 清单真源,新增 `EMBED_CAPS`/`EXTERNAL_CAPS` | 修改 |
| `chayuan-server/packaging/pyinstaller/build.py` | 按 cap 分流嵌入/外置;删 fonts 同步 | 修改 |
| `chayuan-server/libs/chayuan-server/chayuan/server/model_registry/bundled_seed.py` | seed:小资产从 app 资源、大模型从介质 → 数据目录 | 修改 |
| `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/_helpers.py` | bgm 根只从 `CHAYUAN_ROOT` | 修改 |
| `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/resources/bgm_index.py` | bgm 索引只读数据目录 | 修改 |
| `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/system_fonts.py` | 枚举系统字体(新) | 创建 |
| `chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py` | 暴露 `GET .../system-fonts` | 修改 |
| `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/overlay.py` | 字幕用选中系统字体 | 修改 |
| `chayuan-client/apps/desktop/src-tauri/tauri.conf.json` | resources 去掉 `bundled_fonts` | 修改 |
| `chayuan-client/packages/app/src/features/video-generation/VgSubtitlePopover.tsx` | 字体下拉改系统字体 | 修改 |
| `chayuan-desktop/release.mjs` | 产物区分瘦包 / models_seed 介质 | 修改 |
| 测试 | `chayuan-server/tests/unit_tests/test_bundled_seed_split.py`、`test_system_fonts.py` | 创建 |

---

## Phase A — cap 清单与打包分流

### Task A1: 定义 EMBED_CAPS / EXTERNAL_CAPS

**Files:**
- Modify: `chayuan-server/packaging/bundle_manifest.py`
- Test: `chayuan-server/tests/unit_tests/test_bundled_seed_split.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit_tests/test_bundled_seed_split.py
from chayuan.packaging import bundle_manifest as bm  # noqa

def test_embed_external_caps_partition():
    # 小资产随包,大模型外置;两集合不相交且并集覆盖全部 cap
    assert bm.EMBED_CAPS == frozenset({"tts", "ocr", "asr", "custom"})
    assert bm.EXTERNAL_CAPS == frozenset({"chat", "embedding", "rerank", "image", "digital_human"})
    assert bm.EMBED_CAPS.isdisjoint(bm.EXTERNAL_CAPS)
    from chayuan.server.model_registry.local_index import BUNDLED_CAPABILITY_DIRS
    assert (bm.EMBED_CAPS | bm.EXTERNAL_CAPS) == set(BUNDLED_CAPABILITY_DIRS)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH=/work/chayuan-desktop/chayuan-server/libs/chayuan-server:/work/chayuan-desktop/chayuan-server/packaging pytest chayuan-server/tests/unit_tests/test_bundled_seed_split.py::test_embed_external_caps_partition -v`
Expected: FAIL（`AttributeError: module ... has no attribute 'EMBED_CAPS'`)

- [ ] **Step 3: 实现**

在 `bundle_manifest.py` 末尾加(若 `digital_human` 不在 BUNDLED_CAPABILITY_DIRS 同步更新该常量):

```python
# 随每个安装包嵌入(小、跨平台、开箱即用);其余 cap 走外置 seed 介质。
EMBED_CAPS = frozenset({"tts", "ocr", "asr", "custom"})
EXTERNAL_CAPS = frozenset({"chat", "embedding", "rerank", "image", "digital_human"})
```

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2。Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /work/chayuan-desktop
sudo -n git add chayuan-server/packaging/bundle_manifest.py chayuan-server/tests/unit_tests/test_bundled_seed_split.py
sudo -n git commit -m "feat(pack): 定义 EMBED_CAPS/EXTERNAL_CAPS 划分随包嵌入与外置 seed"
```

### Task A2: build.py 按 cap 分流(全平台)

**Files:**
- Modify: `chayuan-server/packaging/pyinstaller/build.py`(`sync_bundled_models` 565-712 区间;`do_external_split` 判定 566)

- [ ] **Step 1: 改 external-split 判定为「按 cap」而非「整树/仅 Windows full」**

把现有 `do_external_split` 的「整个 bundled_models 走 external」改为:遍历 cap,`cap in EXTERNAL_CAPS` 的子树进 `EXTERNAL_SEED_DIR`,`cap in EMBED_CAPS` 的子树进 `DESKTOP_BUNDLED_MODELS_DIR`(Tauri resources)。所有平台一致,不再只 Windows full。引入:

```python
from chayuan.packaging.bundle_manifest import EMBED_CAPS, EXTERNAL_CAPS
```

逐 cap 写入:嵌入类 `shutil.copy2` 到 `DESKTOP_BUNDLED_MODELS_DIR/<cap>/...`;外置类拷到 `EXTERNAL_SEED_DIR/<cap>/...` 并登记进 manifest(沿用 `EXTERNAL_SEED_MANIFEST_NAME` 现有写法)。空 cap 留 `.gitkeep`。

- [ ] **Step 2: 改完用「构建产物 grep」验证(无纯单测,属集成)**

Run(macOS 构建机):`poetry run python chayuan-server/packaging/pyinstaller/build.py --standard --sync-bundled-only` 后:
```bash
ls chayuan-client/apps/desktop/src-tauri/bundled_models/   # 只应有 tts/ocr/asr/custom
ls chayuan-server/dist/models_seed/                        # 应有 chat/embedding/rerank/image/digital_human + .external_seed_manifest.json
```
Expected:小 cap 在 resources、大 cap 在 models_seed。

- [ ] **Step 3: 提交**

```bash
sudo -n git add chayuan-server/packaging/pyinstaller/build.py
sudo -n git commit -m "feat(pack): bundled_models 按 cap 分流(EMBED 进 resources / EXTERNAL 进 models_seed,全平台)"
```

### Task A3: build.py 删除 fonts 同步,bgm 保留随包

**Files:**
- Modify: `chayuan-server/packaging/pyinstaller/build.py`(`sync_video_generation_assets` 801-830)

- [ ] **Step 1: 删 fonts 同步项,保留 bgm/imagemagick**

把 `items` 列表里 `(ROOT/"vendor"/"bundled_fonts", DESKTOP_BUNDLED_FONTS_DIR)` 一项删除;保留 `bundled_bgm`、`bundled_video_clips`;imagemagick 段不变。同时删除 `DESKTOP_BUNDLED_FONTS_DIR` 常量(100 行)及其唯一引用。

- [ ] **Step 2: 验证**

Run: `cd /work/chayuan-desktop && python -c "import ast,io; ast.parse(io.open('chayuan-server/packaging/pyinstaller/build.py').read())" && echo OK`
Expected: `OK`(语法通过;`grep -n bundled_fonts chayuan-server/packaging/pyinstaller/build.py` 应只剩注释/无引用)

- [ ] **Step 3: 提交**

```bash
sudo -n git add chayuan-server/packaging/pyinstaller/build.py
sudo -n git commit -m "feat(pack): 移除 bundled_fonts 同步(改系统字体),bgm 维持随包"
```

### Task A4: tauri.conf 去掉 bundled_fonts;release.mjs 产物区分

**Files:**
- Modify: `chayuan-client/apps/desktop/src-tauri/tauri.conf.json`(resources 数组 43-50)
- Modify: `chayuan-desktop/release.mjs`(产物收集与提示)

- [ ] **Step 1: tauri.conf resources 删 `"bundled_fonts/**/*"`**

保留 `bundled_models/**/*`(现在只含小 cap)、`bundled_bgm/**/*`、`services/**/*`、`tools/**/*`、`bundled_video_clips/**/*`、`chayuan-server/**/*`。

- [ ] **Step 2: release.mjs 收集 models_seed 介质**

在客户端/离线产物收集后,把 `chayuan-server/dist/models_seed/`(若非空)按平台打成介质:macOS 复用 `scripts/make-mac-dmg.sh` 产 `models_seed.dmg`;Windows 复用现有 ISO;Linux 打 `models_seed.zip`。收进 `release/<ver>/seed/` 并在结尾 summary 标注「lite/standard 无 seed;pro 含 models_seed」。

- [ ] **Step 3: 验证(集成)**

Run(构建机):`node release.mjs --tier pro` 后 `ls release/*/seed/`。Expected:含 models_seed 介质。lite/standard `--tier lite` 时该目录为空。

- [ ] **Step 4: 提交**

```bash
sudo -n git add chayuan-client/apps/desktop/src-tauri/tauri.conf.json release.mjs
sudo -n git commit -m "feat(pack): tauri resources 去 fonts;release.mjs 产出 models_seed 介质(pro)"
```

---

## Phase B — 运行时:数据目录为跨平台数据真源

### Task B1: bgm 根只从 CHAYUAN_ROOT

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/_helpers.py`(bgm 根 ~203-210)
- Modify: `.../video_generation/resources/bgm_index.py`
- Test: `chayuan-server/tests/unit_tests/test_bundled_seed_split.py`(追加)

- [ ] **Step 1: 写失败测试**

```python
def test_bgm_dir_under_chayuan_root(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAYUAN_ROOT", str(tmp_path))
    from importlib import reload
    from chayuan.server.video_generation import _helpers
    reload(_helpers)
    assert _helpers.bgm_dir() == tmp_path / "video_generation" / "bgm"
```
（若现有函数名不是 `bgm_dir`,按 `_helpers.py:203` 实际名替换。）

- [ ] **Step 2: 跑测试确认失败/或确认现状** — `pytest ... -v`

- [ ] **Step 3: 实现** — 确保 bgm 根固定 `CHAYUAN_ROOT/video_generation/bgm`,`bgm_index` 不再 union app vendor 的 bgm(只列数据目录 + 用户上传)。

- [ ] **Step 4: 跑测试通过**

- [ ] **Step 5: 提交**
```bash
sudo -n git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/_helpers.py chayuan-server/libs/chayuan-server/chayuan/server/video_generation/resources/bgm_index.py chayuan-server/tests/unit_tests/test_bundled_seed_split.py
sudo -n git commit -m "feat(vg): bgm 只从 CHAYUAN_ROOT 读(数据目录自包含)"
```

### Task B2: seed 小资产(含 bgm)从 app 资源 → 数据目录

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/model_registry/bundled_seed.py`(`seed_bundled_models` 293;`_copy_tree` 84)
- Test: `chayuan-server/tests/unit_tests/test_bundled_seed_split.py`(追加)

- [ ] **Step 1: 写失败测试**(构造假 app 资源 + 空数据目录,seed 后小 cap 与 bgm 落到数据目录)

```python
def test_seed_copies_embed_caps_and_bgm(tmp_path, monkeypatch):
    root = tmp_path / "data"; src = tmp_path / "app"
    (src / "bundled_models" / "tts").mkdir(parents=True)
    (src / "bundled_models" / "tts" / "v.onnx").write_bytes(b"x")
    (src / "bundled_bgm").mkdir(parents=True)
    (src / "bundled_bgm" / "a.mp3").write_bytes(b"y")
    monkeypatch.setenv("CHAYUAN_ROOT", str(root))
    from chayuan.server.model_registry import bundled_seed as bs
    rep = bs.seed_all_bundled(app_resources=src)  # 新增统一入口
    assert (root / "models" / "bundled" / "tts" / "v.onnx").exists()
    assert (root / "video_generation" / "bgm" / "a.mp3").exists()
```

- [ ] **Step 2: 跑确认失败**(`seed_all_bundled` 未定义)

- [ ] **Step 3: 实现** — 新增 `seed_all_bundled(app_resources)`:复用 `_copy_tree` 把 `app_resources/bundled_models/<cap>` 拷到 `<ROOT>/models/bundled/<cap>`、`app_resources/bundled_bgm` 拷到 `<ROOT>/video_generation/bgm`;逐文件 skip(已存在跳过)。

- [ ] **Step 4: 跑确认通过**

- [ ] **Step 5: 提交**
```bash
sudo -n git add chayuan-server/libs/chayuan-server/chayuan/server/model_registry/bundled_seed.py chayuan-server/tests/unit_tests/test_bundled_seed_split.py
sudo -n git commit -m "feat(seed): 小资产+bgm 首启动从 app 资源 seed 进数据目录"
```

### Task B3: 首启动调用 seed_all_bundled + 磁盘预检

**Files:**
- Modify: 首启动 hook(`chayuan/server/model_registry/first_launch.py` 或 startup 调 `seed_bundled_models` 处)

- [ ] **Step 1** 在现有首启动 seed 流程里:先 `seed_all_bundled(app_resources=<resolve_app_resources()>)`(小资产+bgm),再走现有 external-seed(大模型,从介质)。seed 前用现有 `requireFreeGB` 思路对 `CHAYUAN_ROOT` 所在盘做预检,空间不足只警告不崩。
- [ ] **Step 2** 验证(py312 集成):设临时 `CHAYUAN_ROOT` 跑启动,日志出现 `[bundled-seed]` 小资产已拷 + bgm 已拷。
- [ ] **Step 3** 提交:`sudo -n git commit -am "feat(seed): 首启动统一 seed 小资产+bgm,seed 前磁盘预检"`

---

## Phase C — 系统字体

### Task C1: 后端系统字体枚举 + 接口

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/system_fonts.py`
- Modify: `.../api_server/video_generation_routes.py`
- Test: `chayuan-server/tests/unit_tests/test_system_fonts.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit_tests/test_system_fonts.py
from chayuan.server.video_generation import system_fonts

def test_list_system_fonts_shape(tmp_path):
    f = tmp_path / "Foo.ttf"; f.write_bytes(b"\x00\x01\x00\x00")  # 假 ttf
    fonts = system_fonts.list_system_fonts(extra_dirs=[tmp_path])
    assert any(x["path"].endswith("Foo.ttf") for x in fonts)
    assert all({"family", "path"} <= set(x) for x in fonts)
```

- [ ] **Step 2: 跑确认失败**(模块不存在)

- [ ] **Step 3: 实现** `system_fonts.py`:扫 OS 字体目录(mac `/System/Library/Fonts`,`/Library/Fonts`,`~/Library/Fonts`;win `C:\Windows\Fonts`;linux `/usr/share/fonts`,`~/.fonts`)+ `extra_dirs`,收 `.ttf/.ttc/.otf`,按 family(文件名兜底)去重,返回 `[{"family","path"}]`。

- [ ] **Step 4: 跑确认通过**

- [ ] **Step 5: 加路由** `GET /api/v1/video-generation/system-fonts` → `{"fonts": list_system_fonts()}`(跟该文件现有路由同风格)。

- [ ] **Step 6: 提交**
```bash
sudo -n git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/system_fonts.py chayuan-server/libs/chayuan-server/chayuan/server/api_server/video_generation_routes.py chayuan-server/tests/unit_tests/test_system_fonts.py
sudo -n git commit -m "feat(vg): 系统字体枚举 + GET system-fonts 接口"
```

### Task C2: 字幕渲染用选中的系统字体

**Files:**
- Modify: `.../video_generation/digital_human/overlay.py`(字体解析链 28-49)

- [ ] **Step 1** 把字体解析链由「数据目录字体 → bundled_fonts → 系统兜底」改为「选中系统字体路径 → 系统 CJK 兜底」(去掉 bundled_fonts 分支,因已不打包)。`font_name` 为系统字体 path/family 时直接用;空则回退平台默认黑体(mac STHeiti、win msyh、linux Noto Sans CJK)。
- [ ] **Step 2** 验证(py312):构造一段字幕渲染调用,`font=None`/不存在路径时不抛 `Invalid font None`,回退成功。
- [ ] **Step 3** 提交:`sudo -n git commit -am "feat(vg): 字幕字体解析改系统字体 + 平台默认兜底"`

### Task C3: 前端字体下拉改系统字体

**Files:**
- Modify: `chayuan-client/packages/app/src/features/video-generation/VgSubtitlePopover.tsx`
- Modify(若有 API 客户端):`chayuan-client/packages/api/src/videoGeneration.ts`

- [ ] **Step 1** 加 `listSystemFonts()` API 调用(GET system-fonts);`VgSubtitlePopover` 字体下拉数据源由内置列表换成接口返回的系统字体 family;选中值存 family(渲染时后端按 family 解析 path)。
- [ ] **Step 2** 验证:`cd /work/chayuan-desktop/chayuan-client && pnpm -C packages/app typecheck`(或仓库根 `npm run typecheck`)。Expected: 通过。
- [ ] **Step 3** 提交:`sudo -n git commit -am "feat(vg-ui): 字幕字体下拉改系统字体(复用 VgSubtitlePopover)"`

---

## Phase D — 迁移与验收

### Task D1: 迁移免介质验证(已存在 skip 逻辑)

- [ ] **Step 1** py312 集成:预先把 models/bundled + video_generation/bgm 填满一个临时 `CHAYUAN_ROOT`(模拟从 A 拷来),跑首启动 → 断言 seed 全部 `skipped`、无介质需求、各 local runtime 起得来。
- [ ] **Step 2** 写成集成 smoke `chayuan-server/scripts/test-portable-migration-smoke.mjs` 或 pytest;提交。

### Task D2: 打包冒烟(构建机)

- [ ] **Step 1** macOS:`node release.mjs --tier standard` → 瘦包 `bundled_models/` 仅 tts/ocr/asr/custom、`bundled_bgm/` 在、无 `bundled_fonts`。
- [ ] **Step 2** macOS:`node release.mjs --tier pro` → 另出 `models_seed` 介质含 chat/embedding/rerank/image/digital_human + manifest。
- [ ] **Step 3** 装 standard 包 + 首启动:`find /Applications/Chayuan.app -iname 'output*.mp3' | head`(bgm 在);字幕用系统字体渲染不报 font None。

### Task D3: 文档与隐患

- [ ] **Step 1** 在 `PACKAGING.md` 记:cap 分流策略(EMBED vs EXTERNAL)、models_seed 介质、系统字体。
- [ ] **Step 2** 确认设计文档 §7 的 legacy machine.id 泄漏隐患已记录(本期不修);提交。

---

## Self-Review 记录

- **Spec 覆盖**:§3 资产分类→A1/A2;§4 打包→A2/A3/A4;§5 seed+迁移→B1/B2/B3/D1;§6 系统字体→C1/C2/C3;§7 许可证→D3(仅记录);§8 测试→各 Task + D;§9 风险(磁盘预检)→B3。无缺口。
- **占位符**:无 TBD/TODO;集成型任务(打包)用「构建+grep 产物」作为验证手段(无法纯单测属实)。
- **类型一致**:`EMBED_CAPS/EXTERNAL_CAPS`(A1)在 A2 引用一致;`seed_all_bundled`(B2)在 B3 调用一致;`list_system_fonts`(C1)在 C2/C3 一致。
- **风险**:cap 白名单须与 `local_index.BUNDLED_CAPABILITY_DIRS` 对齐(A1 测试已断言并集相等)。
