# 数字人 P2(商品图同屏 + 版式)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** 数字人生成时可上传商品图 + 选版式(角落/居中/左侧),把口播 presenter 视频与商品图合成为一条"讲解商品"的 mp4。

**Architecture:** 复用现有 EDL 合成体系(`steps/compose.render_from_edl` + `_build_pip_layers`)。商品图作**主视频轨(全屏底层)**,presenter 口播视频作**PIP 叠层**(按版式定 x/y/scale)。无商品图时退回 P1(presenter 直接出片)。零新渲染代码。

**Tech Stack:** Python/FastAPI/moviepy(已有)+ React。承接 P1(`video_generation/digital_human/`)。

---

## 背景:合成模型(读懂再动手)

`steps/compose.py`:
- `render_from_edl(timeline, audio_file, subtitle_path, output_file, params, *, source_resolver, threads=2)` — 按 EDL 渲染:第一条 video 轨=全屏底层(每段 resize 到画幅),`_build_pip_layers` 把第 2+ 条 video 轨的 clips 作 PIP 叠层(`oc.resized(width=base_w*scale).with_position((x,y), relative=True)`,z 由轨道序),叠 `audio_file` 音轨 + `subtitle_path`(空串=无字幕)。
- `source_resolver(clip.source) -> path`:把 clip 的 `{path|url|material_id}` 解析成本地路径。DH 用 `{"path": ...}`。
- `params` 只需 `.video_aspect` + 可选 `.video_width/.video_height`(像素>0 时优先)。
- `Timeline/TimelineTrack/TimelineClip`(`schemas.py`):clip 有 `source/track_start_ms/in_ms/out_ms/x/y/scale/z`;track 有 `kind/clips/removable`。

P1 现状:`jobs._run_pipeline` 产出 `presenter.mp4`(Wav2Lip,口型同步 narration.wav)。P2 在其后插入"若有商品图→合成"。

---

## 文件结构

- `video_generation/_helpers.py`(改):加 `dh_products_dir()`。
- `video_generation/digital_human/store.py`(改):加 `resolve_product_path()`。
- `video_generation/digital_human/compose.py`(建):`TEMPLATES` + `build_presenter_edl()` + `render_with_product()`。
- `video_generation/digital_human/jobs.py`(改):`submit`/`_run_pipeline` 接 `product_ref`/`template`,合成分支。
- `api_server/digital_human_routes.py`(改):`POST /products` 上传;`generate` 透传 `product_image`/`template`。
- 前端:`packages/api/src/digitalHuman.ts`(改 generate 签名 + `uploadProduct`)、`GeneratePanel.tsx`(改:商品图上传 + 版式选择)。

测试:`tests/unit_tests/test_digital_human_compose.py`(新)、扩 `test_digital_human_jobs.py`、扩 `test_digital_human_routes.py`。

---

## Task 1: 商品图存储 helper + resolver

**Files:** `_helpers.py`, `digital_human/store.py`, test `test_digital_human_store.py`

- [ ] **Step 1: 写失败测试**(追加到 test_digital_human_store.py)
```python
def test_product_dir_and_resolve(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    pdir = _helpers.dh_products_dir(create=True)
    assert os.path.isdir(pdir) and pdir.endswith(os.path.join("digital_human", "products"))
    open(os.path.join(pdir, "p1.png"), "wb").write(b"x")
    assert dh_store.resolve_product_path("product:p1.png").endswith("p1.png")
    assert dh_store.resolve_product_path("product:missing.png") is None
    assert dh_store.resolve_product_path("bad") is None
```

- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py -v`
Expected: FAIL (no `dh_products_dir` / `resolve_product_path`)

- [ ] **Step 3: 实现** — `_helpers.py` 在 `dh_avatars_dir` 后加:
```python
def dh_products_dir(*, create: bool = False) -> str:
    """商品图目录 ``.../data/digital_human/products``(数字人讲解用,只存本机)。"""
    d = _chayuan_root() / "data" / "digital_human" / "products"
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return str(d)
```
`store.py` 顶部 import 加 `dh_products_dir`,并加:
```python
def resolve_product_path(ref: str) -> Optional[str]:
    """``product:<file>`` → 绝对路径;不是该前缀或文件不存在返 None。"""
    if not ref or not ref.startswith("product:"):
        return None
    p = os.path.join(dh_products_dir(), os.path.basename(ref[len("product:"):]))
    return p if os.path.isfile(p) else None
