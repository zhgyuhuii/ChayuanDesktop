# 数字人 P1(MVP)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在首页加「数字人」卡片,进入独立页可管理多个数字人预设(形象+音色+名字)并用文案口播生成讲话 mp4(下载 / 进时间轴)。

**Architecture:** 后端新增解耦的 `video_generation/digital_human/` 服务层(store 预设/形象 CRUD、jobs 单 worker 任务队列+轮询状态、engine provider 抽象)+ 薄路由 `digital_human_routes.py`;引擎 P1 走 **PyTorch Wav2Lip 在 video_generation 后台线程内 in-proc 运行**(与音色克隆 VoxCPM 同范式,模型 module 级缓存只加载一次),engine 协议保留未来换 ONNX/sidecar 的插槽。前端 `features/digital-human/` 页复用 `VgSpeechSettings`(绑克隆音色)、轮询进度卡、materials ingest 进时间轴。

**Tech Stack:** Python/FastAPI/Pydantic v2 + torch(已由音色克隆引入)+ Wav2Lip + s3fd 人脸检测 + moviepy/ffmpeg;TS/React 19 + TanStack Router + Zustand;ModelScope 模型 seed;PyInstaller + Tauri resources 打包。

---

## 偏离 spec 的说明(执行前必读)

1. **引擎运行方式:in-proc 而非独立 HTTP sidecar。** spec 第 1.2 节写了
   `modality/digital_human_server.py` 独立 sidecar。P1 改为**在已有 video_generation
   后台线程内 in-proc 跑 Wav2Lip**(`engine.py` 里 module 级缓存 handle,仿
   `audio.py::_synthesize_via_voxcpm`)。理由:① 音色克隆已确立 in-proc torch 范式;
   ② 真 sidecar 需接 `install_task_manager`/`local_runtime_registry`/frozen spawn
   (`rapidocr_lifecycle` 那套),P1 不值得。`DigitalHumanEngine` 协议不变,未来要
   sidecar 时换 provider 实现即可,上层不动。

2. **进度用轮询而非 SSE。** 桌面单用户,`GET /digital-human/tasks/{id}` 1s 轮询足够,
   不复用 vg 的 SSE 基建(那条绑 `VideoParams`)。

3. **P1 不含商品图/版式/抠像**(那是 P2/P3)。P1 产物 = Wav2Lip 直接输出的口播 mp4。

4. **⚠ Wav2Lip 许可风险:** Wav2Lip 官方权重/代码声明"仅研究用途,商用需联系作者"。
   本期作为可替换 provider 接入并在 UI/文档注明;**正式商用前需法务确认或换商用许可
   模型**(provider 抽象正是为此)。执行 Task 5 时在代码注释和页面"关于"标注此约束。

---

## 文件结构(P1 落地的全部文件)

**后端(`chayuan-server/libs/chayuan-server/chayuan/server/`)**
- `video_generation/_helpers.py`(改):加 `digital_human_dir()` / `dh_avatars_dir()` / `dh_presets_path()`。
- `video_generation/digital_human/__init__.py`(建)
- `video_generation/digital_human/schemas.py`(建):`DigitalHumanPreset`、`DhGenerateRequest`、`DhTaskStatus`。
- `video_generation/digital_human/store.py`(建):预设 + 形象库 CRUD。
- `video_generation/digital_human/engine.py`(建):`DigitalHumanEngine` 协议 + `Wav2LipEngine` + `get_engine()`。
- `video_generation/digital_human/wav2lip/`(建):vendored 最小推理(`infer.py` + `face_detect.py` + `__init__.py`)。
- `video_generation/digital_human/jobs.py`(建):单 worker 队列 + 状态登记 + pipeline(tts→engine)。
- `api_server/digital_human_routes.py`(建):REST。
- `api_server/server_app.py`(改):`include_router(digital_human_router)`。
- `scripts/seed_digital_human.py`(建):ModelScope 下 Wav2Lip 权重。
- `packaging/pyinstaller/chayuan-server.spec`(改):collect wav2lip 依赖。

**前端(`chayuan-client/`)**
- `packages/transport/src/types.ts`(改):`DigitalHumanPreset` / `DhTaskStatus` 类型。
- `packages/api/src/digitalHuman.ts`(建):API 客户端。
- `packages/api/src/index.ts`(改):re-export。
- `packages/app/src/features/home/HomePage.tsx`(改):CAPS 加卡。
- `packages/app/src/router/index.tsx`(改):加 `/digital-human` route。
- `packages/app/src/features/shell/page-registry.tsx`(改):lazy 映射。
- `packages/app/src/features/digital-human/DigitalHumanPage.tsx`(建):两分区壳。
- `packages/app/src/features/digital-human/PresetList.tsx`、`PresetEditor.tsx`、`GeneratePanel.tsx`、`DhProgressCard.tsx`(建)。

**测试**
- `chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py`
- `.../tests/unit_tests/test_digital_human_jobs.py`
- `.../tests/unit_tests/test_digital_human_routes.py`
- `.../tests/unit_tests/test_digital_human_seed.py`

> 测试纪律:本机无 torch/moviepy。所有触达模型/合成的测试**注入 fake engine /
> monkeypatch tts**,断言编排与状态机,不真跑推理(仿 `tests/.../test_vg_p5a_render.py`
> 的 stub 思路)。真推理在用户 py312 环境验。

---

## Task 1: 存储路径 helper

**Files:**
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/_helpers.py`
- Test: `chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py`

- [ ] **Step 1: 写失败测试**

```python
# test_digital_human_store.py
import os
from chayuan.server.video_generation import _helpers

