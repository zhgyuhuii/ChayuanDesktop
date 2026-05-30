# 数字人 GPU-P1(可插拔引擎骨架)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 checkbox。

**Goal:** 把 `get_engine()` 从写死 Wav2Lip 改成**可插拔引擎注册表**,贯通 `engine` 选择字段 + `GET /engines` + 前端引擎 picker;GPU 引擎(SadTalker/MuseTalk)列出但显"未安装"、选中时禁用生成并给安装入口。**不带真 GPU 引擎,不破基础包红线。**

**Architecture:** 注册表 `ENGINES`(EngineSpec)+ `get_engine(engine_id)` + `list_engines()` + `is_available()`。Wav2Lip 保留(builtin,默认/兜底);SadTalker/MuseTalk 用占位 impl(`generate` 抛"未安装"明确错误,真实现留 GPU-P2/P3)。`engine` 字段贯通 schema→jobs→get_engine,默认 `wav2lip`(P1–P3 行为不变)。

**Tech Stack:** Python/FastAPI/Pydantic v2;TS/React。承接已交付 DH P1–P3。

---

## 文件结构

- `video_generation/digital_human/engine.py`(改):加 `EngineSpec`/`_SPECS`/`_engine_installed`/`is_available`/`get_engine(engine_id)`/`list_engines`/`_UnavailableGpuEngine`。保留 `Wav2LipEngine`/`_resolve_wav2lip_dir`/`DigitalHumanEngine`。
- `video_generation/digital_human/schemas.py`(改):`DhEngine` 类型 + `DhGenerateRequest.engine`。
- `video_generation/digital_human/jobs.py`(改):`submit` 加 `engine`;`_run_pipeline` 用 `get_engine(engine)`。
- `api_server/digital_human_routes.py`(改):`generate` 透传 `engine`;`GET /engines`。
- 前端 `packages/api/src/digitalHuman.ts`(改):`listEngines` + `dhGenerate` 加 `engine`;`packages/transport/src/types.ts`(改):`DhEngineInfo` 类型。
- 前端 `GeneratePanel.tsx`(改):引擎 picker + 未安装 gating + 去安装链接。

测试:扩 `test_digital_human_jobs.py`(引擎注册表)、`test_digital_human_routes.py`(/engines + engine 透传)。

---

## Task 1: 引擎注册表(engine.py)

**Files:** `video_generation/digital_human/engine.py`,test `tests/unit_tests/test_digital_human_jobs.py`

- [ ] **Step 1: 写失败测试**(追加到 test_digital_human_jobs.py)
```python
from chayuan.server.video_generation.digital_human import engine as dh_engine

def test_engine_registry_listing():
    items = dh_engine.list_engines()
    ids = {e["id"] for e in items}
    assert ids == {"wav2lip", "sadtalker", "musetalk"}
    w = next(e for e in items if e["id"] == "wav2lip")
    assert w["builtin"] is True and w["kind"] == "cpu" and w["installed"] is True
    g = next(e for e in items if e["id"] == "sadtalker")
    assert g["builtin"] is False and g["kind"] == "gpu" and g["installed"] is False
    assert g["input"] == "image"
    assert next(e for e in items if e["id"] == "musetalk")["input"] == "video"

def test_get_engine_default_is_wav2lip():
    assert isinstance(dh_engine.get_engine(), dh_engine.Wav2LipEngine)
    assert isinstance(dh_engine.get_engine("wav2lip"), dh_engine.Wav2LipEngine)

def test_get_engine_gpu_placeholder_raises_on_generate():
    e = dh_engine.get_engine("sadtalker")          # 占位 impl,可取
    assert dh_engine.is_available("sadtalker") is False
    import pytest
    with pytest.raises(RuntimeError, match="未安装"):
        e.generate(avatar_path="a", audio_path="b", out_path="o", width=720, height=1280)

def test_get_engine_unknown_raises():
    import pytest
    with pytest.raises(RuntimeError, match="未知引擎"):
        dh_engine.get_engine("nope")
```

- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py -k engine -v`
Expected: FAIL(无 list_engines/is_available/get_engine 带参)

- [ ] **Step 3: 实现** — 在 `engine.py` 末尾(替换原 `def get_engine()`)加:
```python
from dataclasses import dataclass


@dataclass(frozen=True)
class EngineSpec:
    id: str
    label: str
    kind: str       # "cpu" | "gpu"
    input: str      # "image" | "video" | "both"
    builtin: bool


_SPECS: dict[str, EngineSpec] = {
    "wav2lip":   EngineSpec("wav2lip",   "Wav2Lip · 快速(CPU)",     "cpu", "both",  True),
    "sadtalker": EngineSpec("sadtalker", "SadTalker · 高清头动(GPU)", "gpu", "image", False),
    "musetalk":  EngineSpec("musetalk",  "MuseTalk · 高清口型(GPU)",  "gpu", "video", False),
}


class _UnavailableGpuEngine:
    """GPU 引擎占位(GPU-P1 只搭骨架,真实现 P2/P3)。generate 抛"未安装"明确错误,
    绝不静默回退 Wav2Lip(避免用户以为用了高质量档)。"""
    def __init__(self, spec: EngineSpec) -> None:
        self._spec = spec

    def generate(self, *, avatar_path: str, audio_path: str, out_path: str,
                 width: int, height: int,
                 on_progress: Optional[ProgressCb] = None) -> str:
        raise RuntimeError(
            f"{self._spec.label} 运行时未安装:请在模型广场安装 {self._spec.id} "
            f"运行时后重试(需 GPU)"
        )


def _engine_installed(engine_id: str) -> bool:
    spec = _SPECS.get(engine_id)
    if spec is None:
        return False
    if spec.builtin:
        return True
    # GPU-P1:真 GPU 运行时尚未实现 → 恒 False。GPU-P2/P3 在此接
    # local_runtime_registry 查"运行时已装 + sidecar /health ready"。
    return False


def is_available(engine_id: str) -> bool:
    return _engine_installed(engine_id)


def get_engine(engine_id: str = "wav2lip") -> DigitalHumanEngine:
    if engine_id == "wav2lip":
        return Wav2LipEngine()
    spec = _SPECS.get(engine_id)
    if spec is None:
        raise RuntimeError(f"未知引擎: {engine_id}")
    return _UnavailableGpuEngine(spec)


def list_engines() -> list[dict]:
    return [
        {"id": s.id, "label": s.label, "kind": s.kind, "input": s.input,
         "builtin": s.builtin, "installed": _engine_installed(s.id)}
        for s in _SPECS.values()
    ]
```
> 删掉原来的 `def get_engine() -> DigitalHumanEngine: return Wav2LipEngine()`(被上面带参版替换)。`_UnavailableGpuEngine.generate` 签名必须跟 `DigitalHumanEngine` 协议一致(关键字参数同名)。

- [ ] **Step 4: 跑测试确认通过 + 全 jobs 测试不回归**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py -v`
Expected: 新 4 条 + 旧的(engine 协议/pipeline)全 passed

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/engine.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py
git commit -m "feat(dh): 引擎注册表(可插拔) + GPU 引擎占位(未装即报错)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: schema + jobs 贯通 engine 字段

**Files:** `video_generation/digital_human/schemas.py`,`video_generation/digital_human/jobs.py`,test `test_digital_human_jobs.py`