```

- [ ] **Step 4: 跑测试确认通过**(同 Step 2)

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/_helpers.py chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/store.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_store.py
git commit -m "feat(dh): 商品图存储目录 + product: 解析

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: compose —— 版式 + 内部 EDL + render_with_product

**Files:** `digital_human/compose.py`(建), test `test_digital_human_compose.py`(建)

- [ ] **Step 1: 写测试**(只验 EDL 结构,不真渲染 moviepy)
```python
from chayuan.server.video_generation.digital_human.compose import build_presenter_edl, TEMPLATES

def test_templates_keys():
    assert set(TEMPLATES) == {"corner", "bg", "side"}
    for v in TEMPLATES.values():
        assert {"x", "y", "scale"} <= set(v)

def test_build_presenter_edl_structure():
    tl = build_presenter_edl("/t/presenter.mp4", "/t/prod.png", "corner", dur_ms=5000)
    # 主轨=商品图(全屏底层,removable False);第二轨=presenter PIP(removable True)
    vtracks = [t for t in tl.tracks if t.kind == "video"]
    assert len(vtracks) == 2
    base = vtracks[0]; pip = vtracks[1]
    assert base.removable is False and base.clips[0].source["path"] == "/t/prod.png"
    assert pip.removable is True and pip.clips[0].source["path"] == "/t/presenter.mp4"
    # PIP 用 corner 版式的 x/y/scale
    c = pip.clips[0]
    assert c.scale == TEMPLATES["corner"]["scale"]
    assert c.out_ms == 5000 and base.clips[0].out_ms == 5000
    assert tl.duration_ms == 5000
```

- [ ] **Step 2: 跑测试确认失败**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_compose.py -v`
Expected: FAIL (ModuleNotFoundError compose)

- [ ] **Step 3: 实现 compose.py**
```python
"""数字人商品讲解合成:presenter 视频 + 商品图 → 内部 EDL → render_from_edl。

版式(presenter 作 PIP 叠在商品图全屏底层上;x/y=相对左上归一,scale=占底宽比例):
  corner — presenter 右下小窗,商品图为主体
  bg     — presenter 居中较大,商品图作背景
  side   — presenter 左侧,商品图铺底
真正的左右等分需画布预处理,本期用「商品全屏底 + presenter 定位」近似(零新渲染代码)。
"""
from __future__ import annotations
import logging
from typing import Any, Dict, Optional

from chayuan.server.video_generation.schemas import Timeline, TimelineTrack, TimelineClip

logger = logging.getLogger("chayuan.dh.compose")

TEMPLATES: Dict[str, Dict[str, float]] = {
    "corner": {"x": 0.66, "y": 0.60, "scale": 0.32},
    "bg":     {"x": 0.225, "y": 0.18, "scale": 0.55},
    "side":   {"x": 0.03, "y": 0.26, "scale": 0.46},
}


def build_presenter_edl(presenter_path: str, product_path: str, template: str, *, dur_ms: int) -> Timeline:
    """商品图=主视频轨(全屏底层);presenter=第二条 video 轨(PIP,按版式定位)。"""
    tpl = TEMPLATES.get(template) or TEMPLATES["corner"]
    base = TimelineTrack(id="dh-base", kind="video", removable=False, clips=[
        TimelineClip(id="dh-prod", source={"path": product_path},
                     track_start_ms=0, in_ms=0, out_ms=dur_ms),
    ])
    pip = TimelineTrack(id="dh-pip", kind="video", removable=True, clips=[
        TimelineClip(id="dh-presenter", source={"path": presenter_path},
                     track_start_ms=0, in_ms=0, out_ms=dur_ms,
                     x=float(tpl["x"]), y=float(tpl["y"]), scale=float(tpl["scale"]), z=1),
    ])
    return Timeline(version=1, duration_ms=dur_ms, tracks=[base, pip])


def _resolver(src: Dict[str, Any]) -> str:
    return (src or {}).get("path") or (src or {}).get("url") or ""


def render_with_product(*, presenter_path: str, product_path: str, template: str,
                        audio_path: str, out_path: str, width: int, height: int,
                        dur_ms: int) -> str:
    """合成商品讲解视频。失败抛异常(caller 兜底回退 presenter)。"""
    from chayuan.server.video_generation.steps.compose import render_from_edl
    from chayuan.server.video_generation.schemas import VideoParams

    tl = build_presenter_edl(presenter_path, product_path, template, dur_ms=dur_ms)
    params = VideoParams(video_width=width, video_height=height)
    render_from_edl(tl, audio_path, "", out_path, params, source_resolver=_resolver)
    return out_path
```
> 实现时核对 `VideoParams(video_width=, video_height=)` 能构造(字段有默认);若 `video_aspect` 必填则补一个合法枚举(像素>0 时 resolve_resolution 仍优先像素)。