def test_digital_human_dirs(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    d = _helpers.digital_human_dir(create=True)
    assert os.path.isdir(d)
    assert d.endswith(os.path.join("data", "digital_human"))
    av = _helpers.dh_avatars_dir(create=True)
    assert os.path.isdir(av) and av.endswith(os.path.join("digital_human", "avatars"))
    assert _helpers.dh_presets_path().endswith("presets.json")
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py::test_digital_human_dirs -v`
Expected: FAIL `AttributeError: ... has no attribute 'digital_human_dir'`

- [ ] **Step 3: 实现**(加到 `_helpers.py`,放在 `voice_clones_dir` 之后)

```python
def digital_human_dir(*, create: bool = False) -> str:
    """数字人用户数据根 ``<CHAYUAN_ROOT>/data/digital_human``(预设 + 上传形象)。"""
    d = _chayuan_root() / "data" / "digital_human"
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return str(d)


def dh_avatars_dir(*, create: bool = False) -> str:
    """用户上传形象目录 ``.../data/digital_human/avatars``。"""
    d = _chayuan_root() / "data" / "digital_human" / "avatars"
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return str(d)


def dh_presets_path() -> str:
    """数字人预设清单 ``.../data/digital_human/presets.json``。"""
    return str(_chayuan_root() / "data" / "digital_human" / "presets.json")
```

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2。Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/_helpers.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py
git commit -m "feat(dh): 数字人存储路径 helper"
```

---

## Task 2: schemas(预设 / 生成请求 / 任务状态)

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/__init__.py`
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/schemas.py`
- Test: 复用 `test_digital_human_store.py`

- [ ] **Step 1: 写失败测试**(追加)

```python
from chayuan.server.video_generation.digital_human.schemas import (
    DigitalHumanPreset, DhGenerateRequest, DhTaskStatus,
)

def test_dh_schemas_roundtrip():
    p = DigitalHumanPreset(
        id="p1", name="主播A", avatar_ref="bundled:female1",
        avatar_kind="video", is_greenscreen=False,
        voice_provider="clone", voice_name="clone:abc", created=1.0,
    )
    assert p.model_dump()["name"] == "主播A"
    req = DhGenerateRequest(preset_id="p1", text="你好")
    assert req.template == "none" and req.matte is False
    st = DhTaskStatus(task_id="t1", state="pending", progress=0)
    assert st.state == "pending"
```

- [ ] **Step 2: 跑测试确认失败** —— Expected: FAIL `ModuleNotFoundError: ...digital_human`

- [ ] **Step 3: 实现**

`__init__.py`:空文件。

`schemas.py`:
```python
"""数字人 P1 数据契约。"""
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field

AvatarKind = Literal["image", "video"]
DhTemplate = Literal["none", "corner", "side", "bg"]  # P1 仅用 none;corner/side/bg 留 P2/P3
DhState = Literal["pending", "running", "complete", "failed", "canceled"]


class DigitalHumanPreset(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=40)
    avatar_ref: str            # "bundled:<id>" 或 "user:<file>"
    avatar_kind: AvatarKind
    is_greenscreen: bool = False
    voice_provider: Literal["piper", "edge", "sherpa", "clone"] = "piper"
    voice_name: str = ""
    created: float = 0.0


class DhGenerateRequest(BaseModel):
    preset_id: str
    text: str = Field(min_length=1, max_length=5000)
    # 以下 P1 不消费,占位以便 P2/P3 前向兼容:
    product_image: Optional[str] = None
    template: DhTemplate = "none"
    matte: bool = False


class DhTaskStatus(BaseModel):
    task_id: str
    state: DhState
    progress: int = 0
    error: str = ""
    result_path: str = ""
```

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: 提交**

```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/__init__.py chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/schemas.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py
git commit -m "feat(dh): 预设/生成请求/任务状态 schemas"
```

---

## Task 3: store —— 预设 + 形象库 CRUD

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/store.py`
- Test: `test_digital_human_store.py`(追加)

- [ ] **Step 1: 写失败测试**

```python
from chayuan.server.video_generation.digital_human import store as dh_store

def test_preset_crud(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    p = dh_store.create_preset(name="A", avatar_ref="bundled:f1",
                               avatar_kind="video", voice_provider="clone",
                               voice_name="clone:x", is_greenscreen=True)
    assert p.id and dh_store.list_presets()[0].name == "A"
    p2 = dh_store.update_preset(p.id, name="B")
    assert p2 is not None and p2.name == "B"
    assert dh_store.get_preset(p.id).name == "B"
    assert dh_store.delete_preset(p.id) is True
    assert dh_store.list_presets() == []

def test_list_avatars_bundled_and_user(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    # 用户上传一个形象
    av_dir = _helpers.dh_avatars_dir(create=True)
    open(os.path.join(av_dir, "u1.mp4"), "wb").write(b"x")
    items = dh_store.list_avatars()
    assert any(a["ref"] == "user:u1.mp4" and a["kind"] == "video" for a in items)
```

- [ ] **Step 2: 跑测试确认失败** —— Expected: FAIL `ModuleNotFoundError: ...store`

- [ ] **Step 3: 实现**

```python
"""数字人预设 + 形象库持久化(presets.json + avatars 目录扫描)。"""
from __future__ import annotations
import json, os, time, uuid
from typing import Any, Dict, List, Optional
from chayuan.server.video_generation._helpers import (
    digital_human_dir, dh_avatars_dir, dh_presets_path,
)
from chayuan.server.video_generation.digital_human.schemas import DigitalHumanPreset

_VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv"}
_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def _load_raw() -> List[Dict[str, Any]]:
    p = dh_presets_path()
    if not os.path.isfile(p):
        return []
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f) or []
    except Exception:  # noqa: BLE001
        return []


def _save_raw(rows: List[Dict[str, Any]]) -> None:
    digital_human_dir(create=True)
    with open(dh_presets_path(), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)


def list_presets() -> List[DigitalHumanPreset]:
    return [DigitalHumanPreset(**r) for r in _load_raw()]


def get_preset(pid: str) -> Optional[DigitalHumanPreset]:
    for r in _load_raw():
        if r.get("id") == pid:
            return DigitalHumanPreset(**r)
    return None


def create_preset(*, name: str, avatar_ref: str, avatar_kind: str,
                  voice_provider: str = "piper", voice_name: str = "",
                  is_greenscreen: bool = False) -> DigitalHumanPreset:
    p = DigitalHumanPreset(
        id=uuid.uuid4().hex[:12], name=name, avatar_ref=avatar_ref,
        avatar_kind=avatar_kind, is_greenscreen=is_greenscreen,
        voice_provider=voice_provider, voice_name=voice_name, created=time.time(),
    )
    rows = _load_raw(); rows.append(p.model_dump()); _save_raw(rows)
    return p


def update_preset(pid: str, **fields: Any) -> Optional[DigitalHumanPreset]:
    rows = _load_raw(); hit = None
    for r in rows:
        if r.get("id") == pid:
            r.update({k: v for k, v in fields.items() if v is not None})
            hit = r
    if hit is None:
        return None
    _save_raw(rows)
    return DigitalHumanPreset(**hit)


def delete_preset(pid: str) -> bool:
    rows = _load_raw(); new = [r for r in rows if r.get("id") != pid]
    if len(new) == len(rows):
        return False
    _save_raw(new)
    return True


def _bundled_avatars_root() -> Optional[str]:
    """vendor/bundled_assets/digital_human/avatars 或装机 models/bundled 下同名。"""
    from pathlib import Path
    here = Path(__file__).resolve()
    for parent in here.parents:
        vd = parent / "vendor" / "bundled_assets" / "digital_human" / "avatars"
        if vd.is_dir():
            return str(vd)
    return None


def _kind_of(fname: str) -> Optional[str]:
    ext = os.path.splitext(fname)[1].lower()
    if ext in _VIDEO_EXT:
        return "video"
    if ext in _IMAGE_EXT:
        return "image"
    return None


def list_avatars() -> List[Dict[str, Any]]:
    """预置 ∪ 用户上传,返 [{ref,kind,source,name}]。"""
    out: List[Dict[str, Any]] = []
    broot = _bundled_avatars_root()
    if broot:
        for f in sorted(os.listdir(broot)):
            k = _kind_of(f)
            if k:
                out.append({"ref": f"bundled:{f}", "kind": k, "source": "bundled", "name": f})
    udir = dh_avatars_dir()
    if os.path.isdir(udir):
        for f in sorted(os.listdir(udir)):
            k = _kind_of(f)
            if k:
                out.append({"ref": f"user:{f}", "kind": k, "source": "user", "name": f})
    return out


def resolve_avatar_path(avatar_ref: str) -> Optional[str]:
    """"bundled:<f>" / "user:<f>" → 绝对路径。"""
    if avatar_ref.startswith("user:"):
        p = os.path.join(dh_avatars_dir(), avatar_ref[len("user:"):])
        return p if os.path.isfile(p) else None
    if avatar_ref.startswith("bundled:"):
        broot = _bundled_avatars_root()
        if not broot:
            return None
        p = os.path.join(broot, avatar_ref[len("bundled:"):])
        return p if os.path.isfile(p) else None
    return None
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py -v`
Expected: 4 passed

- [ ] **Step 5: 提交**

```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/store.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py
git commit -m "feat(dh): 预设 CRUD + 形象库扫描 store"
```

---

## Task 4: engine —— provider 抽象 + Wav2Lip 接线壳

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/engine.py`
- Test: `test_digital_human_jobs.py`(本任务先建,放 engine 协议测试)

- [ ] **Step 1: 写失败测试**

```python
# test_digital_human_jobs.py
from chayuan.server.video_generation.digital_human import engine as dh_engine

class _FakeEngine:
    def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
        if on_progress: on_progress(50)
        open(out_path, "wb").write(b"mp4")
        return out_path

def test_engine_protocol_shape():
    e = _FakeEngine()
    seen = []
    out = e.generate(avatar_path="a", audio_path="b", out_path="/tmp/o.mp4",
                     width=720, height=1280, on_progress=seen.append)
    assert out.endswith("o.mp4") and seen == [50]

def test_get_engine_returns_wav2lip():
    e = dh_engine.get_engine()
    assert hasattr(e, "generate")
```

- [ ] **Step 2: 跑测试确认失败** —— Expected: FAIL `ModuleNotFoundError: ...engine`

- [ ] **Step 3: 实现**

```python
"""数字人引擎 provider 抽象 + Wav2Lip 实现(in-proc,模型 module 级缓存)。

未来换 ONNX / 独立 sidecar / GPU 高质量:实现同 ``DigitalHumanEngine`` 协议,
改 ``get_engine()`` 选择即可,上层 jobs/routes 不动。
"""
from __future__ import annotations
import logging, os
from pathlib import Path
from typing import Any, Callable, Optional, Protocol

logger = logging.getLogger("chayuan.dh.engine")
ProgressCb = Callable[[int], None]


class DigitalHumanEngine(Protocol):
    def generate(self, *, avatar_path: str, audio_path: str, out_path: str,
                 width: int, height: int,
                 on_progress: Optional[ProgressCb] = None) -> str: ...


def _resolve_wav2lip_dir() -> Optional[str]:
    """含 wav2lip_gan.pth + s3fd 的本地权重目录。
    顺序:CHAYUAN_ROOT/models/bundled/digital_human → vendor/bundled_models/digital_human。
    """
    roots = []
    try:
        from chayuan.settings import CHAYUAN_ROOT
        roots.append(Path(CHAYUAN_ROOT) / "models" / "bundled" / "digital_human")
    except Exception:  # noqa: BLE001
        pass
    here = Path(__file__).resolve()
    for parent in here.parents:
        vd = parent / "vendor" / "bundled_models" / "digital_human"
        if vd.is_dir():
            roots.append(vd); break
    for r in roots:
        if (Path(r) / "wav2lip_gan.pth").is_file():
            return str(r)
    return None


class Wav2LipEngine:
    """Wav2Lip in-proc。模型权重 module 级缓存(首次加载一次)。"""
    _handle: Any = None  # 缓存的 (model, face_detector)

    def generate(self, *, avatar_path: str, audio_path: str, out_path: str,
                 width: int, height: int,
                 on_progress: Optional[ProgressCb] = None) -> str:
        from chayuan.server.video_generation.digital_human.wav2lip import infer as w2l
        weights_dir = _resolve_wav2lip_dir()
        if not weights_dir:
            raise RuntimeError(
                "Wav2Lip 权重未就绪:跑 scripts/seed_digital_human.py 或确认 "
                "vendor/bundled_models/digital_human/wav2lip_gan.pth 存在"
            )
        if Wav2LipEngine._handle is None:
            Wav2LipEngine._handle = w2l.load_models(weights_dir)
        w2l.run(
            handle=Wav2LipEngine._handle, face=avatar_path, audio=audio_path,
            out_path=out_path, out_size=(width, height), on_progress=on_progress,
        )
        if not os.path.isfile(out_path):
            raise RuntimeError("Wav2Lip 未产出 mp4")
        return out_path


def get_engine() -> DigitalHumanEngine:
    return Wav2LipEngine()
```

- [ ] **Step 4: 跑测试确认通过**(`test_get_engine_returns_wav2lip` 只检查 `generate` 属性,不触发 import wav2lip,故无 torch 也过)

Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py -v`
Expected: 2 passed

- [ ] **Step 5: 提交**

```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/engine.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py
git commit -m "feat(dh): 引擎 provider 抽象 + Wav2Lip 接线壳"
```

---

## Task 5: vendored Wav2Lip 最小推理模块

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/wav2lip/__init__.py`
- Create: `.../wav2lip/infer.py`(对外:`load_models(weights_dir)`、`run(...)`)
- Create: `.../wav2lip/face_detect.py`、`.../wav2lip/models.py`

> 本任务是**移植**,不是从零写网络。从官方 Wav2Lip(及 seed 仓
> `silveroxides/ComfyUI_wav2lip-models` 配套代码)取 `Wav2Lip` 生成器结构、
> `audio.py` mel 处理、s3fd 人脸检测,裁成"加载权重 + 推理出 mp4"的最小集,
> 放到 `wav2lip/` 下并**只暴露 `load_models` / `run` 两个函数**给 engine。
> 顶部注释标注来源 + 许可("research-only,商用前确认",见本计划"偏离 spec" §4)。

- [ ] **Step 1: 移植代码**,对外接口固定为:

```python
# wav2lip/infer.py 对外契约(engine 依赖这两个)
def load_models(weights_dir: str):
    """加载 wav2lip_gan.pth + s3fd,返回不透明 handle(供 run 复用,只加载一次)。"""

def run(*, handle, face: str, audio: str, out_path: str,
        out_size: tuple[int, int], on_progress=None) -> str:
    """face=形象图/视频, audio=旁白 wav → 口型 mp4 写到 out_path,返回 out_path。
    分阶段调 on_progress(int 0..100)。"""
```

实现要点(移植时遵循):
- 人脸检测用 s3fd 权重(随 seed 仓);检不到脸 → `raise RuntimeError("未检测到人脸,请换正脸形象")`。
- `face` 是图 → 复制成单帧循环;是视频 → 逐帧。按 `out_size` resize 输出。
- 用 `imageio_ffmpeg` 的 ffmpeg 把口型帧 + audio 编码成 mp4(项目已有 ffmpeg,勿新增依赖)。
- device 自动:`torch.cuda.is_available()` → cuda 否则 cpu;CPU 慢但能跑。

- [ ] **Step 2: 写 skipif 冒烟测试**(无 torch 自动跳过,不阻塞本机)

```python
# 追加到 test_digital_human_jobs.py
import importlib.util, pytest

@pytest.mark.skipif(importlib.util.find_spec("torch") is None, reason="无 torch")
def test_wav2lip_module_importable():
    from chayuan.server.video_generation.digital_human.wav2lip import infer
    assert hasattr(infer, "load_models") and hasattr(infer, "run")
```

- [ ] **Step 3: 跑测试**

Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py -v`
Expected: 之前 2 passed + 本条 skipped(本机无 torch)

- [ ] **Step 4: py_compile 自检**

Run: `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/wav2lip/*.py`
Expected: 无输出(成功)

- [ ] **Step 5: 提交**

```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/wav2lip/ chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py
git commit -m "feat(dh): vendored Wav2Lip 最小推理(load_models/run)"
```

---

## Task 6: jobs —— 单 worker 队列 + 状态 + pipeline

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/jobs.py`
- Test: `test_digital_human_jobs.py`(追加)

- [ ] **Step 1: 写失败测试**(monkeypatch engine + tts,验证编排与状态机,不真推理)

```python
from chayuan.server.video_generation.digital_human import jobs as dh_jobs

def test_job_pipeline_success(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    # fake tts:写一个假 wav
    def fake_tts(text, preset, audio_path):
        open(audio_path, "wb").write(b"wav"); return audio_path
    monkeypatch.setattr(dh_jobs, "_synthesize_narration", fake_tts)
    # fake engine:写假 mp4 + 报进度
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            if on_progress: on_progress(80)
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda: _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")

    pid = dh_jobs.store.create_preset(name="A", avatar_ref="bundled:f1",
                                      avatar_kind="video").id
    tid = dh_jobs.submit(preset_id=pid, text="你好", width=720, height=1280)
    dh_jobs.run_sync(tid)  # 测试同步跑,不用线程池
    st = dh_jobs.get_status(tid)
    assert st.state == "complete" and st.progress == 100
    assert st.result_path and os.path.isfile(st.result_path)

def test_job_pipeline_missing_preset(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    tid = dh_jobs.submit(preset_id="nope", text="x", width=720, height=1280)
    dh_jobs.run_sync(tid)
    assert dh_jobs.get_status(tid).state == "failed"
```

- [ ] **Step 2: 跑测试确认失败** —— Expected: FAIL `ModuleNotFoundError: ...jobs`

- [ ] **Step 3: 实现**

```python
"""数字人任务:单 worker 线程池 + 内存状态登记 + pipeline(tts → engine)。

桌面单用户场景:模型常驻(engine module 级缓存),队列顺序处理,不卡 UI。
进度走轮询(routes 暴露 GET status),不复用 vg 的 SSE(那条绑 VideoParams)。
"""
from __future__ import annotations
import logging, os, threading, uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Dict

from chayuan.server.video_generation import _helpers
from chayuan.server.video_generation._helpers import task_dir
from chayuan.server.video_generation.digital_human import store
from chayuan.server.video_generation.digital_human.engine import get_engine
from chayuan.server.video_generation.digital_human.schemas import DhTaskStatus
from chayuan.server.video_generation.digital_human.store import resolve_avatar_path

logger = logging.getLogger("chayuan.dh.jobs")

_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dh")
_STATUS: Dict[str, DhTaskStatus] = {}
_LOCK = threading.Lock()
_PENDING: Dict[str, dict] = {}  # task_id → 入参


def _set(tid: str, **kw) -> None:
    with _LOCK:
        cur = _STATUS.get(tid) or DhTaskStatus(task_id=tid, state="pending")
        _STATUS[tid] = cur.model_copy(update=kw)


def get_status(tid: str) -> DhTaskStatus:
    with _LOCK:
        return _STATUS.get(tid) or DhTaskStatus(task_id=tid, state="failed", error="未知任务")


def _synthesize_narration(text: str, preset, audio_path: str) -> str:
    """preset 绑定音色 → 旁白 wav。复用 AudioPipeline(含 clone:<id>)。"""
    from chayuan.server.modality.audio import AudioPipeline
    voice = preset.voice_name or ""
    if preset.voice_provider == "clone" and voice.startswith("clone:"):
        cid = voice[len("clone:"):]
        wav = os.path.join(_helpers.voice_clones_dir(), f"{cid}.wav")
        voice = f"voxcpm:{wav}"
    data = AudioPipeline().synthesize(text, voice=voice or None, fmt="wav")
    with open(audio_path, "wb") as f:
        f.write(data)
    return audio_path


def _run_pipeline(tid: str) -> None:
    args = _PENDING.get(tid) or {}
    try:
        _set(tid, state="running", progress=5)
        preset = store.get_preset(args["preset_id"])
        if preset is None:
            raise RuntimeError("数字人不存在")
        avatar = resolve_avatar_path(preset.avatar_ref)
        if not avatar:
            raise RuntimeError("形象文件缺失")
        td = task_dir(f"dh-{tid}", create=True)
        audio_path = os.path.join(td, "narration.wav")
        out_path = os.path.join(td, "digital_human.mp4")
        _synthesize_narration(args["text"], preset, audio_path)
        _set(tid, progress=30)
        get_engine().generate(
            avatar_path=avatar, audio_path=audio_path, out_path=out_path,
            width=args["width"], height=args["height"],
            on_progress=lambda pct: _set(tid, progress=30 + int(pct * 0.7)),
        )
        _set(tid, state="complete", progress=100, result_path=out_path)
    except Exception as e:  # noqa: BLE001
        logger.warning("[dh] task %s 失败: %r", tid, e, exc_info=True)
        _set(tid, state="failed", error=str(e))
    finally:
        _PENDING.pop(tid, None)


def submit(*, preset_id: str, text: str, width: int, height: int) -> str:
    tid = uuid.uuid4().hex[:12]
    _PENDING[tid] = {"preset_id": preset_id, "text": text, "width": width, "height": height}
    _set(tid, state="pending", progress=0)
    _POOL.submit(_run_pipeline, tid)
    return tid


def run_sync(tid: str) -> None:
    """测试用:同步跑,不经线程池。"""
    _run_pipeline(tid)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py -v`
Expected: success/missing-preset passed,wav2lip 冒烟 skipped

- [ ] **Step 5: 提交**

```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/jobs.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py
git commit -m "feat(dh): 单 worker 任务队列 + tts→engine pipeline"
```

---

## Task 7: REST 路由 + 注册

**Files:**
- Create: `chayuan-server/libs/chayuan-server/chayuan/server/api_server/digital_human_routes.py`
- Modify: `chayuan-server/libs/chayuan-server/chayuan/server/api_server/server_app.py`(import + include_router)
- Test: `test_digital_human_routes.py`

- [ ] **Step 1: 写失败测试**(用 FastAPI TestClient + monkeypatch jobs.submit 不真跑)

```python
# test_digital_human_routes.py
from fastapi import FastAPI
from fastapi.testclient import TestClient
from chayuan.server.api_server.digital_human_routes import digital_human_router
from chayuan.server.video_generation import _helpers
from chayuan.server.video_generation.digital_human import jobs as dh_jobs

def _client(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    app = FastAPI(); app.include_router(digital_human_router)
    return TestClient(app)

def test_preset_crud_endpoints(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    r = c.post("/api/v1/digital-human/presets", json={
        "name": "主播A", "avatar_ref": "bundled:f1", "avatar_kind": "video",
        "voice_provider": "clone", "voice_name": "clone:x"})
    assert r.status_code == 200
    pid = r.json()["id"]
    assert c.get("/api/v1/digital-human/presets").json()["items"][0]["name"] == "主播A"
    assert c.delete(f"/api/v1/digital-human/presets/{pid}").json()["deleted"] is True

def test_generate_enqueues(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    monkeypatch.setattr(dh_jobs, "submit", lambda **k: "tid123")
    r = c.post("/api/v1/digital-human/generate",
               json={"preset_id": "p1", "text": "你好", "width": 720, "height": 1280})
    assert r.status_code == 200 and r.json()["task_id"] == "tid123"
```

> 注:鉴权依赖在测试 app 里不挂(直接 include_router 不带 `require_auth`),
> 真注册在 server_app 走全局鉴权中间件,与 video_generation 一致。

- [ ] **Step 2: 跑测试确认失败** —— Expected: FAIL `ModuleNotFoundError: ...digital_human_routes`

- [ ] **Step 3: 实现路由**(薄:协议 + 调 store/jobs;鉴权注入跟 `video_generation_routes` 一样用 `Depends(require_auth_enabled())`)

```python
"""数字人 REST —— 薄路由,逻辑在 digital_human/{store,jobs}。"""
from __future__ import annotations
import os, shutil, time, uuid
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi import Path as FPath
from fastapi.responses import FileResponse

from chayuan.server.api_server.deps import require_auth_enabled  # 与 vg 路由同源
from chayuan.server.video_generation._helpers import dh_avatars_dir, resolve_resolution
from chayuan.server.video_generation.digital_human import jobs as dh_jobs
from chayuan.server.video_generation.digital_human import store
from chayuan.server.video_generation.digital_human.schemas import (
    DhGenerateRequest, DigitalHumanPreset,
)

digital_human_router = APIRouter(prefix="/api/v1/digital-human", tags=["digital-human"])


@digital_human_router.get("/presets")
def list_presets(user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    items = [p.model_dump() for p in store.list_presets()]
    return {"count": len(items), "items": items}


@digital_human_router.post("/presets")
def create_preset(body: Dict[str, Any],
                  user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    try:
        p = store.create_preset(
            name=body["name"], avatar_ref=body["avatar_ref"],
            avatar_kind=body["avatar_kind"],
            voice_provider=body.get("voice_provider", "piper"),
            voice_name=body.get("voice_name", ""),
            is_greenscreen=bool(body.get("is_greenscreen", False)),
        )
    except KeyError as e:
        raise HTTPException(422, f"缺字段: {e}") from e
    return p.model_dump()


@digital_human_router.put("/presets/{pid}")
def update_preset(pid: str, body: Dict[str, Any],
                  user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    p = store.update_preset(pid, **body)
    if p is None:
        raise HTTPException(404, "数字人不存在")
    return p.model_dump()


@digital_human_router.delete("/presets/{pid}")
def delete_preset(pid: str,
                  user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    return {"deleted": store.delete_preset(pid), "id": pid}


@digital_human_router.get("/avatars")
def list_avatars(user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    items = store.list_avatars()
    return {"count": len(items), "items": items}


@digital_human_router.post("/avatars")
async def upload_avatar(file: UploadFile = File(...),
                        user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    ext = os.path.splitext(file.filename or "")[1].lower() or ".mp4"
    fid = f"{int(time.time())}-{uuid.uuid4().hex[:6]}{ext}"
    dest = os.path.join(dh_avatars_dir(create=True), fid)
    with open(dest, "wb") as f:
        f.write(await file.read())
    kind = "image" if ext in {".jpg", ".jpeg", ".png", ".webp", ".bmp"} else "video"
    return {"ref": f"user:{fid}", "kind": kind, "source": "user", "name": fid}


@digital_human_router.delete("/avatars/{name}")
def delete_avatar(name: str = FPath(..., max_length=128),
                  user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    p = os.path.join(dh_avatars_dir(), os.path.basename(name))
    removed = False
    if os.path.isfile(p):
        try:
            os.remove(p); removed = True
        except OSError:
            pass
    return {"deleted": removed, "name": name}


@digital_human_router.post("/generate")
def generate(body: DhGenerateRequest,
             width: int = 720, height: int = 1280,
             user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    tid = dh_jobs.submit(preset_id=body.preset_id, text=body.text,
                         width=width, height=height)
    return {"task_id": tid}


@digital_human_router.get("/tasks/{tid}")
def task_status(tid: str,
                user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    return dh_jobs.get_status(tid).model_dump()


@digital_human_router.get("/tasks/{tid}/file")
def task_file(tid: str,
              user: Dict[str, Any] = Depends(require_auth_enabled())) -> FileResponse:
    st = dh_jobs.get_status(tid)
    if st.state != "complete" or not os.path.isfile(st.result_path):
        raise HTTPException(404, "产物未就绪")
    return FileResponse(st.result_path, media_type="video/mp4", filename="digital_human.mp4")
```

> 实现时核对 `require_auth_enabled` 的真实 import 路径(`video_generation_routes.py`
> 顶部怎么 import 就照抄);`resolve_resolution` 若签名不符按 `schemas.py:69` 调整。

- [ ] **Step 4: 注册到 server_app**

在 `server_app.py` import 区(挨着 `video_generation_routes` 那行,约 line 48)加:
```python
from chayuan.server.api_server.digital_human_routes import digital_human_router
```
在 `include_router` 区(约 line 113 之后)加:
```python
    app.include_router(digital_human_router)
```

- [ ] **Step 5: 跑测试 + 提交**

Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_routes.py -v`
Expected: 2 passed
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/digital_human_routes.py chayuan-server/libs/chayuan-server/chayuan/server/api_server/server_app.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_routes.py
git commit -m "feat(dh): REST 路由(预设/形象/生成/状态/产物)+ 注册"
```

---

## Task 8: 模型 seed 脚本 + 打包

**Files:**
- Create: `chayuan-server/scripts/seed_digital_human.py`
- Modify: `chayuan-server/packaging/pyinstaller/chayuan-server.spec`
- Test: `test_digital_human_seed.py`

- [ ] **Step 1: 写测试**(只验 `--check` 逻辑,不真下载)

```python
# test_digital_human_seed.py
import runpy, sys, os, importlib.util

def test_seed_module_has_check(monkeypatch):
    spec = importlib.util.spec_from_file_location(
        "seed_dh", os.path.join(os.path.dirname(__file__),
        "../../../../scripts/seed_digital_human.py"))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    assert hasattr(m, "_is_ready") and hasattr(m, "MODELSCOPE_ID")
    assert m.MODELSCOPE_ID == "silveroxides/ComfyUI_wav2lip-models"
```

- [ ] **Step 2: 跑测试确认失败** —— Expected: FAIL(文件不存在)

- [ ] **Step 3: 实现 seed 脚本**(仿 `scripts/seed_voxcpm.py`;只取推理需要的 2 个权重)

```python
#!/usr/bin/env python3
"""下载 Wav2Lip 推理权重到 vendor/bundled_models/digital_human/。
来源:ModelScope silveroxides/ComfyUI_wav2lip-models(2026-05-30 实测匿名 200)。
只取 wav2lip_gan.pth(436MB)+ s3fd-619a316812.pth(90MB);训练用 ckpt 不取。
"""
from __future__ import annotations
import argparse, os, sys
from pathlib import Path

MODELSCOPE_ID = "silveroxides/ComfyUI_wav2lip-models"
WANT = ["wav2lip_gan.pth", "s3fd-619a316812.pth"]


def _dest() -> Path:
    return Path(__file__).resolve().parents[1] / "vendor" / "bundled_models" / "digital_human"


def _is_ready(d: Path) -> bool:
    return (d / "wav2lip_gan.pth").is_file()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", default=None)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    dest = Path(a.dest).resolve() if a.dest else _dest()
    if _is_ready(dest):
        print(f"[dh] OK 已就绪: {dest}"); return 0
    if a.check:
        print(f"[dh] [FAIL] 未就绪: {dest}"); return 1
    try:
        from modelscope.hub.file_download import model_file_download
    except Exception as e:  # noqa: BLE001
        print(f"[dh] !! 需要 modelscope: pip install modelscope ({e})"); return 1
    dest.mkdir(parents=True, exist_ok=True)
    for fn in WANT:
        print(f"[dh] 下载 {fn} …")
        p = model_file_download(model_id=MODELSCOPE_ID, file_path=fn)
        import shutil; shutil.copy2(p, dest / fn)
    print("[dh] OK" if _is_ready(dest) else "[dh] [FAIL]")
    return 0 if _is_ready(dest) else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: spec 加依赖收集**

在 `chayuan-server.spec` 的 `_collect_safe` 列表(约 line 621,挨着 `"voxcpm",`)加:
```python
    # 数字人 Wav2Lip:torch 已在(克隆引入);人脸检测/音频处理的动态子模块
    "librosa",
    "scipy",
```
若移植代码引入其它纯 py 包,在此追加。Wav2Lip 权重本身随
`vendor/bundled_models/digital_human/` 走 Tauri resources(同 voxcpm,不进 datas)。

- [ ] **Step 5: 跑测试 + py_compile + 提交**

Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_seed.py -v && python -m py_compile chayuan-server/scripts/seed_digital_human.py chayuan-server/packaging/pyinstaller/chayuan-server.spec`
Expected: 1 passed + py_compile 成功
```bash
cd /work/chayuan-desktop && git add chayuan-server/scripts/seed_digital_human.py chayuan-server/packaging/pyinstaller/chayuan-server.spec chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_seed.py
git commit -m "feat(dh): Wav2Lip 权重 seed 脚本 + 打包依赖收集"
```

---

## Task 9: 前端 API 客户端 + 类型

**Files:**
- Modify: `chayuan-client/packages/transport/src/types.ts`
- Create: `chayuan-client/packages/api/src/digitalHuman.ts`
- Modify: `chayuan-client/packages/api/src/index.ts`(re-export)

- [ ] **Step 1: transport 加类型**(放 `VgMessageMeta` 附近)

```typescript
export interface DigitalHumanPreset {
  id: string;
  name: string;
  avatar_ref: string;
  avatar_kind: 'image' | 'video';
  is_greenscreen: boolean;
  voice_provider: 'piper' | 'edge' | 'sherpa' | 'clone';
  voice_name: string;
  created: number;
}
export interface DhAvatar {
  ref: string; kind: 'image' | 'video'; source: 'bundled' | 'user'; name: string;
}
export interface DhTaskStatus {
  task_id: string;
  state: 'pending' | 'running' | 'complete' | 'failed' | 'canceled';
  progress: number; error: string; result_path: string;
}
```

- [ ] **Step 2: api 客户端**(`digitalHuman.ts`,复用 `videoGeneration.ts` 的 `rd` 与 `getClientConfig` 范式)

```typescript
import { request, getClientConfig } from './client';
import type { DigitalHumanPreset, DhAvatar, DhTaskStatus } from '@chayuan/transport';

async function rd<T>(...args: Parameters<typeof request>): Promise<T> {
  return (await request(...args)) as T;
}

export const digitalHuman = {
  listPresets: () =>
    rd<{ count: number; items: DigitalHumanPreset[] }>('/api/v1/digital-human/presets'),
  createPreset: (body: Partial<DigitalHumanPreset>) =>
    rd<DigitalHumanPreset>('/api/v1/digital-human/presets', { method: 'POST', body }),
  updatePreset: (id: string, body: Partial<DigitalHumanPreset>) =>
    rd<DigitalHumanPreset>(`/api/v1/digital-human/presets/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  deletePreset: (id: string) =>
    rd<{ deleted: boolean }>(`/api/v1/digital-human/presets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listAvatars: () =>
    rd<{ count: number; items: DhAvatar[] }>('/api/v1/digital-human/avatars'),
  uploadAvatar: (file: File) => {
    const fd = new FormData(); fd.append('file', file);
    return rd<DhAvatar>('/api/v1/digital-human/avatars', { method: 'POST', body: fd });
  },
  deleteAvatar: (name: string) =>
    rd<{ deleted: boolean }>(`/api/v1/digital-human/avatars/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  generate: (preset_id: string, text: string, width = 720, height = 1280) =>
    rd<{ task_id: string }>(`/api/v1/digital-human/generate`, {
      method: 'POST', query: { width, height },
      body: { preset_id, text },
    }),
  taskStatus: (tid: string) =>
    rd<DhTaskStatus>(`/api/v1/digital-human/tasks/${encodeURIComponent(tid)}`),
  taskFileUrl: (tid: string) => {
    const cfg = getClientConfig();
    return `${(cfg.baseURL || '').replace(/\/+$/, '')}/api/v1/digital-human/tasks/${encodeURIComponent(tid)}/file`;
  },
};
```

- [ ] **Step 3: re-export** —— 在 `packages/api/src/index.ts` 加 `export * from './digitalHuman';`

- [ ] **Step 4: typecheck**

Run: `cd chayuan-client && npm run typecheck 2>&1 | grep -E "packages/(api|transport) typecheck"`
Expected: `packages/api typecheck: Done` + `packages/transport typecheck: Done`

> 已知无关失败:`apps/web` 的 `@chayuan/license`(预存在,不属本任务)。

- [ ] **Step 5: 提交**

```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/transport/src/types.ts chayuan-client/packages/api/src/digitalHuman.ts chayuan-client/packages/api/src/index.ts
git commit -m "feat(dh): 前端 API 客户端 + transport 类型"
```

---

## Task 10: 首页卡片 + 路由 + page-registry

**Files:**
- Modify: `chayuan-client/packages/app/src/features/home/HomePage.tsx`
- Modify: `chayuan-client/packages/app/src/router/index.tsx`
- Modify: `chayuan-client/packages/app/src/features/shell/page-registry.tsx`
- Create: `chayuan-client/packages/app/src/features/digital-human/DigitalHumanPage.tsx`(占位壳,Task 11 填实)

- [ ] **Step 1: 占位页**(先让路由能渲染)

```tsx
// DigitalHumanPage.tsx
import * as React from 'react';
export const DigitalHumanPage: React.FC = () => (
  <div className="p-6 text-sm text-[var(--cy-text-secondary)]">数字人(加载中…)</div>
);
```

- [ ] **Step 2: HomePage CAPS 加卡**(在 `video-generation` 卡后追加;icon 复用 lucide 的 `UserSquare` 或 `Smile`,import 已有 lucide)

```tsx
  {
    id: 'digital-human',
    icon: UserRound,
    title: '数字人',
    subtitle: '选形象 + 绑音色 → 文案口播 → 一键生成讲话视频',
    to: '/digital-human',
    gradient: 'from-teal-50 to-cyan-100 dark:from-teal-900/30 dark:to-cyan-800/40',
    iconBg: 'bg-gradient-to-br from-teal-400 to-cyan-500',
  },
```
并在文件顶部 lucide import 加 `UserRound`。

- [ ] **Step 3: router 加 workspace route**(`workspaceRoutes` 数组,挨着 video-generation 那组)

```tsx
  { path: '/digital-human', id: 'digital-human' },
```

- [ ] **Step 4: page-registry 加 lazy 映射 + resolveRoute 分支**

```tsx
const DigitalHumanPage = React.lazy(() =>
  import('../digital-human/DigitalHumanPage').then((m) => ({ default: m.DigitalHumanPage })),
);
```
在 `resolveRoute`(按 path 返回组件的地方)加:`/digital-human` 起始 → `<DigitalHumanPage />`。
照抄 `/video-generation` 现有分支写法(同文件内已有范式)。

- [ ] **Step 5: typecheck + 提交**

Run: `cd chayuan-client && npm run typecheck 2>&1 | grep "packages/app typecheck"`
Expected: `packages/app typecheck: Done`
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/app/src/features/home/HomePage.tsx chayuan-client/packages/app/src/router/index.tsx chayuan-client/packages/app/src/features/shell/page-registry.tsx chayuan-client/packages/app/src/features/digital-human/DigitalHumanPage.tsx
git commit -m "feat(dh): 首页卡片 + /digital-human 路由 + page-registry"
```

---

## Task 11: 数字人页壳(两分区:我的数字人 / 生成)

**Files:**
- Modify: `chayuan-client/packages/app/src/features/digital-human/DigitalHumanPage.tsx`

- [ ] **Step 1: 实现两分区 tab 壳**(`useState` 切 'manage' | 'generate';加载 presets)

```tsx
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { digitalHuman } from '@chayuan/api';
import { PresetList } from './PresetList';
import { GeneratePanel } from './GeneratePanel';

export const DigitalHumanPage: React.FC = () => {
  const [tab, setTab] = React.useState<'manage' | 'generate'>('manage');
  const presetsQ = useQuery({ queryKey: ['dh.presets'], queryFn: digitalHuman.listPresets });
  const presets = presetsQ.data?.items ?? [];
  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex gap-2">
        {(['manage', 'generate'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`h-8 rounded-md px-3 text-sm ${tab === k
              ? 'bg-[var(--cy-ink-700)] text-white'
              : 'text-[var(--cy-text-secondary)] hover:bg-[var(--cy-surface-2)]'}`}>
            {k === 'manage' ? '我的数字人' : '生成'}
          </button>
        ))}
      </div>
      {tab === 'manage'
        ? <PresetList presets={presets} onChanged={() => void presetsQ.refetch()} />
        : <GeneratePanel presets={presets} />}
    </div>
  );
};
```

- [ ] **Step 2: 临时桩**:先建空的 `PresetList.tsx` / `GeneratePanel.tsx` 导出占位组件,保证编译;Task 12/13 填实。

```tsx
// PresetList.tsx (占位)
import * as React from 'react';
import type { DigitalHumanPreset } from '@chayuan/transport';
export const PresetList: React.FC<{ presets: DigitalHumanPreset[]; onChanged: () => void }> = () =>
  <div className="text-sm text-[var(--cy-text-tertiary)]">预设列表(占位)</div>;
// GeneratePanel.tsx (占位)
export const GeneratePanel: React.FC<{ presets: DigitalHumanPreset[] }> = () =>
  <div className="text-sm text-[var(--cy-text-tertiary)]">生成(占位)</div>;
```

- [ ] **Step 3: typecheck + 提交**

Run: `cd chayuan-client && npm run typecheck 2>&1 | grep "packages/app typecheck"` → Done
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/app/src/features/digital-human/
git commit -m "feat(dh): 数字人页两分区壳 + 子组件占位"
```

---

## Task 12: 预设管理(列表 + 编辑器:形象选择 + 复用 VgSpeechSettings 绑音色 + 命名)

**Files:**
- Modify: `chayuan-client/packages/app/src/features/digital-human/PresetList.tsx`
- Create: `chayuan-client/packages/app/src/features/digital-human/PresetEditor.tsx`

- [ ] **Step 1: PresetEditor**(形象网格 = `digitalHuman.listAvatars` + 上传;音色绑定**复用** `VgSpeechSettings` 受控形态——见下方说明;命名;保存调 create/update)

> `VgSpeechSettings` 当前直接读写全局 `useVgComposer`。复用要点:本页只需
> `voice_provider` + `voice_name`。**最小复用**做法:直接 import `VgSpeechSettings`
> 渲染,读 `useVgComposer.getState()` 的 voice_* 作为本预设音色来源;保存预设时
> 把当前 `voice_provider`/`voice_name` 写进 preset。若耦合过深难直接复用,改为
> 抽出 `VgSpeechSettings` 的「provider chip + 音色下拉」为受控子组件 `<VoicePicker
> value onChange>`(同文件再导出),`VgSpeechSettings` 内部改用它——这是 spec
> 「真复用」判定要求的方向,不要另写一个 mini 版。

```tsx
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { digitalHuman } from '@chayuan/api';
import type { DigitalHumanPreset } from '@chayuan/transport';
import { VoicePicker } from '../video-generation/VgAudioPopover'; // 受控音色选择(本任务从 VgSpeechSettings 抽出)

export const PresetEditor: React.FC<{
  initial?: DigitalHumanPreset;
  onSaved: () => void; onCancel: () => void;
}> = ({ initial, onSaved, onCancel }) => {
  const avatarsQ = useQuery({ queryKey: ['dh.avatars'], queryFn: digitalHuman.listAvatars });
  const [name, setName] = React.useState(initial?.name ?? '');
  const [avatarRef, setAvatarRef] = React.useState(initial?.avatar_ref ?? '');
  const [voice, setVoice] = React.useState({
    voice_provider: initial?.voice_provider ?? 'piper',
    voice_name: initial?.voice_name ?? '',
  });
  const avatars = avatarsQ.data?.items ?? [];
  const save = async () => {
    const kind = avatars.find((a) => a.ref === avatarRef)?.kind ?? 'video';
    const body = { name, avatar_ref: avatarRef, avatar_kind: kind, ...voice };
    if (initial) await digitalHuman.updatePreset(initial.id, body);
    else await digitalHuman.createPreset(body);
    onSaved();
  };
  return (
    <div className="space-y-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="数字人名字"
        className="h-8 w-60 rounded-md border px-2 text-sm" />
      <div className="grid grid-cols-4 gap-2">
        {avatars.map((a) => (
          <button key={a.ref} onClick={() => setAvatarRef(a.ref)}
            className={`aspect-video rounded-md border text-xs ${avatarRef === a.ref ? 'ring-2 ring-[var(--cy-brand-500)]' : ''}`}>
            {a.name}
          </button>
        ))}
        <AvatarUpload onUploaded={() => void avatarsQ.refetch()} />
      </div>
      <VoicePicker value={voice} onChange={setVoice} />
      <div className="flex gap-2">
        <button onClick={() => void save()} disabled={!name || !avatarRef}
          className="h-8 rounded-md bg-[var(--cy-brand-500)] px-3 text-sm text-white disabled:opacity-50">保存</button>
        <button onClick={onCancel} className="h-8 rounded-md px-3 text-sm">取消</button>
      </div>
    </div>
  );
};

const AvatarUpload: React.FC<{ onUploaded: () => void }> = ({ onUploaded }) => {
  const ref = React.useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*,video/*" className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (f) { await digitalHuman.uploadAvatar(f); onUploaded(); }
        }} />
      <button onClick={() => ref.current?.click()}
        className="aspect-video rounded-md border border-dashed text-xs">+ 上传形象</button>
    </>
  );
};
```

- [ ] **Step 2: 从 VgSpeechSettings 抽出 `VoicePicker`**(受控:`{value:{voice_provider,voice_name}, onChange}`),`VgSpeechSettings` 内部改调它(保持其原全局 store 行为)。导出 `VoicePicker`。这步是"真复用"的关键,**不要**在数字人里另写音色下拉。

- [ ] **Step 3: PresetList**(网格 + 新建/编辑/删除;编辑态渲染 PresetEditor)

```tsx
import * as React from 'react';
import { digitalHuman } from '@chayuan/api';
import type { DigitalHumanPreset } from '@chayuan/transport';
import { PresetEditor } from './PresetEditor';

export const PresetList: React.FC<{ presets: DigitalHumanPreset[]; onChanged: () => void }> =
({ presets, onChanged }) => {
  const [editing, setEditing] = React.useState<DigitalHumanPreset | 'new' | null>(null);
  if (editing) {
    return <PresetEditor initial={editing === 'new' ? undefined : editing}
      onSaved={() => { setEditing(null); onChanged(); }}
      onCancel={() => setEditing(null)} />;
  }
  return (
    <div className="grid grid-cols-3 gap-3">
      {presets.map((p) => (
        <div key={p.id} className="rounded-lg border p-3 text-sm">
          <div className="font-medium">{p.name}</div>
          <div className="text-xs text-[var(--cy-text-tertiary)]">音色 {p.voice_name || p.voice_provider}</div>
          <div className="mt-2 flex gap-2">
            <button onClick={() => setEditing(p)} className="text-xs">编辑</button>
            <button onClick={async () => { await digitalHuman.deletePreset(p.id); onChanged(); }}
              className="text-xs text-rose-600">删除</button>
          </div>
        </div>
      ))}
      <button onClick={() => setEditing('new')}
        className="rounded-lg border border-dashed p-3 text-sm">+ 新建数字人</button>
    </div>
  );
};
```

- [ ] **Step 4: typecheck + 提交**

Run: `cd chayuan-client && npm run typecheck 2>&1 | grep "packages/app typecheck"` → Done
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/app/src/features/digital-human/ chayuan-client/packages/app/src/features/video-generation/VgAudioPopover.tsx
git commit -m "feat(dh): 预设管理(列表+编辑器)+ 抽出 VoicePicker 真复用"
```

---

## Task 13: 生成面板(选预设 + 文案 + 生成 + 轮询进度 + 下载/进时间轴)

**Files:**
- Modify: `chayuan-client/packages/app/src/features/digital-human/GeneratePanel.tsx`
- Create: `chayuan-client/packages/app/src/features/digital-human/DhProgressCard.tsx`

- [ ] **Step 1: DhProgressCard**(1s 轮询 `taskStatus`,终态停;complete 给下载 + 进时间轴)

```tsx
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { digitalHuman } from '@chayuan/api';

export const DhProgressCard: React.FC<{ taskId: string }> = ({ taskId }) => {
  const q = useQuery({
    queryKey: ['dh.task', taskId],
    queryFn: () => digitalHuman.taskStatus(taskId),
    refetchInterval: (query) => {
      const s = query.state.data?.state;
      return s === 'complete' || s === 'failed' || s === 'canceled' ? false : 1000;
    },
  });
  const st = q.data;
  if (!st) return <div className="text-xs">排队中…</div>;
  if (st.state === 'failed') return <div className="text-xs text-rose-600">失败:{st.error}</div>;
  if (st.state === 'complete') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <video src={digitalHuman.taskFileUrl(taskId)} controls className="h-40 rounded" />
        <a href={digitalHuman.taskFileUrl(taskId)} download
          className="rounded-md bg-[var(--cy-brand-500)] px-2 py-1 text-white">下载</a>
      </div>
    );
  }
  return <div className="text-xs">生成中… {st.progress}%</div>;
};
```

> 「进时间轴」:P1 先给「下载」+ video 预览;「发送到时间轴」按钮可在本任务内追加一个
> 调用——把产物 URL 通过现有素材 ingest(`videoGeneration.ingestMedia({url, kind:'video'})`)
> 落库后 `navigate('/video-generation/timeline')`。若 ingest 不接受跨模块本地 URL,P1
> 可仅保留下载,「进时间轴」记入 P2(在面板注明)。执行时按 ingestMedia 实际能力二选一,
> 并在 commit message 注明所选。

- [ ] **Step 2: GeneratePanel**(选预设下拉 + 文案 textarea + 生成按钮 → 渲染 DhProgressCard)

```tsx
import * as React from 'react';
import { digitalHuman } from '@chayuan/api';
import type { DigitalHumanPreset } from '@chayuan/transport';
import { DhProgressCard } from './DhProgressCard';

export const GeneratePanel: React.FC<{ presets: DigitalHumanPreset[] }> = ({ presets }) => {
  const [pid, setPid] = React.useState(presets[0]?.id ?? '');
  const [text, setText] = React.useState('');
  const [taskId, setTaskId] = React.useState<string | null>(null);
  React.useEffect(() => { if (!pid && presets[0]) setPid(presets[0].id); }, [presets, pid]);
  const gen = async () => {
    const r = await digitalHuman.generate(pid, text);
    setTaskId(r.task_id);
  };
  if (presets.length === 0)
    return <div className="text-sm text-[var(--cy-text-tertiary)]">先到「我的数字人」新建一个数字人。</div>;
  return (
    <div className="space-y-3">
      <select value={pid} onChange={(e) => setPid(e.target.value)}
        className="h-8 rounded-md border px-2 text-sm">
        {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
        placeholder="输入口播文案…" className="w-full rounded-md border p-2 text-sm" />
      <button onClick={() => void gen()} disabled={!pid || !text.trim()}
        className="h-8 rounded-md bg-[var(--cy-brand-500)] px-3 text-sm text-white disabled:opacity-50">
        生成数字人视频
      </button>
      {taskId && <DhProgressCard taskId={taskId} />}
    </div>
  );
};
```

- [ ] **Step 3: typecheck + 提交**

Run: `cd chayuan-client && npm run typecheck 2>&1 | grep "packages/app typecheck"` → Done
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/app/src/features/digital-human/
git commit -m "feat(dh): 生成面板 + 轮询进度卡(下载/预览)"
```

---

## Task 14: 全链路自检 + 推送

- [ ] **Step 1: 后端全 dh 测试**

Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_*.py -v`
Expected: 全 passed(wav2lip 冒烟 skipped)

- [ ] **Step 2: 前端 typecheck**

Run: `cd chayuan-client && npm run typecheck 2>&1 | grep -E "packages/(api|transport|app) typecheck"`
Expected: 三个都 Done

- [ ] **Step 3: py_compile 触达后端文件**

Run: `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/*.py chayuan-server/libs/chayuan-server/chayuan/server/api_server/digital_human_routes.py`

- [ ] **Step 4: 推送**

```bash
cd /work/chayuan-desktop && git push origin main
```

---

## 自检(Self-Review)结论

- **Spec 覆盖**:首页卡片(T10)/数字人页(T11)/预设 CRUD(T3,T7,T12)/形象库预置+上传
  (T3,T7,T12)/口播生成-Wav2Lip+克隆音色(T4-T6,T13)/任务队列(T6)/进度(T13)/下载(T13)
  /打包自包含(T8)。**进时间轴**:T13 Step1 给了 ingest 路径但标注按 `ingestMedia`
  实际能力二选一(可能滑到 P2)——这是 spec「产物进时间轴」的唯一弱覆盖点,已显式标注。
- **占位扫描**:无 TBD;Task 5(Wav2Lip 移植)与 Task 12 Step2(抽 VoicePicker)是"按既定接口
  移植/重构"而非占位,给了明确对外契约。
- **类型一致**:`DigitalHumanPreset`/`DhTaskStatus` 前后端字段一致;engine `generate(...)`
  签名在 T4/T5/T6 三处一致;`avatar_ref` 前缀 `bundled:`/`user:` 全程一致。
- **风险**:① Wav2Lip 许可(已在顶部 §4 标注,provider 可换);② 预置绿幕形象采集
  (spec 已记,P1 可先用普通正脸短视频跑通);③ Wav2Lip 移植工作量集中在 T5(本机无 torch
  无法真验,需用户 py312 环境冒烟)。

> 落地后建议:T1–T8(后端)可先一波到用户环境真跑冒烟,确认 Wav2Lip 出片再做 T9–T13 前端联调。