- [ ] **Step 1: 写失败测试**(验 engine 透传到 get_engine)
```python
def test_job_pipeline_engine_passthrough(monkeypatch, tmp_path):
    import uuid as _uuid
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    monkeypatch.setattr(dh_jobs, "_synthesize_narration", lambda t, p, a: (open(a, "wb").write(b"w"), a)[1])
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    seen = {}
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda eid="wav2lip": seen.update(engine=eid) or _E())

    pid = dh_jobs.store.create_preset(name="A", avatar_ref="bundled:f1", avatar_kind="video").id
    tid = _uuid.uuid4().hex[:12]
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "hi", "width": 720, "height": 1280,
                             "product_ref": None, "template": "none", "matte": False, "engine": "sadtalker"}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    assert seen.get("engine") == "sadtalker"
```

- [ ] **Step 2: 跑测试确认失败**(当前 `_run_pipeline` 调 `get_engine()` 不带 engine)

- [ ] **Step 3: 实现**
`schemas.py`:在 `DhTemplate` 定义旁加 `DhEngine`,并给 `DhGenerateRequest` 加 `engine`:
```python
DhEngine = Literal["wav2lip", "sadtalker", "musetalk"]
```
```python
class DhGenerateRequest(BaseModel):
    preset_id: str
    text: str = Field(min_length=1, max_length=5000)
    product_image: Optional[str] = None
    template: DhTemplate = "none"
    matte: bool = False
    engine: DhEngine = "wav2lip"
```
`jobs.py`:`submit` 加 `engine: str = "wav2lip"`,写入 `_PENDING`:
```python
def submit(*, preset_id: str, text: str, width: int, height: int,
           product_ref: Optional[str] = None, template: str = "none",
           matte: bool = False, engine: str = "wav2lip") -> str:
    tid = uuid.uuid4().hex[:12]
    _PENDING[tid] = {"preset_id": preset_id, "text": text, "width": width, "height": height,
                     "product_ref": product_ref, "template": template, "matte": matte,
                     "engine": engine}
    _set(tid, state="pending", progress=0)
    _POOL.submit(_run_pipeline, tid)
    return tid
```
`_run_pipeline`:把 `get_engine().generate(...)` 改成 `get_engine(args.get("engine") or "wav2lip").generate(...)`(只改这一处的 `get_engine()` 调用)。