- [ ] **Step 4: 跑测试确认通过**(结构测试不触发 moviepy import — `render_from_edl` 只在 `render_with_product` 内 import,`build_presenter_edl`/`TEMPLATES` 不碰)
Run: 同 Step 2。Expected: 2 passed

- [ ] **Step 5: py_compile + 提交**
```bash
python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/compose.py
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/compose.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_compose.py
git commit -m "feat(dh): 商品讲解合成(版式 + 内部 EDL → render_from_edl)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: jobs pipeline 接商品图/版式

**Files:** `digital_human/jobs.py`, test `test_digital_human_jobs.py`

- [ ] **Step 1: 写失败测试**(monkeypatch engine + tts + render_with_product,验证有商品图时走合成、产物=合成 out)
```python
def test_job_pipeline_with_product(monkeypatch, tmp_path):
    monkeypatch.setattr(_helpers, "_chayuan_root", lambda: tmp_path)
    def fake_tts(text, preset, audio_path):
        open(audio_path, "wb").write(b"wav"); return audio_path
    monkeypatch.setattr(dh_jobs, "_synthesize_narration", fake_tts)
    class _E:
        def generate(self, *, avatar_path, audio_path, out_path, width, height, on_progress=None):
            open(out_path, "wb").write(b"mp4"); return out_path
    monkeypatch.setattr(dh_jobs, "get_engine", lambda: _E())
    monkeypatch.setattr(dh_jobs, "resolve_avatar_path", lambda ref: "/tmp/a.mp4")
    monkeypatch.setattr(dh_jobs, "resolve_product_path", lambda ref: str(tmp_path / "prod.png"))
    called = {}
    def fake_render(**kw):
        called.update(kw); open(kw["out_path"], "wb").write(b"final"); return kw["out_path"]
    monkeypatch.setattr(dh_jobs, "render_with_product", fake_render)
    monkeypatch.setattr(dh_jobs, "_probe_duration_ms", lambda p: 5000)

    pid = dh_jobs.store.create_preset(name="A", avatar_ref="bundled:f1", avatar_kind="video").id
    tid = uuid_hex()  # 直接走 run_sync,见下注
    dh_jobs._PENDING[tid] = {"preset_id": pid, "text": "你好", "width": 720, "height": 1280,
                             "product_ref": "product:prod.png", "template": "corner"}
    dh_jobs._set(tid, state="pending", progress=0)
    dh_jobs.run_sync(tid)
    st = dh_jobs.get_status(tid)
    assert st.state == "complete"
    assert called.get("template") == "corner" and st.result_path.endswith("digital_human.mp4")
```
> `uuid_hex()`:测试顶部 `import uuid; uuid_hex = lambda: uuid.uuid4().hex[:12]`。沿用 P1 测试"绕开线程池直接 run_sync"的范式(避免 submit pool race)。

- [ ] **Step 2: 跑测试确认失败**(render_with_product/resolve_product_path/_probe_duration_ms 未在 dh_jobs)

- [ ] **Step 3: 实现** — `jobs.py`:
顶部 import 加:
```python
from chayuan.server.video_generation.digital_human.store import resolve_avatar_path, resolve_product_path
from chayuan.server.video_generation.digital_human.compose import render_with_product
```
加时长探测(复用 imageio_ffmpeg ffprobe 不可用就退 moviepy;失败返 0):
```python
def _probe_duration_ms(path: str) -> int:
    try:
        import imageio_ffmpeg, subprocess, json as _json
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        ffprobe = ff.replace("ffmpeg", "ffprobe")
        out = subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration",
                              "-of", "json", path], capture_output=True, text=True, timeout=30)
        dur = float(_json.loads(out.stdout or "{}").get("format", {}).get("duration") or 0)
        return int(dur * 1000)
    except Exception:  # noqa: BLE001
        return 0
```
`submit` 签名加 `product_ref: Optional[str] = None, template: str = "none"`,写进 `_PENDING`。
`_run_pipeline` 在 engine.generate 之后、设 complete 之前,插入:
```python
        result_path = out_path
        product_ref = args.get("product_ref")
        template = args.get("template") or "none"
        if product_ref and template != "none":
            product_path = resolve_product_path(product_ref)
            if not product_path:
                raise RuntimeError("商品图缺失")
            _set(tid, progress=88)
            dur_ms = _probe_duration_ms(out_path) or _probe_duration_ms(audio_path) or 0
            final_path = os.path.join(td, "digital_human.mp4")  # 与 presenter 同名? 见下
            presenter_keep = os.path.join(td, "presenter.mp4")
            os.replace(out_path, presenter_keep)  # 先把 presenter 挪开,腾出最终名
            render_with_product(
                presenter_path=presenter_keep, product_path=product_path, template=template,
                audio_path=audio_path, out_path=final_path, width=args["width"], height=args["height"],
                dur_ms=dur_ms or 5000,
            )
            result_path = final_path
        _set(tid, state="complete", progress=100, result_path=result_path)
```
> 注意:P1 里 `out_path = task_dir/digital_human.mp4`。合成时把 presenter 改名为 `presenter.mp4`,最终仍叫 `digital_human.mp4`(前端 taskFileUrl 不变)。无商品图时 `result_path=out_path`(原 digital_human.mp4),行为同 P1。
> 把原 `_set(tid, state="complete", progress=100, result_path=out_path)` 这一行替换成上面这段。

- [ ] **Step 4: 跑测试确认通过**(全 jobs 测试)
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py -v`
Expected: 全 passed(P1 的 success/missing-preset + 本条 with_product;wav2lip 冒烟视 librosa 而 skip/pass)

- [ ] **Step 5: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/jobs.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_jobs.py
git commit -m "feat(dh): pipeline 接商品图/版式 — 有商品则合成讲解视频

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 路由 —— 商品图上传 + generate 透传

**Files:** `api_server/digital_human_routes.py`, test `test_digital_human_routes.py`