- [ ] **Step 4: 跑测试确认通过**(新条 + 旧 pipeline 测试全过;P1–P3 的 with_product/matte 没传 engine → `args.get("engine")` None → 默认 wav2lip,不回归)
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py -v`

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/schemas.py chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/jobs.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py
git commit -m "feat(dh): engine 字段贯通 schema→jobs→get_engine(默认 wav2lip)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 路由 GET /engines + generate 透传 engine

**Files:** `api_server/digital_human_routes.py`,test `test_digital_human_routes.py`

- [ ] **Step 1: 写失败测试**(追加)
```python
def test_list_engines(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    r = c.get("/api/v1/digital-human/engines")
    assert r.status_code == 200
    items = r.json()["items"]
    ids = {e["id"] for e in items}
    assert ids == {"wav2lip", "sadtalker", "musetalk"}
    assert next(e for e in items if e["id"] == "wav2lip")["installed"] is True

def test_generate_passes_engine(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    seen = {}
    monkeypatch.setattr(dh_jobs, "submit", lambda **k: seen.update(k) or "tidE")
    r = c.post("/api/v1/digital-human/generate",
               json={"preset_id": "p1", "text": "hi", "engine": "musetalk"})
    assert r.status_code == 200 and seen.get("engine") == "musetalk"
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现** — `digital_human_routes.py`:
import 加 `from chayuan.server.video_generation.digital_human import engine as dh_engine`。
加端点(放 list_avatars 附近):
```python
@digital_human_router.get("/engines")
def list_engines(user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    items = dh_engine.list_engines()
    return {"count": len(items), "items": items}
```
`generate` 透传 engine:
```python
    tid = dh_jobs.submit(preset_id=body.preset_id, text=body.text,
                         width=width, height=height,
                         product_ref=body.product_image, template=body.template,
                         matte=body.matte, engine=body.engine)
```

- [ ] **Step 4: 跑测试确认通过**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_routes.py -v`
Expected: 全 passed(P1–P3 路由测试 + 新 2 条)

- [ ] **Step 5: py_compile + 提交**
```bash
python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/api_server/digital_human_routes.py
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/digital_human_routes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_routes.py
git commit -m "feat(dh): GET /engines + generate 透传 engine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 前端 API(listEngines + generate engine)

**Files:** `packages/transport/src/types.ts`,`packages/api/src/digitalHuman.ts`

- [ ] **Step 1: transport 类型**(加到数字人类型区,`DhTaskStatus` 附近)
```typescript
export interface DhEngineInfo {
  id: 'wav2lip' | 'sadtalker' | 'musetalk';
  label: string;
  kind: 'cpu' | 'gpu';
  input: 'image' | 'video' | 'both';
  builtin: boolean;
  installed: boolean;
}
```

- [ ] **Step 2: api 客户端**(`digitalHuman.ts`:加 `dhListEngines`,`dhGenerate` opts 加 `engine`)
```typescript
export async function dhListEngines(): Promise<{ count: number; items: DhEngineInfo[] }> {
  return rd<{ count: number; items: DhEngineInfo[] }>('/api/v1/digital-human/engines');
}

export async function dhGenerate(
  preset_id: string, text: string,
  opts?: { product_image?: string; template?: 'none' | 'corner' | 'bg' | 'side';
           matte?: boolean; engine?: 'wav2lip' | 'sadtalker' | 'musetalk';
           width?: number; height?: number },
): Promise<{ task_id: string }> {
  return rd<{ task_id: string }>('/api/v1/digital-human/generate', {
    method: 'POST',
    query: { width: opts?.width ?? 720, height: opts?.height ?? 1280 },
    body: { preset_id, text, product_image: opts?.product_image,
            template: opts?.template ?? 'none', matte: opts?.matte ?? false,
            engine: opts?.engine ?? 'wav2lip' },
  });
}
```
import 顶部加 `DhEngineInfo`(跟其它 DH 类型同源);`digitalHuman` 对象加 `listEngines: dhListEngines`(`generate` 已在)。

- [ ] **Step 3: typecheck**
Run: `cd chayuan-client && npm run typecheck 2>&1 | grep -E "packages/(api|transport) typecheck"`
Expected: 两个 Done(忽略 apps/web @chayuan/license)

- [ ] **Step 4: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/transport/src/types.ts chayuan-client/packages/api/src/digitalHuman.ts
git commit -m "feat(dh): 前端 listEngines + generate engine 参数

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: GeneratePanel 引擎 picker + 未装 gating

**Files:** `packages/app/src/features/digital-human/GeneratePanel.tsx`

- [ ] **Step 1: 实现**(READ 现有 GeneratePanel 先)。在文案 textarea **上方**加「画质引擎」选择:
  - `useQuery(['dh.engines'], digitalHuman.listEngines)` 取引擎列表。
  - state `engine`(默认 `'wav2lip'`)。
  - 渲染引擎 chips(label);未安装的 GPU 引擎 chip 标灰 + 角标「未安装」。
  - 选中的引擎若 `installed===false` → 显示一行提示 +「去模型广场安装」按钮(`navigate('/marketplace')`,用现有 `useNavigate`/`openTab` 范式——参照本文件或同目录组件如何跳路由),并**禁用生成按钮**。
  - `gen()` 调用加 `engine`:`{ ...(productRef ? {product_image, template, matte} : {}), engine }`(注意:engine 与商品图无关,无商品图时也要带 engine)。把现有 `digitalHuman.generate(pid, text, productRef ? {...} : undefined)` 改成始终传 opts:
    ```typescript
    const opts = { engine, ...(productRef ? { product_image: productRef, template, matte } : {}) };
    const r = await digitalHuman.generate(pid, text, opts);
    ```
  - 生成按钮 `disabled` 增加条件:`|| !engineInstalled`(其中 `engineInstalled = engines.find(e=>e.id===engine)?.installed ?? false`)。
  样式用现有 `var(--cy-*)` token,chip 选中态参照本目录 DigitalHumanPage 的 tab 样式(选中 `bg-[var(--cy-ink-700)] text-white`)。

  完整示意(实现者按现有组件结构融入,保留 preset select / 商品图 / 版式 / matte / DhProgressCard):
```tsx
const enginesQ = useQuery({ queryKey: ['dh.engines'], queryFn: digitalHuman.listEngines });
const engines = enginesQ.data?.items ?? [];
const [engine, setEngine] = React.useState<'wav2lip'|'sadtalker'|'musetalk'>('wav2lip');
const engineInstalled = engines.find((e) => e.id === engine)?.installed ?? (engine === 'wav2lip');
// ... 引擎 chips:engines.map(e => <button .. onClick={()=>setEngine(e.id)}
//      className={selected ? ink-700 : surface-2}>{e.label}{!e.installed && '·未安装'}</button>)
// ... 未装提示:{!engineInstalled && (<div>该引擎运行时未安装(需 GPU)。<button onClick={()=>navigate({to:'/marketplace'})}>去模型广场安装</button></div>)}
// 生成按钮 disabled: !pid || !text.trim() || busy || !engineInstalled
```
  `navigate` 引入:参照同 features 目录别的页面如何拿路由跳转(`useNavigate` from '@tanstack/react-router'),没有现成就 import。

- [ ] **Step 2: typecheck**
Run: `cd chayuan-client && npm run typecheck 2>&1 | grep "packages/app typecheck"`
Expected: Done

- [ ] **Step 3: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/app/src/features/digital-human/GeneratePanel.tsx
git commit -m "feat(dh): 生成面板加画质引擎 picker(GPU 未装 gating + 去安装)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 全链路自检 + 推送

- [ ] **Step 1:** `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_*.py -q`(全 passed)
- [ ] **Step 2:** `cd chayuan-client && npm run typecheck 2>&1 | grep -E "packages/(api|transport|app) typecheck"`(三个 Done)
- [ ] **Step 3:** `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/*.py`
- [ ] **Step 4:** `cd /work/chayuan-desktop && git push origin main`

---

## 自检(Self-Review)

- **Spec 覆盖**(GPU-engine design 一/三/五节 GPU-P1):注册表+get_engine(engine_id)+list_engines+is_available(T1)、engine 字段贯通(T2)、GET /engines + generate 透传(T3)、前端 listEngines+engine(T4)、引擎 picker + 未装 gating + 去安装(T5)。第二节(真 sidecar)= GPU-P2/P3,不在本计划。
- **占位扫描**:无 TBD。GPU 引擎 `_UnavailableGpuEngine` 是**有意的占位 impl**(抛明确错误),不是 plan 占位——GPU-P1 范围就是"骨架,无真 GPU 引擎"。
- **类型一致**:`engine` 取值 `wav2lip|sadtalker|musetalk` 全链路同名(Python `DhEngine` Literal、TS opts、`DhEngineInfo.id`);`list_engines()` 返回字段 `{id,label,kind,input,builtin,installed}` 与 TS `DhEngineInfo` 逐一对齐;`get_engine(engine_id)` 默认 `wav2lip` 保 P1–P3 向后兼容。
- **不静默回退**:GPU 引擎 generate 抛"未安装",jobs 失败分支记 `state=failed,error=...`(现有逻辑),前端进度卡显错误——符合 spec"不静默回退"。
- **风险**:① 真 GPU 引擎/sidecar 是 GPU-P2/P3,本期 GPU 引擎选中即被前端禁用(installed=False),后端占位也会拦,双保险;② `/marketplace` 作"去安装"入口是占位路由,真正的运行时框架安装页若是别的路径,实现 T5 时核对实际路由(模型广场/运行时框架页)再定。