- [ ] **Step 1: 写失败测试**(追加)
```python
def test_upload_product(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    r = c.post("/api/v1/digital-human/products",
               files={"file": ("p.png", b"x", "image/png")})
    assert r.status_code == 200 and r.json()["ref"].startswith("product:")

def test_generate_passes_product(monkeypatch, tmp_path):
    c = _client(monkeypatch, tmp_path)
    seen = {}
    monkeypatch.setattr(dh_jobs, "submit", lambda **k: seen.update(k) or "tid9")
    r = c.post("/api/v1/digital-human/generate",
               json={"preset_id": "p1", "text": "hi", "product_image": "product:p.png", "template": "corner"})
    assert r.status_code == 200 and r.json()["task_id"] == "tid9"
    assert seen.get("product_ref") == "product:p.png" and seen.get("template") == "corner"
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现** — `digital_human_routes.py`:
顶部 import 加 `dh_products_dir`(与 `dh_avatars_dir` 同处):
`from chayuan.server.video_generation._helpers import dh_avatars_dir, dh_products_dir`
加上传端点(仿 upload_avatar):
```python
@digital_human_router.post("/products")
async def upload_product(file: UploadFile = File(...),
                         user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    ext = os.path.splitext(file.filename or "")[1].lower() or ".png"
    fid = f"{int(time.time())}-{uuid.uuid4().hex[:6]}{ext}"
    dest = os.path.join(dh_products_dir(create=True), fid)
    with open(dest, "wb") as f:
        f.write(await file.read())
    return {"ref": f"product:{fid}", "name": fid}
```
`generate` 改为透传 product/template:
```python
@digital_human_router.post("/generate")
def generate(body: DhGenerateRequest,
             width: int = 720, height: int = 1280,
             user: Dict[str, Any] = Depends(require_auth_enabled())) -> Dict[str, Any]:
    tid = dh_jobs.submit(preset_id=body.preset_id, text=body.text,
                         width=width, height=height,
                         product_ref=body.product_image, template=body.template)
    return {"task_id": tid}
```
> `DhGenerateRequest` 已有 `product_image`/`template`(P1 占位),直接用。`dh_jobs` 已 import。

- [ ] **Step 4: 跑测试确认通过**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_routes.py -v`
Expected: 全 passed(P1 两条 + 本两条)

- [ ] **Step 5: py_compile + 提交**
```bash
python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/api_server/digital_human_routes.py
cd /work/chayuan-desktop && git add chayuan-server/libs/chayuan-server/chayuan/server/api_server/digital_human_routes.py chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_routes.py
git commit -m "feat(dh): 商品图上传端点 + generate 透传 product/template

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 前端 —— API + GeneratePanel(商品图上传 + 版式选择)

**Files:** `packages/api/src/digitalHuman.ts`, `packages/app/src/features/digital-human/GeneratePanel.tsx`

- [ ] **Step 1: api 加 uploadProduct + generate 扩参**(`digitalHuman.ts`)
在 `dhGenerate` 改签名 + 加 `dhUploadProduct`,并挂到 `digitalHuman` 对象:
```typescript
export async function dhUploadProduct(file: File): Promise<{ ref: string; name: string }> {
  const fd = new FormData(); fd.append('file', file);
  return rd<{ ref: string; name: string }>('/api/v1/digital-human/products', { method: 'POST', body: fd });
}

export async function dhGenerate(
  preset_id: string, text: string,
  opts?: { product_image?: string; template?: 'none' | 'corner' | 'bg' | 'side'; width?: number; height?: number },
): Promise<{ task_id: string }> {
  return rd<{ task_id: string }>('/api/v1/digital-human/generate', {
    method: 'POST',
    query: { width: opts?.width ?? 720, height: opts?.height ?? 1280 },
    body: { preset_id, text, product_image: opts?.product_image, template: opts?.template ?? 'none' },
  });
}
```
在 `digitalHuman` 对象加 `uploadProduct: dhUploadProduct`(`generate` 已在)。
> 核对现有 `dhGenerate` 旧签名 `(preset_id, text, width=720, height=1280)` 的调用方只有 GeneratePanel,本任务一并改;若别处有调用,改成 opts 形态。

- [ ] **Step 2: GeneratePanel 加商品图 + 版式**(`GeneratePanel.tsx`)
在文案 textarea 下、生成按钮上,插入:
- 商品图上传(可选):hidden file input + 按钮;上传后存 `productRef` + 显示文件名 + 「移除」。
- 版式选择(仅当有 productRef 时显示):三个 chip `corner`/`bg`/`side`(标签:角落小窗 / 居中讲解 / 左侧出镜),选中态高亮,state `template`。
- `gen()` 改:`digitalHuman.generate(pid, text, productRef ? { product_image: productRef, template } : undefined)`。
保持现有 reportError / DhProgressCard 不变。完整组件代码(在现有 GeneratePanel 基础上加 state `productRef`/`template`/`uploadingProduct` 与对应 UI;实现者按现有 token 样式写)。

- [ ] **Step 3: typecheck**
Run: `cd chayuan-client && npm run typecheck 2>&1 | grep -E "packages/(api|app) typecheck"`
Expected: 两个 Done(忽略 apps/web @chayuan/license)

- [ ] **Step 4: 提交**
```bash
cd /work/chayuan-desktop && git add chayuan-client/packages/api/src/digitalHuman.ts chayuan-client/packages/app/src/features/digital-human/GeneratePanel.tsx
git commit -m "feat(dh): 生成面板加商品图上传 + 版式选择

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 全链路自检 + 推送

- [ ] **Step 1: 后端全 DH 测试**
Run: `PYTHONPATH="chayuan-server/libs/chayuan-server" pytest chayuan-server/libs/chayuan-server/tests/unit_tests/test_digital_human_*.py -q`
Expected: 全 passed

- [ ] **Step 2: 前端 typecheck**
Run: `cd chayuan-client && npm run typecheck 2>&1 | grep -E "packages/(api|transport|app) typecheck"`
Expected: 三个 Done

- [ ] **Step 3: py_compile 触达后端**
Run: `python -m py_compile chayuan-server/libs/chayuan-server/chayuan/server/video_generation/digital_human/*.py`

- [ ] **Step 4: 推送** `cd /work/chayuan-desktop && git push origin main`

---

## 自检(Self-Review)

- **Spec 覆盖**(design §0.2 A + §4.3 版式):商品图上传(T1/T4/T5)、版式 corner/bg/side(T2/T5)、同屏合成走 render_from_edl(T2/T3)、无商品退回 P1(T3)。**B 抠像/matte = P3,不在本计划**。
- **占位扫描**:无 TBD。T5 Step2 给的是"在现有组件加 state+UI"的明确增量(非占位)。
- **类型一致**:`product_image`(请求字段)→ `product_ref`(jobs 参数)命名转换在 T4 路由层显式;`template` 全链路同名;`TEMPLATES` 键 `corner/bg/side` 与前端 chip、schema `DhTemplate` 一致。
- **风险**:① 真实合成需 moviepy(本机无)→ 合成测试全程 stub `render_with_product`,真渲染在用户环境验;② `side` 非真等分(商品全屏底+presenter 左置近似),已在 compose.py 注释说明;③ presenter 改名 `presenter.mp4` 后最终仍 `digital_human.mp4`,taskFileUrl 不变。
